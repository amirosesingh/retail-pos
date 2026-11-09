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
  const stockPin = JSON.parse(sql(service + begin().replace(/\);$/, ",true);")));
  assert.equal(stockPin.status, "OK");
  assert.notEqual(stockPin.pin_id, priorPin.pin_id);
  assert.equal(stockPin.seq, untouched);

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
  const seal = `SELECT pos_sync_feed_v1.seal_extended_scope('default','${branch}','${epoch}');`;
  denySql(`SET ROLE authenticated; ${seal}`, /permission denied/);
  assert.equal(sql(seal), completed.next_seq);
  assert.equal(sql(seal), completed.next_seq);
  sql(`UPDATE public.products SET stock_by_store=jsonb_set(stock_by_store,ARRAY['${branch}'],'9'),
    row_version=row_version+1 WHERE id='${product}';`);
  assert.equal(head(), completed.next_seq);
  assert.equal(JSON.parse(sql(service + extendedPull(start))).sealed_seq, completed.next_seq);
  console.log("PASS authorized live stock coalesces per committed product revision and stays in the same cash group");
}
