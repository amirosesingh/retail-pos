// Disposable PostgreSQL and optional Windows LocalDB. No saved profiles.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { dispatchSql, fixtureSql, ids, migration, seedSql, sourceFunction, webIdentity } from "./fixtures/transfer-dispatch-fixture.mjs";

const require = createRequire(import.meta.url);
const { createLocal } = require("./lib/shift-protocol-integration-fixture.cjs");
const { ChangeReader } = require("../electron/sync/change-reader.cjs");
const { CheckpointRepository } = require("../electron/sync/checkpoints.cjs");
const { parseFinancialCorrection, applyFinancialCorrection } = require("../electron/sync/grouped-financial-corrections.cjs");
const { applyGroupedStock } = require("../electron/sync/grouped-live-stock.cjs");
const { applyLegacyCashCoverage } = require("../electron/sync/grouped-cash-legacy.cjs");
const read = file => readFile(new URL("../" + file, import.meta.url), "utf8");
const preparation = name => read("scripts/preparation/" + name + ".sql");
const db = new PGlite();
const one = async (query, args = []) => Object.values((await db.query(query, args)).rows[0])[0];
const epochA = randomUUID(), epochB = randomUUID(), terminalA = randomUUID(), terminalB = randomUUID();
const proofA = "a".repeat(64), proofB = "b".repeat(64);
const pull = (branch, terminal, proof, epoch, after = "0") => one(
  "SELECT public.pos_sync_pull_cash_settings_extended_v1('default',$1,$2,$3,$4,$5,NULL,20)",
  [branch, terminal, proof, epoch, after]);
const changeGraph = (group, edit) => {
  const copy = structuredClone(group);
  const row = copy.changes[0].row_data;
  const graph = JSON.parse(row.graph_json);
  edit(graph);
  row.graph_json = JSON.stringify(graph);
  row.graph_sha256 = createHash("sha256").update(row.graph_json).digest("hex");
  return copy;
};

