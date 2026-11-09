// Receives only the fixture's committed PostgreSQL wire over stdin.
const assert = require("node:assert/strict");
const { createHash, generateKeyPairSync, randomUUID, sign } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { createLocal } = require("./lib/shift-protocol-integration-fixture.cjs");
const { CloudClient } = require("../electron/sync/cloud-client.cjs");
const { PullWorker } = require("../electron/sync/pull-worker.cjs");
const { ChangeReader } = require("../electron/sync/change-reader.cjs");
const { CheckpointRepository } = require("../electron/sync/checkpoints.cjs");
const { CHECKPOINT } = require("../electron/sync/grouped-cash-receipt.cjs");
const grouped = require("../electron/sync/grouped-store-settings.cjs");
const { SaleEventOutbox } = require("../electron/db/sale-event-outbox.cjs");
const { cashCheckoutMessage } = require("../electron/security/financial-author-protocol.cjs");

const digest = value => createHash("sha256").update(value, "utf8").digest("hex");

function nextReceipt(previous, seq, terminal, databaseGuid, shiftId) {
  const changes = structuredClone(previous.changes);
  const [sale, item, tender, movement] = changes.map(change => change.row_data);
  for (const change of changes) {
    change.row_data.id = randomUUID();
    change.entity_id = JSON.stringify({ id: change.row_data.id });
  }
  sale.bill_number = `Fixture-${sale.id}`;
  sale.client_transaction_id = randomUUID();
  sale.shift_id = shiftId;
  sale.payments[0].id = tender.id;
  item.sale_id = tender.sale_id = sale.id;
  tender.shift_id = shiftId;
  tender.terminal_id = movement.terminal_id = terminal;
  movement.reference = sale.bill_number;
  const checkoutJson = JSON.stringify({ sale, item, tender, movement });
  return { seq, operation_id: randomUUID(), changes, acceptance: {
    terminal_id: terminal, installation_generation: randomUUID(), database_guid: databaseGuid, checkout_sha256: digest(checkoutJson),
  } };
}

async function freezeOrigin(local, group, branch, epoch, terminal) {
  const { manager, registry } = local;
  const [sale, item, tender, movement] = group.changes.map(change => change.row_data);
  for (const { table_name, row_data } of group.changes) await local.insert(table_name, row_data);
  const scope = { branchId: branch, terminalId: terminal, feedEpoch: epoch,
    databaseGuid: group.acceptance.database_guid, installationGeneration: group.acceptance.installation_generation };
  const checkoutJson = JSON.stringify({ sale, item, tender, movement });
  const proof = {
    version: 1, algorithm: "Ed25519", projectOrigin: "https://owned-project.invalid", terminalId: terminal,
    authorId: randomUUID(), keyId: randomUUID(), subject: "fixture cashier", branchId: branch,
    installationGeneration: scope.installationGeneration, databaseGuid: scope.databaseGuid, feedEpoch: epoch,
    operationId: group.operation_id, payloadHash: digest(checkoutJson),
  };
  const { privateKey } = generateKeyPairSync("ed25519");
  const attestation = { ...proof, signature: sign(null, Buffer.from(cashCheckoutMessage(proof)), privateKey).toString("base64url") };
  const payload = JSON.stringify({ eventType: "SaleCompleted", version: 1, operationId: group.operation_id,
    branchId: branch, terminalId: terminal, shiftId: sale.shift_id, sale: { id: sale.id },
    bridge: { scope, checkoutJson, attestation } });
  for (const file of ["pos-sale-outbox-v1.sql", "pos-sale-acceptance-v1.sql"])
    await manager.pool.request().batch(readFileSync(join(__dirname, "preparation", file), "utf8"));
  await manager.pool.request().input("operation", group.operation_id).input("branch", branch).input("terminal", terminal)
    .input("shift", sale.shift_id).input("sale", sale.id).input("payload", payload).input("hash", digest(payload)).query(`
      INSERT dbo.pos_sync_sale_outbox_v1(operation_id,branch_id,terminal_id,shift_id,sale_id,payload_json,payload_hash)
      VALUES(@operation,@branch,@terminal,@shift,@sale,@payload,@hash);`);
  const outbox = new SaleEventOutbox(manager, registry, { cashBridge: scope });
  const wire = await outbox.readBridgeCheckout(group.operation_id);
  return () => outbox.recordBridgeAcceptance(wire, { status: "APPLIED", result: {
    ...group.acceptance, operation_id: group.operation_id, sale_id: sale.id, scope_id: branch, epoch, seq: group.seq,
    author_id: proof.authorId, author_key_id: proof.keyId,
  } });
}

