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
const pull = (branch, terminal, proof, epoch) => one(
  "SELECT public.pos_sync_pull_cash_settings_extended_v1('default',$1,$2,$3,$4,'0',NULL,20)",
  [branch, terminal, proof, epoch]);
const changeGraph = (group, edit) => {
  const copy = structuredClone(group);
  const row = copy.changes[0].row_data;
  const graph = JSON.parse(row.graph_json);
  edit(graph);
  row.graph_json = JSON.stringify(graph);
  row.graph_sha256 = createHash("sha256").update(row.graph_json).digest("hex");
  return copy;
};

async function applyLocal(branch, epoch, facts, { pending = false, recovering = false } = {}) {
  const local = await createLocal(branch, { extraTables: ["stock_transfers", "stock_transfer_items", "products", "item_activity_logs"] });
  try {
    const { manager, registry } = local;
    await manager.pool.request().batch(await preparation("pos-sync-live-stock-native-v1"));
    await local.insert("products", { id: ids.product, row_version: 1, owner_store_id: "A", stock_quantity: 14, stock_by_store: { A: 10, B: 4 } });
    await manager.pool.request().batch(`
      ALTER TABLE dbo.stock_transfers ADD FOREIGN KEY(source_request_id) REFERENCES dbo.stock_transfers(id);
      ALTER TABLE dbo.stock_transfer_items ADD FOREIGN KEY(transfer_id) REFERENCES dbo.stock_transfers(id),
        FOREIGN KEY(product_id) REFERENCES dbo.products(id);`);
    const checkpoint = new CheckpointRepository(manager);
    const current = () => manager.pool.request().query("SELECT CHANGE_TRACKING_CURRENT_VERSION() AS version;");
    for (const name of ["stock_transfers", "stock_transfer_items", "products", "item_activity_logs"]) {
      await checkpoint.save(branch, name, "push", { change_tracking_version: (await current()).recordset[0].version });
    }
    const worker = { registry, connectionManager: manager, reader: new ChangeReader(manager, registry) };
    const sql = manager.sql();
    const apply = async ({ writePin = false } = {}) => {
      const tx = new sql.Transaction(manager.pool);
      await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      try {
        if (writePin) await applyGroupedStock(worker, tx, branch,
          [{ ...facts.stock[0], row_version: facts.stock[0].row_version + 1, branch_balance: 5 }],
          { epoch, seq: "2", recovery: true });
        const count = await applyFinancialCorrection(worker, tx, { branch, financialEpoch: epoch, recoveringFinancial: recovering }, facts);
        await checkpoint.save(branch, "fixture_transfer", "pull", { committed_cursor: facts.seq }, tx);
        await tx.commit();
        return count;
      } catch (error) {
        await tx.rollback().catch(() => {});
        throw error;
      }
    };
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
    const result = await manager.pool.request().query(`
      SELECT status FROM dbo.stock_transfers ORDER BY kind;
      SELECT COUNT(*) AS count FROM dbo.stock_transfer_items;
      SELECT COUNT(*) AS count FROM dbo.item_activity_logs;
      SELECT stock_by_store FROM dbo.products;`);
    assert.deepEqual(result.recordsets[0].map(row => row.status), ["completed", "dispatched"]);
    assert.equal(result.recordsets[1][0].count, 2);
    assert.equal(result.recordsets[2][0].count, branch === "A" ? 1 : 0);
    assert.deepEqual(JSON.parse(result.recordsets[3][0].stock_by_store), { A: branch === "A" ? recovering ? 5 : 8 : 10, B: 4 });
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
  await db.exec(seedSql());
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
  await db.exec(webIdentity);
  console.log("PASS atomic dispatch publishes once to both scopes, retires to a recovery archive, and keeps stock and audit in the sending scope.");
  if (process.argv.includes("--native")) {
    await applyLocal("A", epochA, sending);
    await applyLocal("B", epochB, receiving);
    await applyLocal("A", epochA, sending, { pending: true });
    await applyLocal("A", epochA, parseFinancialCorrection(recovery, "A"), { recovering: true });
    console.log("PASS independent LocalDB tills apply the group and cursor atomically, retry without writes, and preserve newer pinned stock.");
  }
} catch (error) {
  console.error(error.message, error.detail ?? "", error.where ?? "");
  process.exitCode = 1;
} finally { await db.close(); }
