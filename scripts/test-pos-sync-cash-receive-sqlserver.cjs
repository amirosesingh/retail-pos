// Receives only the fixture's committed PostgreSQL wire over stdin.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { createLocal } = require("./lib/shift-protocol-integration-fixture.cjs");
const { CloudClient } = require("../electron/sync/cloud-client.cjs");
const { PullWorker } = require("../electron/sync/pull-worker.cjs");
const { ChangeReader } = require("../electron/sync/change-reader.cjs");
const { CheckpointRepository } = require("../electron/sync/checkpoints.cjs");
const { CHECKPOINT } = require("../electron/sync/grouped-cash-receipt.cjs");

async function main() {
  assert.deepEqual(process.argv.slice(2), ["--run"]);
  const { receipt, terminal: origin } = JSON.parse(readFileSync(0, "utf8"));
  const branch = receipt.scope_id;
  const epoch = receipt.epoch;
  const [sale, item, tender, movement] = receipt.changes.map(change => change.row_data);
  const terminal = randomUUID();
  assert.equal(tender.terminal_id, origin);
  const local = await createLocal(branch, { extraTables: ["products", "item_activity_logs"] });
  const { manager, registry } = local;
  manager.profile = { id: "owned-cash-receiver", host: "owned-private-pipe", database: "owned-cash-receiver" };
  try {
    const cloud = new CloudClient({ configStore: { get: () => "https://owned-cash-receiver.invalid" },
      terminalStore: { read: () => ({ tokenId: terminal, locationId: branch, deviceUse: "operations", deviceType: "pc",
        deviceBindingProof: "b".repeat(64) }) }, connectionManager: manager,
      financialBasisContext: () => ({ branchId: branch, projectOrigin: "https://owned-project.invalid" }) });
    const checkpoints = new CheckpointRepository(manager);
    const worker = new PullWorker({ connectionManager: manager, cloud, registry, checkpoints,
      reader: new ChangeReader(manager, registry) });
    const run = (candidate = receipt) => worker.applyGroupedCashReceipt({ receipt: candidate, epoch });
    const position = async () => JSON.parse((await checkpoints.get(branch, CHECKPOINT, "pull"))?.committed_cursor ?? "null");
    const state = async () => (await manager.pool.request().input("product", item.product_id).query(`
      SELECT (SELECT count(*) FROM dbo.sales) sales, (SELECT count(*) FROM dbo.sale_items) lines,
        (SELECT count(*) FROM dbo.payment_transactions) tenders, (SELECT count(*) FROM dbo.item_activity_logs) movements,
        (SELECT stock_quantity FROM dbo.products WHERE id=@product) stock;`)).recordset[0];
    const empty = { sales: 0, lines: 0, tenders: 0, movements: 0, stock: 42 };
    const complete = { sales: 1, lines: 1, tenders: 1, movements: 1, stock: 42 };

    await local.insert("products", { id: item.product_id, owner_store_id: branch, stock_quantity: 42 });
    await checkpoints.save(branch, "__feed__", "pull", { committed_cursor: "98" });
    await assert.rejects(run({ ...receipt, scope_id: "outside-fixture" }), { code: "ESYNC_CASH_RECEIPT_PROTOCOL" });
    await assert.rejects(run({ ...receipt, seq: "2" }), { code: "ESYNC_CASH_RECEIPT_PROTOCOL" });
    await assert.rejects(run(), { code: "ESYNC_CASH_RECEIPT_DEPENDENCY" });
    assert.equal(await position(), null);
    assert.deepEqual(await state(), empty);

    await local.insert("shifts", { id: sale.shift_id, store_id: branch, terminal_id: origin, state: "ACTIVE", status: "OPEN", row_version: 1 });
    const draft = randomUUID();
    await local.insert("held_orders", { id: draft, store_id: branch, bill_no: sale.bill_number, status: "held" });
    await assert.rejects(run(), { code: "ESYNC_CASH_RECEIPT_DEPENDENCY" });
    await manager.pool.request().input("id", draft).query("UPDATE dbo.held_orders SET status=N'completed' WHERE id=@id;");
    const pendingKey = JSON.stringify({ id: movement.id });
    await manager.pool.request().input("key", pendingKey).input("branch", branch).query(`
      INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version)
      VALUES(N'item_activity_logs',@key,N'insert',@branch,1);`);
    await assert.rejects(run(), { code: "ELOCAL_UPLOAD_PENDING" });
    assert.deepEqual(await state(), empty);
    assert.equal(await position(), null);
    await manager.pool.request().input("key", pendingKey).query(`
      UPDATE dbo.sync_change_journal SET acknowledged_at=SYSDATETIMEOFFSET() WHERE entity_id=@key;`);

    const save = checkpoints.save.bind(checkpoints);
    checkpoints.save = async (...args) => {
      await save(...args);
      throw Error("fixture receipt checkpoint failure");
    };
    try { await assert.rejects(run(), /fixture receipt checkpoint failure/); }
    finally { checkpoints.save = save; }
    assert.deepEqual(await state(), empty);
    assert.equal(await position(), null);

    assert.deepEqual(await run(), { status: "OK", seq: "1", applied: 4 });
    assert.equal((await position()).seq, "1");
    assert.equal((await checkpoints.get(branch, "__feed__", "pull")).committed_cursor, "98");
    assert.deepEqual(await state(), complete);
    const read = await manager.pool.request().input("tender", tender.id).input("movement", movement.id).query(`
      SELECT CONVERT(nvarchar(80),amount) amount FROM dbo.payment_transactions WHERE id=@tender;
      SELECT quantity_delta FROM dbo.item_activity_logs WHERE id=@movement;
      SELECT CONVERT(varchar(32),SYS_CHANGE_CONTEXT,2) AS context
        FROM CHANGETABLE(CHANGES dbo.item_activity_logs,0) AS ct WHERE ct.id=@movement;
      SELECT count(*) AS n FROM dbo.sync_change_journal WHERE acknowledged_at IS NULL;`);
    const [whole, fraction = ""] = tender.amount.split(".");
    assert.equal(read.recordsets[0][0].amount, `${whole}.${fraction.padEnd(12, "0")}`);
    assert.equal(read.recordsets[1][0].quantity_delta, movement.quantity_delta);
    assert.deepEqual(read.recordsets[2], [{ context: "434C4F5544" }]);
    assert.deepEqual(read.recordsets[3], [{ n: 0 }]);

    await local.restart();
    assert.deepEqual(await run(), { status: "POSITION_ALREADY_ADVANCED", seq: "1" });
    assert.deepEqual(await state(), complete);
    console.log("PASS committed PostgreSQL cash receipt applied atomically to a second LocalDB, with dependency and pending-work fences, no stock effect or echo, and restart-safe replay");
  } finally { await local.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