async function verifyMixed(local, worker, checkpoints, receipt, origin, terminal, state) {
  const { manager, registry } = local;
  const { scope_id: branch, epoch } = receipt;
  const priorFetch = globalThis.fetch;
  const databaseGuid = await grouped.readDatabaseGuid(manager.pool.request());
  const enrollment = grouped.pilotEnrollment({
    branchId: branch, terminalId: terminal, projectOrigin: "https://owned-project.invalid",
    backendOrigin: "https://owned-cash-receiver.invalid", databaseGuid, projection: grouped.MIXED_PROJECTION,
  });
  assert(enrollment);
  const settings = version => {
    const table = registry.tables.find(item => item.cloudTable === grouped.TABLE);
    const base = Object.fromEntries(table.columns.map(column => [column.cloudColumn, column.nullable ? null : false]));
    return { table_name: grouped.TABLE, entity_id: JSON.stringify({ store_id: branch }), tombstone: false,
      row_version: String(version), row_data: { ...base, store_id: branch, row_version: String(version),
        idle_timeout_minutes: 7, max_drawer_cash_limit: "9007199254740993.123456789123",
        created_at: "2026-11-07T09:30:00.1234567Z", updated_at: `2026-11-07T09:30:0${version}.1234567Z`,
        updated_by: "fixture operator" } };
  };
  const snapshot = (seq, version, groups) => {
    const manifest_json = JSON.stringify({ scope_id: branch, epoch, seq, changes: [settings(version)],
      ...(groups ? { cash_groups: groups } : {}) });
    return { status: "OK", scope_id: branch, epoch, seq, pin_id: randomUUID(),
      expires_at: new Date(Date.now() + 60_000).toISOString(), manifest_json, manifest_sha256: digest(manifest_json) };
  };
  const page = (...groups) => ({ status: "OK", scope_id: branch, epoch,
    next_seq: groups.at(-1).seq, upper_seq: groups.at(-1).seq, has_more: false, groups });
  const first = { seq: receipt.seq, operation_id: receipt.operation_id, changes: receipt.changes, acceptance: {
    terminal_id: origin, installation_generation: randomUUID(), database_guid: randomUUID(), checkout_sha256: "a".repeat(64),
  } };
  const second = nextReceipt(first, "3", origin, randomUUID(), receipt.changes[0].row_data.shift_id);
  const position = async () => JSON.parse((await checkpoints.get(branch, grouped.MIXED_CHECKPOINT, "pull"))?.committed_cursor ?? "null");
  const localRules = async () => (await manager.pool.request().input("branch", branch)
    .query("SELECT row_version FROM dbo.pos_store_settings WHERE store_id=@branch;")).recordset[0]?.row_version;
  let reply = snapshot("0", 1);
  let mixed = false;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    const read = body.sqlServerGroupedSnapshot ?? body.sqlServerGroupedFeed;
    assert.equal(read.branchId, branch);
    assert.equal(read.projection, mixed ? grouped.MIXED_PROJECTION : undefined);
    return Response.json(reply);
  };
  try {
    await worker.installGroupedSettingsSnapshot();
    mixed = true;
    await assert.rejects(worker.prepareGroupedSettingsHandoff(enrollment), { code: "ESYNC_GROUPED_PROTOCOL" });
    assert.equal(await position(), null);
    reply = snapshot("1", 1, [first]);
    await worker.prepareGroupedSettingsHandoff(enrollment);
    assert.equal((await position()).seq, "1");
    const context = { ...await worker.groupedSettingsContext(enrollment), handoff: "required" };
    const pull = () => worker.pullGroupedSettingsPageFor(context, 10);
    const settingGroup = { seq: "2", operation_id: null, changes: [settings(2)] };
    reply = page(settingGroup, second);
    const save = checkpoints.save.bind(checkpoints);
    checkpoints.save = async (...args) => {
      await save(...args);
      if (args[1] === grouped.MIXED_CHECKPOINT && JSON.parse(args[3].committed_cursor).seq === "3")
        throw Error("fixture mixed checkpoint failure");
    };
    try { await assert.rejects(pull(), /fixture mixed checkpoint failure/); }
    finally { checkpoints.save = save; }
    assert.equal((await position()).seq, "2");
    assert.equal(await localRules(), 2);
    assert.equal((await state()).sales, 1);
    reply = page(second);
    assert.deepEqual(await pull(), { status: "OK", merged: 4, seq: "3", hasMore: false });
    assert.equal((await state()).sales, 2);
    assert.equal((await state()).stock, 42);

    const missingShift = randomUUID();
    const third = nextReceipt(second, "5", origin, randomUUID(), missingShift);
    reply = snapshot("5", 3, [first, second, third]);
    await assert.rejects(worker.installGroupedSettingsSnapshotFor(context, null, true), { code: "ESYNC_CASH_RECEIPT_DEPENDENCY" });
    assert.equal((await position()).seq, "3");
    assert.equal(await localRules(), 2);
    assert.equal((await state()).sales, 2);
    await local.insert("shifts", { id: missingShift, store_id: branch, terminal_id: origin, state: "ACTIVE", status: "OPEN" });
    await worker.installGroupedSettingsSnapshotFor(context, null, true);
    assert.equal(await localRules(), 3);
    assert.equal((await state()).sales, 3);
    assert.equal((await position()).seq, "5");

    const ownShift = randomUUID();
    await local.insert("shifts", { id: ownShift, store_id: branch, terminal_id: terminal, state: "ACTIVE", status: "OPEN" });
    const own = nextReceipt(third, "6", terminal, databaseGuid, ownShift);
    const accept = await freezeOrigin(local, own, branch, epoch, terminal);
    // An independent, later local change must survive this sender replay.
    await manager.pool.request().input("id", own.changes[0].row_data.id)
      .query("UPDATE dbo.sales SET total_amount=77.10,row_version=2 WHERE id=@id;");
    reply = page(own);
    assert.deepEqual(await pull(), { status: "DEFERRED", reason: "ELOCAL_UPLOAD_PENDING", merged: 0, seq: "5", hasMore: true });
    await accept();
    reply = page({ ...own, acceptance: { ...own.acceptance, checkout_sha256: "b".repeat(64) } });
    assert.equal((await pull()).status, "DEFERRED");
    const drift = structuredClone(own);
    drift.changes[3].row_data.id = randomUUID();
    drift.changes[3].entity_id = JSON.stringify({ id: drift.changes[3].row_data.id });
    reply = page(drift);
    assert.equal((await pull()).status, "DEFERRED");
    reply = page(own);
    assert.deepEqual(await pull(), { status: "OK", merged: 0, seq: "6", hasMore: false });
    const saved = await manager.pool.request().input("id", own.changes[0].row_data.id)
      .query("SELECT row_version,total_amount FROM dbo.sales WHERE id=@id;");
    assert.deepEqual(saved.recordset, [{ row_version: 2, total_amount: 77.1 }]);
    assert.equal((await state()).sales, 4);
    await assert.rejects(worker.returnGroupedSettingsHandoff(enrollment), { code: "ESYNC_GROUPED_REVIEW_REQUIRED" });
    await assert.rejects(worker.pullGroupedSettingsPage(), { code: "ESYNC_GROUPED_REVIEW_REQUIRED" });
    await local.restart();
    assert.equal((await position()).seq, "6");
    assert.equal((await checkpoints.get(branch, grouped.CHECKPOINT, "pull")).committed_cursor.includes('"seq":"0"'), true);
    assert.equal((await checkpoints.get(branch, "__feed__", "pull")).committed_cursor, "98");
    console.log("PASS mixed settings and cash use one durable position, recover atomically, and acknowledge verified sender replay without writes");
  } finally { globalThis.fetch = priorFetch; }
}

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
    await verifyMixed(local, worker, checkpoints, receipt, origin, terminal, state);
  } finally { await local.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