async function applyLocal(branch, epoch, facts, {
  pending = false, recovering = false, completed = null, successors = [], ownedSuccessors = [],
} = {}) {
  const local = await createLocal(branch, { extraTables: ["stock_transfers", "stock_transfer_items", "products", "item_activity_logs"] });
  try {
    const { manager, registry } = local;
    await manager.pool.request().batch(await preparation("pos-sync-live-stock-native-v1"));
    await local.insert("products", completed?.product ??
      { id: ids.product, row_version: 1, owner_store_id: "A", stock_quantity: 14, stock_by_store: { A: 10, B: 4 } });
    if (ownedSuccessors.length) await local.insert("products",
      { id: ids.product2, row_version: 1, owner_store_id: branch, stock_quantity: 38, stock_by_store: { A: 38, B: 0 } });
    await manager.pool.request().batch(`
      ALTER TABLE dbo.stock_transfers ADD FOREIGN KEY(source_request_id) REFERENCES dbo.stock_transfers(id);
      ALTER TABLE dbo.stock_transfer_items ADD FOREIGN KEY(transfer_id) REFERENCES dbo.stock_transfers(id),
        FOREIGN KEY(product_id) REFERENCES dbo.products(id);`);
    if (completed) {
      for (const row of completed.headers) await local.insert("stock_transfers", row);
      for (const row of completed.lines) await local.insert("stock_transfer_items", row);
      for (const row of facts.logs) await local.insert("item_activity_logs", row);
    }
    const checkpoint = new CheckpointRepository(manager);
    const current = () => manager.pool.request().query("SELECT CHANGE_TRACKING_CURRENT_VERSION() AS version;");
    for (const name of ["stock_transfers", "stock_transfer_items", "products", "item_activity_logs"]) {
      await checkpoint.save(branch, name, "push", { change_tracking_version: (await current()).recordset[0].version });
    }
    const worker = { registry, connectionManager: manager, reader: new ChangeReader(manager, registry) };
    const sql = manager.sql();
    const apply = async ({ writePin = false, group = facts } = {}) => {
      const tx = new sql.Transaction(manager.pool);
      await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      try {
        if (writePin) {
          assert.equal(await applyGroupedStock(worker, tx, branch,
            [{ ...facts.stock[0], row_version: facts.stock[0].row_version + 1, branch_balance: 5 }],
            { epoch, seq: "2", recovery: true }), 1);
        }
        const count = await applyFinancialCorrection(worker, tx, { branch, financialEpoch: epoch, recoveringFinancial: recovering }, group);
        await checkpoint.save(branch, "fixture_transfer", "pull", { committed_cursor: group.seq }, tx);
        await tx.commit();
        return count;
      } catch (error) {
        await tx.rollback().catch(() => {});
        throw error;
      }
    };
    if (completed) {
      assert.equal(facts.headers.at(-1).row_version, 3);
      assert.equal(completed.headers.at(-1).row_version, 5);
      assert.equal(completed.headers.at(-1).status, "completed");
      const pendingId = randomUUID();
      await local.insert("stock_transfers", { id: pendingId, from_store_id: branch, to_store_id: "B", status: "draft", row_version: 1 });
      await manager.pool.request().input("branch", branch).input("id", JSON.stringify({ id: pendingId })).query(`
        INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version)
        VALUES(N'stock_transfers',@id,N'insert',@branch,1);`);
      await checkpoint.save(branch, "fixture_transfer", "pull", { committed_cursor: "0" });
      const state = async () => (await manager.pool.request().query(`
        SELECT * FROM dbo.stock_transfers ORDER BY id;
        SELECT * FROM dbo.stock_transfer_items ORDER BY id;
        SELECT * FROM dbo.products ORDER BY id;
        SELECT * FROM dbo.pos_sync_grouped_stock_v1 ORDER BY branch_id,product_id;
        SELECT * FROM dbo.item_activity_logs ORDER BY id;
        SELECT * FROM dbo.sync_change_journal ORDER BY change_id;
        SELECT * FROM dbo.sync_checkpoints WHERE entity_type=N'fixture_transfer';`)).recordsets;
      const retained = await state();
      assert.equal(retained[5].length, 1);
      assert.equal(retained[6][0].committed_cursor, "0");
      await assert.rejects(apply({ writePin: true }), { code: "ESYNC_GROUPED_REVIEW_REQUIRED" });
      assert.deepEqual(await state(), retained);
      console.log("PASS archived dispatch holds over the later completed transfer and rolls back stock, audit, pending work, and cursor.");
      return;
    }
    if (pending) {
      await manager.pool.request().input("id", ids.product).query("UPDATE dbo.products SET row_version=row_version+1 WHERE id=@id;");
      await assert.rejects(apply(), { code: "ELOCAL_UPLOAD_PENDING" });
      const state = await manager.pool.request().query(`SELECT
        (SELECT COUNT(*) FROM dbo.stock_transfers) AS transfers,
        (SELECT COUNT(*) FROM dbo.stock_transfer_items) AS items,
        (SELECT COUNT(*) FROM dbo.item_activity_logs) AS logs,
        (SELECT COUNT(*) FROM dbo.sync_checkpoints WHERE entity_type='fixture_transfer') AS cursor_count;`);
      assert.deepEqual(state.recordset[0], { transfers: 0, items: 0, logs: 0, cursor_count: 0 });
      return;
    }
    assert.equal(await apply({ writePin: recovering }), branch === "A" ? recovering ? 5 : 6 : 4);
    assert.equal(await apply(), 0);
    const result = await manager.pool.request().input("product", ids.product).query(`
      SELECT status FROM dbo.stock_transfers ORDER BY kind;
      SELECT COUNT(*) AS count FROM dbo.stock_transfer_items;
      SELECT COUNT(*) AS count FROM dbo.item_activity_logs;
      SELECT stock_by_store FROM dbo.products WHERE id=@product;`);
    assert.deepEqual(result.recordsets[0].map(row => row.status), ["completed", "dispatched"]);
    assert.equal(result.recordsets[1][0].count, 2);
    assert.equal(result.recordsets[2][0].count, branch === "A" ? 1 : 0);
    assert.deepEqual(JSON.parse(result.recordsets[3][0].stock_by_store), { A: branch === "A" ? recovering ? 5 : 8 : 10, B: 4 });
    for (const group of successors) {
      assert.equal(await apply({ group }), group.logs.length ? 3 : 2);
      assert.equal(await apply({ group }), 0);
    }
    if (successors.length) {
      const state = await manager.pool.request().input("id", ids.child).query(`
        SELECT status,received_by,verified_by FROM dbo.stock_transfers WHERE id=@id;
        SELECT quantity_verified FROM dbo.stock_transfer_items WHERE transfer_id=@id;
        SELECT COUNT(*) AS count FROM dbo.item_activity_logs WHERE activity_type=N'transfer_in';
        SELECT committed_cursor FROM dbo.sync_checkpoints WHERE entity_type=N'fixture_transfer';`);
      assert.deepEqual(state.recordsets[0], [{ status: "completed", received_by: "Verified Receiver", verified_by: "Verified Receiver" }]);
      assert.deepEqual(state.recordsets[1], [{ quantity_verified: 2 }]);
      assert.deepEqual(state.recordsets[2], [{ count: branch === "B" ? 1 : 0 }]);
      assert.deepEqual(state.recordsets[3], [{ committed_cursor: successors.at(-1).seq }]);
    }
    if (ownedSuccessors.length) {
      for (const [index, group] of ownedSuccessors.entries()) {
        assert.equal(await apply({ group }), index === 0 ? 2 : 4);
        assert.equal(await apply({ group }), 0);
      }
      const verified = ownedSuccessors.at(-1);
      const result = await manager.pool.request().input("transfer", verified.headers[0].id).input("product", ids.product2).query(`
        SELECT status,discrepancy_reason FROM dbo.stock_transfers WHERE id=@transfer;
        SELECT stock_quantity,stock_by_store FROM dbo.products WHERE id=@product;
        SELECT branch_balance,product_version FROM dbo.pos_sync_grouped_stock_v1 WHERE product_id=@product;
        SELECT committed_cursor FROM dbo.sync_checkpoints WHERE entity_type=N'fixture_transfer';`);
      assert.deepEqual(result.recordsets[0], [{ status: "completed_with_discrepancy", discrepancy_reason: "One item short" }]);
      assert.equal(result.recordsets[1][0].stock_quantity, 39);
      assert.deepEqual(JSON.parse(result.recordsets[1][0].stock_by_store), { A: 38, B: 1 });
      assert.deepEqual(result.recordsets[2], [{ branch_balance: 1, product_version: verified.stock[0].row_version }]);
      assert.deepEqual(result.recordsets[3], [{ committed_cursor: verified.seq }]);
    }
    if (branch === "A" && !recovering) {
      const foreign = randomUUID();
      await local.insert("stock_transfers", { id: foreign, from_store_id: "C", to_store_id: "D", row_version: 1 });
      const line = facts.lines.find(row => row.transfer_id === ids.child);
      const change = { table_name: "stock_transfer_items", entity_id: JSON.stringify({ id: line.id }),
        row_version: String(line.row_version), tombstone: false, row_data: line };
      const check = async rows => {
        const tx = new sql.Transaction(manager.pool);
        await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
        const batch = { rows, tombstones: [] };
        try {
          return await applyLegacyCashCoverage(tx, { branch, extended: true }, batch, { batch, position: null, owners: new Map() });
        } finally { await tx.rollback(); }
      };
      await check([change]);
      await assert.rejects(check([change, { ...change, row_data: { ...line, transfer_id: foreign } }]),
        { code: "ESYNC_CASH_LEGACY_COVERAGE" });
    }
  } finally { await local.close(); }
}

