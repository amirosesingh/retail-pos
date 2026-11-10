import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export async function verifyLiveStockGateway({ sql, denySql, session, waitFor, service, branch, other, product, epoch,
  terminal, generation, database, cashHash, changes, pullCall, begin, proof }) {
  const extendedPull = after => pullCall(branch, terminal, proof, after)
    .replace("pos_sync_pull_grouped", "pos_sync_pull_cash_settings_extended");
  const head = () => sql(`SELECT head_seq FROM pos_sync_feed_v1.feed_heads WHERE scope_id='${branch}';`);
  const untouched = head();
  sql(`UPDATE public.products SET stock_by_store=jsonb_set(stock_by_store,ARRAY['${branch}'],'4'),
    row_version=row_version+1 WHERE id='${product}';`);
  assert.equal(head(), untouched);
  const priorPin = JSON.parse(sql(service + begin()));
  const older = session();
  older.child.stdin.write(`BEGIN ISOLATION LEVEL REPEATABLE READ;
    SELECT stock_by_store FROM public.products WHERE id='${product}';
    \\echo PRE_ARM_STOCK_SNAPSHOT
`);
  await waitFor(() => older.stdout.includes("PRE_ARM_STOCK_SNAPSHOT"), "The pre-arm product transaction did not take its snapshot");
  sql(`BEGIN;
    SELECT pos_sync_feed_v1.arm_cash_stock_scope('default','${branch}','${epoch}');
    SELECT pos_sync_feed_v1.arm_extended_scope('default','${branch}','${epoch}');
    COMMIT;`);
  older.child.stdin.end(`UPDATE public.products SET stock_by_store=jsonb_set(stock_by_store,ARRAY['${branch}'],'99'),
    row_version=row_version+1 WHERE id='${product}'; COMMIT;`);
  assert.notEqual(await older.finished, 0);
  assert.match(older.stderr, /could not serialize access due to concurrent update/);
  assert.equal(sql(`SELECT stock_by_store->>'${branch}' FROM public.products WHERE id='${product}';`), "4");
  const beginExtended = minimum =>
    JSON.parse(sql(service + begin().replace(/\);$/, minimum === undefined ? ",true);" : `,true,'${minimum}');`)));
  const stockPin = beginExtended();
  assert.equal(stockPin.status, "OK");
  assert.notEqual(stockPin.pin_id, priorPin.pin_id);
  assert.equal(stockPin.seq, untouched);
  assert.equal(beginExtended("0").pin_id, stockPin.pin_id);

  sql(`BEGIN;
    UPDATE public.products SET stock_by_store=jsonb_set(stock_by_store,ARRAY['${branch}'],'7'),
      row_version=row_version+1 WHERE id='${product}';
    UPDATE public.products SET stock_by_store=jsonb_set(stock_by_store,ARRAY['${branch}'],'8'),
      row_version=row_version+1 WHERE id='${product}';
    UPDATE public.products SET stock_by_store=jsonb_set(stock_by_store,ARRAY['${other}'],'101'),
      row_version=row_version+1 WHERE id='${product}';
    COMMIT;`);
  const initial = JSON.parse(sql(service + extendedPull(untouched)));
  assert.equal(initial.groups.length, 1);
  const latest = JSON.parse(sql(`SELECT jsonb_build_object('branch_balance',stock_by_store->'${branch}',
    'row_version',row_version,'product_id',id) FROM public.products WHERE id='${product}';`));
  assert.deepEqual(initial.groups[0].changes[0].row_data, latest);
  assert.equal(initial.groups[0].changes[0].table_name, "products_stock");
  assert.equal(latest.branch_balance, 8);
  assert.ok(!JSON.stringify(initial).includes(other));
  assert.equal(beginExtended(stockPin.seq).pin_id, stockPin.pin_id);
  const refreshed = beginExtended();
  assert.equal(refreshed.status, "OK");
  assert.notEqual(refreshed.pin_id, stockPin.pin_id);
  assert.equal(refreshed.seq, initial.next_seq);
  assert.equal(beginExtended().pin_id, refreshed.pin_id);
  const currentStock = JSON.parse(sql(service + `SELECT public.pos_sync_page_cash_settings_recovery_v1(
    'default','${branch}','${terminal}','${proof}','${refreshed.pin_id}','stock','0',100,true);`));
  assert.equal(currentStock.status, "OK");
  assert.deepEqual(JSON.parse(currentStock.payload_json).rows.find(row => row.product_id === product), latest);

  const start = head();
  sql(`UPDATE public.products SET stock_by_store=jsonb_set(stock_by_store,ARRAY['${other}'],'102'),
    row_version=row_version+1 WHERE id='${product}';`);
  sql(`BEGIN; UPDATE public.products SET stock_by_store=jsonb_set(stock_by_store,ARRAY['${branch}'],'88'),
    row_version=row_version+1 WHERE id='${product}'; ROLLBACK;`);
  assert.equal(head(), start);
  const operation = randomUUID(), movement = randomUUID();
  const receipt = structuredClone(changes);
  for (const [index, row] of receipt.entries()) {
    row.row_data.id = index === 3 ? movement : randomUUID();
    row.entity_id = JSON.stringify({ id: row.row_data.id });
  }
  sql(`BEGIN;
    UPDATE public.products SET stock_by_store=jsonb_set(stock_by_store,ARRAY['${branch}'],'7'),
      row_version=row_version+1 WHERE id='${product}';
    INSERT INTO public.stock_delta_applied VALUES ('${movement}','${product}','${branch}',-1);
    SELECT pos_sync_feed_v1.append_groups('default','${JSON.stringify([
      { scope_id: branch, epoch, operation_id: operation, changes: receipt },
    ])}'::jsonb);
    SELECT pos_sync_feed_v1.record_cash_publication('default','${branch}','${epoch}',${BigInt(start) + 1n},
      '${operation}','${terminal}','${generation}','${database}','${cashHash}');
    COMMIT;`);
  const completed = JSON.parse(sql(service + extendedPull(start)));
  assert.equal(completed.groups.length, 1);
  assert.equal(completed.groups[0].operation_id, operation);
  assert.deepEqual(completed.groups[0].stock, { product_id: product, branch_balance: 7, row_version: latest.row_version + 2 });
  denySql(`SET ROLE authenticated; ${extendedPull(start)}`, /permission denied/);
  const saleKey = { table_name: "sales", id: receipt[0].row_data.id, version: "1" };
  const coverage = JSON.parse(sql(service + `SELECT public.pos_sync_extended_legacy_coverage_v1(
    'default','${branch}','${terminal}','${proof}',NULL,'${JSON.stringify([saleKey])}'::jsonb);`));
  assert.deepEqual(coverage, { status: "OK", scope_id: branch, epoch,
    entries: [{ ...saleKey, seq: completed.next_seq, owned: true }] });
  const receivingTerminal = randomUUID();
  const receivingProof = "d".repeat(64);
  sql(`BEGIN;
    INSERT INTO public.terminal_tokens (id,location_id,platform,status,is_claimed,claimed_platform,claim_proof)
    VALUES ('${receivingTerminal}','${other}','pc','used',true,'electron','${receivingProof}');
    SELECT pos_sync_feed_v1.arm_cash_settings_scope('default','${other}','${epoch}');
    SELECT pos_sync_feed_v1.arm_cash_stock_scope('default','${other}','${epoch}');
    SELECT pos_sync_feed_v1.arm_extended_scope('default','${other}','${epoch}');
    COMMIT;`);
  const receivingPull = after => pullCall(other, receivingTerminal, receivingProof, after)
    .replace("pos_sync_pull_grouped", "pos_sync_pull_cash_settings_extended");
  sql(`BEGIN;
    UPDATE public.products SET owner_store_id='transient-owner',row_version=row_version+1 WHERE id='${product}';
    UPDATE public.products SET owner_store_id='${other}',row_version=row_version+1 WHERE id='${product}';
    COMMIT;`);
  const withdrawal = JSON.parse(sql(service + extendedPull(completed.next_seq)));
  const transfer = JSON.parse(sql(service + receivingPull("0")));
  const version = latest.row_version + 4;
  assert.equal(withdrawal.groups.length, 1);
  assert.deepEqual(withdrawal.groups[0].changes[0].row_data, { product_id: product, row_version: version });
  assert.equal(withdrawal.groups[0].changes[0].tombstone, true);
  assert.equal(transfer.groups.length, 1);
  assert.deepEqual(transfer.groups[0].changes[0].row_data, { product_id: product, branch_balance: 102, row_version: version });
  assert.equal(transfer.groups[0].changes[0].tombstone, false);
  assert.equal(sql("SELECT count(*) FROM pos_sync_feed_v1.stock_transaction_writes;"), "0");
  denySql(service + pullCall(other, terminal, proof, "0").replace("pos_sync_pull_grouped", "pos_sync_pull_cash_settings_extended"),
    /SCOPE_FORBIDDEN/);
  sql(`DELETE FROM pos_sync_feed_v1.snapshot_pins WHERE scope_id='${branch}';
    SELECT pos_sync_feed_v1.retire_groups('default','${branch}','${epoch}','${withdrawal.next_seq}');`);
  assert.equal(JSON.parse(sql(service + extendedPull(completed.next_seq))).status, "SNAPSHOT_REQUIRED");
  const recovered = beginExtended();
  assert.equal(recovered.status, "OK");
  assert.equal(JSON.parse(recovered.manifest_json).cash_count, "107");
  let after = "0", retired = null;
  do {
    const page = JSON.parse(sql(service + `SELECT public.pos_sync_page_cash_settings_recovery_v1(
      'default','${branch}','${terminal}','${proof}','${recovered.pin_id}','stock','${after}',25,true);`));
    assert.equal(page.status, "OK");
    const stockPage = JSON.parse(page.payload_json);
    retired ??= stockPage.rows.find(row => row.product_id === product) ?? null;
    after = stockPage.next === stockPage.total ? null : stockPage.next;
  } while (after !== null);
  assert.deepEqual(retired, { product_id: product, row_version: version, retired: true });
  sql(`DELETE FROM public.products WHERE id='${product}';`);
  const deletion = JSON.parse(sql(service + receivingPull(transfer.next_seq)));
  assert.deepEqual(deletion.groups[0].changes[0].row_data, { product_id: product, row_version: version + 1 });
  assert.equal(deletion.groups[0].changes[0].tombstone, true);
  denySql(`INSERT INTO public.products VALUES ('${product}','${other}','{"${other}":1}',1);`,
    /POS_LIVE_STOCK_V1_REVISION_UNVERIFIED/);
  const seal = `SELECT pos_sync_feed_v1.seal_extended_scope('default','${branch}','${epoch}');`;
  denySql(`SET ROLE authenticated; ${seal}`, /permission denied/);
  assert.equal(sql(seal), withdrawal.next_seq);
  assert.equal(sql(seal), withdrawal.next_seq);
  sql(`UPDATE public.products SET stock_by_store=jsonb_set(stock_by_store,ARRAY['${branch}'],'9'),
    row_version=row_version+1 WHERE id=(SELECT id FROM public.products WHERE owner_store_id='${branch}' LIMIT 1);`);
  assert.equal(head(), withdrawal.next_seq);
  assert.equal(JSON.parse(sql(service + extendedPull(withdrawal.next_seq))).sealed_seq, withdrawal.next_seq);
  console.log("PASS exact live stock, scoped owner changes, old-feed retirement recovery, and cash publication");
}