try {
  await db.exec(fixtureSql);
  await db.exec("BEGIN;" + migration + "COMMIT;");
  const catalogue = await read("supabase/migrations/20261026162030_isolate_cluster_catalogue_reads.sql");
  const source = await read("supabase/schema.sql");
  const settings = source.match(/CREATE TABLE IF NOT EXISTS public\.pos_store_settings \([\s\S]*?\n\);/)?.[0];
  assert(settings, "The repository POS settings table is required.");
  await db.exec(`${settings}
    ${sourceFunction("public.branch_catalogue_is_private", catalogue)}
    ${sourceFunction("public.product_available_in_catalogue", catalogue)}
    CREATE TABLE public.stock_delta_applied(movement_id uuid PRIMARY KEY,product_id uuid,store_id text,delta integer);
    CREATE TABLE public.terminal_tokens(id uuid PRIMARY KEY,location_id text,platform text,status text,revoked_at timestamptz,
      is_claimed boolean,claimed_at timestamptz,claimed_platform text,claim_proof text,claimed_proof_hash text);
    CREATE FUNCTION public.pos_sync_validate_scope(text,text,text) RETURNS void LANGUAGE plpgsql AS $$BEGIN RETURN; END$$;`);
  for (const name of ["pos-sync-feed-v1", "pos-sync-store-settings-v1", "pos-sync-grouped-gateway-v1",
    "pos-sync-cash-settings-gateway-v1", "pos-sync-cash-legacy-coverage-v1", "pos-sync-live-stock-v1",
    "pos-sync-extended-feed-v1", "pos-sync-cash-settings-recovery-v1"]) await db.exec(await preparation(name));
  const financial = await preparation("pos-sync-financial-corrections-feed-v1");
  await db.exec(financial.slice(financial.indexOf("CREATE FUNCTION pos_sync_feed_v1.financial_change("),
    financial.indexOf("CREATE FUNCTION pos_sync_feed_v1.publish_refund_correction()")));
  const correction = await preparation("pos-sync-correction-receipt-recovery-v1");
  await db.exec(correction.slice(correction.indexOf("CREATE FUNCTION pos_sync_feed_v1.correction_receipt_row("),
    correction.indexOf("CREATE FUNCTION pos_sync_feed_v1.capture_correction_receipt_graph()")));
  await db.exec(await preparation("pos-sync-transfer-dispatch-feed-v1"));
  await db.exec(seedSql({ extra: `UPDATE public.stock_transfers SET row_version=2 WHERE id='${ids.child}';` }));
  for (const [branch, epoch, terminal, proof] of [["A", epochA, terminalA, proofA], ["B", epochB, terminalB, proofB]]) {
    await db.query("INSERT INTO public.terminal_tokens VALUES($1,$2,'pc','active',NULL,true,NULL,'electron',$3,NULL)", [terminal, branch, proof]);
    await db.query("INSERT INTO pos_sync_feed_v1.feed_heads VALUES('default',$1,$2,0,0)", [branch, epoch]);
    await db.query("INSERT INTO pos_sync_feed_v1.settings_pilots(organization_id,scope_id,epoch) VALUES('default',$1,$2)", [branch, epoch]);
    for (const fn of ["arm_cash_settings_scope", "arm_cash_stock_scope", "arm_extended_scope"]) {
      await one(`SELECT pos_sync_feed_v1.${fn}('default',$1,$2)`, [branch, epoch]);
    }
  }
  assert.equal((await one(dispatchSql())).replayed, false);
  assert.equal((await one(dispatchSql())).replayed, true);
  await db.exec("SELECT set_config('test.role','service_role',false);");
  await assert.rejects(pull("B", terminalA, proofA, epochB), /SCOPE_FORBIDDEN/);
  const a = await pull("A", terminalA, proofA, epochA), b = await pull("B", terminalB, proofB, epochB);
  assert.equal(a.groups.length, 1, "The atomic source group owns its stock revision.");
  assert.equal(b.groups.length, 1);
  const [sourceGroup] = a.groups, [destinationGroup] = b.groups;
  assert.notEqual(sourceGroup.operation_id, destinationGroup.operation_id);
  const sending = parseFinancialCorrection(sourceGroup, "A"), receiving = parseFinancialCorrection(destinationGroup, "B");
  assert.deepEqual(sending.headers, receiving.headers);
  assert.deepEqual(sending.lines, receiving.lines);
  assert.deepEqual(receiving.stock, []);
  assert.deepEqual(receiving.logs, []);
  assert.equal(sending.stock[0].branch_balance, 8);
  assert.equal(sending.logs[0].quantity_delta, -2);
  assert.throws(() => parseFinancialCorrection(sourceGroup, "B"), /authorized scope/);
  assert.throws(() => parseFinancialCorrection(changeGraph(destinationGroup, graph => {
    graph.stock = sending.stock;
    graph.logs = sending.logs;
  }), "B"), /authorized scope/);
  const key = { table_name: "stock_transfers", id: ids.child, version: sourceGroup.changes[0].row_version };
  const covered = await one("SELECT public.pos_sync_extended_legacy_coverage_v1('default','A',$1,$2,$3,$4)",
    [terminalA, proofA, epochA, JSON.stringify([key])]);
  assert.deepEqual(covered.entries, [{ ...key, seq: "1", owned: true }]);
  await one("SELECT pos_sync_feed_v1.retire_groups('default','A',$1,'1')", [epochA]);
  assert.deepEqual(await pull("A", terminalA, proofA, epochA), { status: "SNAPSHOT_REQUIRED", reason: "REPLAY_EXPIRED" });
  const recovery = await one(`SELECT pos_sync_feed_v1.financial_recovery_row(published)
    FROM pos_sync_feed_v1.extended_publications published WHERE scope_id='A' AND seq=1`);
  assert.deepEqual(recovery, sourceGroup);
  console.log("PASS atomic dispatch publishes once to both scopes, retires to a recovery archive, and keeps stock and audit in the sending scope.");
  const warehouse = await read("supabase/migrations/20261007111500_harden_warehouse_transfer_lifecycle.sql");
  const beforeWarehouseGuard = source.slice(0, source.indexOf("DROP FUNCTION IF EXISTS public.stock_transfer_receive(uuid, text, boolean);"));
  assert(beforeWarehouseGuard.length > 1);
  for (const name of ["stock_transfer_receive", "stock_transfer_verify"]) {
    await db.exec(sourceFunction("public." + name, beforeWarehouseGuard).replace("FUNCTION public.", "FUNCTION private."));
    await db.exec(sourceFunction("public." + name, warehouse));
  }
  await db.exec(await preparation("pos-sync-native-transfer-receive-v1"));
  await db.exec(await preparation("pos-sync-native-transfer-receive-v1"));
  await db.exec(await preparation("pos-sync-transfer-receipt-feed-v1"));
  await db.exec(await preparation("pos-sync-transfer-receipt-feed-v1"));
  const receiver = randomUUID();
  await db.query(`INSERT INTO public.app_users(id,user_id,full_name,email,role,role_slug,store_id,is_active,auth_user_id,permissions)
    VALUES($1,'fixture-receiver','Verified Receiver','receiver@example.test','staff','warehouse','B',true,$1,'{"can_receive_transfer":true}')`, [receiver]);
  const receipt = (stage, actor = "fixture-receiver", branch = "B", quantity = 2, reason = null) =>
    one("SELECT public.stock_transfer_receive_for_staff($1,$2,$3,$4,$5,$6)",
      [ids.child, actor, branch, stage, JSON.stringify([{ product_id: ids.product, qty: quantity }]), reason]);
  const lifecycle = () => one(`SELECT jsonb_build_object('status',status,'received_by',received_by,'verified_by',verified_by)
    FROM public.stock_transfers WHERE id='${ids.child}'`);
  const balance = () => one(`SELECT stock_by_store FROM public.products WHERE id='${ids.product}'`);
  await db.exec(webIdentity);
  await assert.rejects(receipt("receive"), /Verified native receiver session required/);
  assert.equal(await one(`SELECT has_function_privilege('authenticated',
    'public.stock_transfer_receive_for_staff(uuid,text,text,text,jsonb,text)','execute')`), false);
  await db.exec("SELECT set_config('test.uid','',false),set_config('test.role','service_role',false);");
  await assert.rejects(receipt("receive", "fixture-receiver", "A"), /destination location/);
  await assert.rejects(receipt("receive", "foreign"), /Active transfer receipt permission/);
  await db.exec("UPDATE public.app_users SET permissions='{\"can_receive_transfer\":true}' WHERE user_id='foreign';");
  await assert.rejects(receipt("receive", "foreign"), /destination location/);
  assert.equal((await lifecycle()).status, "dispatched");
  assert.deepEqual(await balance(), { A: 8, B: 0, C: 0 });
  await receipt("receive");
  assert.deepEqual(await lifecycle(), { status: "received", received_by: "Verified Receiver", verified_by: null });
  assert.deepEqual(await balance(), { A: 8, B: 0, C: 0 });
  await assert.rejects(receipt("verify", "fixture-receiver", "B", 1), /discrepancy needs a reason/);
  assert.equal((await lifecycle()).status, "received");
  assert.deepEqual(await balance(), { A: 8, B: 0, C: 0 });
  await receipt("verify");
  assert.deepEqual(await lifecycle(), { status: "completed", received_by: "Verified Receiver", verified_by: "Verified Receiver" });
  assert.deepEqual(await balance(), { A: 8, B: 2, C: 0 });
  await assert.rejects(receipt("verify"), /ALREADY_POSTED/);
  assert.deepEqual(await balance(), { A: 8, B: 2, C: 0 });
  assert.equal(await one("SELECT coalesce(current_setting('pos.native_receiver_transfer',true),'')"), "");
  console.log("PASS native scoped arrival and verification preserve actor attribution, rollback and exactly-once destination stock.");

  const receiptA = (await pull("A", terminalA, proofA, epochA, "1")).groups.filter(group => group.financial?.kind === "transfer_v1");
  const receiptB = (await pull("B", terminalB, proofB, epochB, "1")).groups.filter(group => group.financial?.kind === "transfer_v1");
  assert.equal(receiptA.length, 2);
  assert.equal(receiptB.length, 2);
  const arrivalsA = receiptA.map(group => parseFinancialCorrection(group, "A"));
  const arrivalsB = receiptB.map(group => parseFinancialCorrection(group, "B"));
  assert.deepEqual(arrivalsA.map(group => group.headers[0].status), ["received", "completed"]);
  assert.deepEqual(arrivalsA.map(group => group.headers), arrivalsB.map(group => group.headers));
  assert.deepEqual(arrivalsA.flatMap(group => group.logs), []);
  assert.deepEqual(arrivalsB[0].logs, []);
  assert.deepEqual(arrivalsB[1].logs.map(row => [row.store_id, row.activity_type, row.quantity_delta, row.stock_after]),
    [["B", "transfer_in", 2, 2]]);
  assert.deepEqual(arrivalsB[1].stock, [], "A shared product's destination bucket remains on its existing legacy mirror.");
  assert.throws(() => parseFinancialCorrection(changeGraph(receiptB[1], graph => {
    graph.movements[0].line_id = randomUUID();
  }), "B"), /authorized scope/);
  assert.throws(() => parseFinancialCorrection(changeGraph(receiptB[1], graph => {
    graph.logs[0].store_id = "A";
  }), "B"), /authorized scope/);
  const arrivedCoverage = { table_name: "stock_transfers", id: ids.child, version: receiptB[0].changes[0].row_version };
  const verifiedAudit = { table_name: "item_activity_logs", id: arrivalsB[1].logs[0].id,
    version: String(arrivalsB[1].logs[0].row_version) };
  const owned = await one("SELECT public.pos_sync_extended_legacy_coverage_v1('default','B',$1,$2,$3,$4)",
    [terminalB, proofB, epochB, JSON.stringify([arrivedCoverage, verifiedAudit])]);
  assert.deepEqual(owned.entries, [{ ...verifiedAudit, seq: receiptB[1].seq, owned: true },
    { ...arrivedCoverage, seq: receiptB[0].seq, owned: true }]);
  await one("SELECT pos_sync_feed_v1.retire_groups('default','B',$1,$2)", [epochB, receiptB[1].seq]);
  const archivedB = (await db.query(`SELECT pos_sync_feed_v1.financial_recovery_row(published) AS row
    FROM pos_sync_feed_v1.extended_publications published WHERE scope_id='B' AND seq>1
    AND metadata->'financial'->>'kind'='transfer_v1' ORDER BY seq`)).rows.map(row => row.row);
  assert.deepEqual(archivedB, receiptB);
  console.log("PASS arrival and verification are separately archived in both authorized scopes with destination-only audit and legacy coverage.");

  const ownedTransfer = randomUUID();
  await db.query("UPDATE public.products SET owner_store_id='B' WHERE id=$1", [ids.product2]);
  await db.exec(`SET session_replication_role=replica;
    INSERT INTO public.stock_transfers(id,ref,kind,status,from_store_id,to_store_id,created_by,approved_by,approved_at)
    VALUES('${ownedTransfer}','ST-FIXTURE-OWNED','transfer','approved','A','B','Requester','Approver',now());
    INSERT INTO public.stock_transfer_items(transfer_id,product_id,quantity,quantity_approved)
    VALUES('${ownedTransfer}','${ids.product2}',2,2);
    SET session_replication_role=origin;`);
  await db.exec(webIdentity);
  await one(`SELECT public.stock_transfer_dispatch_atomic($1,'Authorized Dispatcher',$2)`,
    [ownedTransfer, JSON.stringify([{ product_id: ids.product2, qty: 2 }])]);
  await db.query("SELECT set_config('test.uid',$1,false)", [receiver]);
  await one("SELECT public.stock_transfer_receive($1,'Verified Receiver',false,NULL)", [ownedTransfer]);
  const forged = randomUUID();
  await db.exec("BEGIN");
  await db.query(`INSERT INTO public.item_activity_logs(id,product_id,store_id,activity_type,reference,quantity_delta,
    stock_before,stock_after,staff_name) VALUES($1,$2,'B','transfer_in','ST-FIXTURE-OWNED',1,999,1000,'Verified Receiver')`,
    [forged, ids.product2]);
  await one("SELECT public.stock_transfer_verify($1,'Verified Receiver',$2,'One item short')",
    [ownedTransfer, JSON.stringify([{ product_id: ids.product2, qty: 1 }])]);
  await db.exec("COMMIT");
  await db.exec("SELECT set_config('test.uid','',false),set_config('test.role','service_role',false);");
  const scopedOwned = (await pull("B", terminalB, proofB, epochB, receiptB[1].seq)).groups;
  const ownedGroups = scopedOwned.filter(group => group.financial?.transfer_id === ownedTransfer);
  assert.equal(ownedGroups.length, 2);
  const ownedFacts = ownedGroups.map(group => parseFinancialCorrection(group, "B"));
  assert.equal(ownedFacts[1].headers[0].status, "completed_with_discrepancy");
  assert.equal(ownedFacts[1].headers[0].discrepancy_reason, "One item short");
  assert.equal(ownedFacts[1].logs.length, 1);
  assert.notEqual(ownedFacts[1].logs[0].id, forged);
  assert.deepEqual(ownedFacts[1].stock.map(row => [row.product_id, row.branch_balance]), [[ids.product2, 1]]);
  assert.equal(await one(`SELECT seq::text FROM pos_sync_feed_v1.stock_revision_coverage WHERE scope_id='B'
    AND product_id=$1 AND product_version=$2`, [ids.product2, ownedFacts[1].stock[0].row_version]), ownedGroups[1].seq);
  for (const role of ["anon", "authenticated", "service_role"]) {
    assert.equal(await one(`SELECT has_function_privilege($1,
      'pos_sync_feed_v1.publish_transfer_receipt(uuid,jsonb)','execute')`, [role]), false);
  }
  console.log("PASS canonical web verification with discrepancy publishes exact destination-owned stock and excludes a matching forged audit.");

  for (const role of ["anon", "authenticated", "service_role"]) {
    assert.equal(await one(`SELECT has_function_privilege($1,
      'pos_sync_feed_v1.assert_cash_settings_projection()','execute')`, [role]), false);
    assert.equal(await one("SELECT has_schema_privilege($1,'pos_sync_feed_v1','usage')", [role]), false);
  }
  await db.exec("GRANT INSERT ON public.products TO service_role;");
  await db.exec("SET ROLE service_role;");
  try {
    assert.equal(await one("SELECT current_user"), "service_role");
    await assert.rejects(db.query("SELECT pos_sync_feed_v1.assert_cash_settings_projection()"), /permission denied/);
  } finally { await db.exec("RESET ROLE;"); }
  const newProduct = randomUUID();
  const previousHead = await one("SELECT head_seq FROM pos_sync_feed_v1.feed_heads WHERE scope_id='A'");
  await db.exec("BEGIN; SET LOCAL ROLE service_role;");
  await db.query(`INSERT INTO public.products(id,name,sku,barcode,owner_store_id,stock_quantity,stock_by_store)
    VALUES($1,'Service writer test product','FIXTURE-ROLE','FIXTURE-ROLE','A',4,'{"A":4}')`, [newProduct]);
  await db.exec("COMMIT;");
  assert.equal(Number(await one("SELECT head_seq FROM pos_sync_feed_v1.feed_heads WHERE scope_id='A'")), Number(previousHead) + 1);
  const emitted = await one(`SELECT changes->0->'row_data' FROM pos_sync_feed_v1.extended_publications
    WHERE scope_id='A' AND seq=(SELECT head_seq FROM pos_sync_feed_v1.feed_heads WHERE scope_id='A')`);
  assert.equal(emitted.product_id, newProduct);
  assert.equal(emitted.branch_balance, 4);
  console.log("PASS service-role product write commits its deferred private stock group without direct feed access.");
  if (process.argv.includes("--native")) {
    await applyLocal("A", epochA, sending, { successors: arrivalsA });
    await applyLocal("B", epochB, receiving, {
      successors: archivedB.map(group => parseFinancialCorrection(group, "B")), ownedSuccessors: ownedFacts,
    });
    await applyLocal("A", epochA, sending, { pending: true });
    await applyLocal("A", epochA, parseFinancialCorrection(recovery, "A"), { recovering: true });
    console.log("PASS independent LocalDB tills apply dispatch, receipt, verification, owned destination stock and cursors atomically; retries are no-ops.");
    const completed = await one(`SELECT jsonb_build_object(
      'headers',(SELECT jsonb_agg(to_jsonb(t) ORDER BY t.kind) FROM public.stock_transfers t WHERE t.id IN ('${ids.parent}','${ids.child}')),
      'lines',(SELECT jsonb_agg(to_jsonb(i)||jsonb_build_object('unit_cost',i.unit_cost::text) ORDER BY i.id)
        FROM public.stock_transfer_items i WHERE i.transfer_id IN ('${ids.parent}','${ids.child}')),
      'product',(SELECT jsonb_build_object('id',id,'row_version',row_version,'owner_store_id',owner_store_id,
        'stock_quantity',stock_quantity,'stock_by_store',stock_by_store) FROM public.products WHERE id='${ids.product}'))`);
    await applyLocal("A", epochA, parseFinancialCorrection(recovery, "A"), { recovering: true, completed });
  }
} catch (error) {
  console.error(error.message, error.detail ?? "", error.where ?? "");
  process.exitCode = 1;
} finally { await db.close(); }
