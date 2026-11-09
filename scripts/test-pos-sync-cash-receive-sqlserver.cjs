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
  const journal = [];
  for (const [table, id] of [["sales", sale.id], ["sale_items", item.id], ["payment_transactions", tender.id],
    ["item_activity_logs", movement.id], ["products", item.product_id]]) {
    const entity = JSON.stringify({ id });
    const operation = table === "products" ? "update" : "insert";
    const { recordset } = await manager.pool.request().input("aggregate", group.operation_id).input("branch", branch)
      .input("table", table).input("entity", entity).input("operation", operation).query(`
        INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version,aggregate_id)
        OUTPUT CONVERT(varchar(20),inserted.change_id) AS id VALUES(@table,@entity,@operation,@branch,1,@aggregate);`);
    journal.push({ id: recordset[0].id, table, entity, operation, version: "1" });
  }
  const payload = JSON.stringify({ eventType: "SaleCompleted", version: 1, operationId: group.operation_id,
    branchId: branch, terminalId: terminal, shiftId: sale.shift_id, sale: { id: sale.id },
    bridge: { scope, checkoutJson, attestation, journal } });
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

    const original = { ...first.changes[0], cursor: 99 };
    const unrelated = { ...nextReceipt(first, "7", origin, randomUUID(), receipt.changes[0].row_data.shift_id).changes[0], cursor: 100 };
    const { cloud } = worker;
    const priorPull = cloud.pullBatch, priorCoverage = cloud.cashLegacyCoverage;
    let legacyRows = [original, unrelated];
    let ownedSeq = "1";
    cloud.pullBatch = async () => ({ rows: legacyRows, tombstones: [], count: legacyRows.length, cursor: legacyRows.at(-1).cursor });
    cloud.cashLegacyCoverage = async (_source, expectedEpoch, entries) => {
      assert.equal(expectedEpoch, epoch);
      const identity = { table_name: "sales", id: original.row_data.id };
      assert(entries.some(entry => entry.id === identity.id));
      return { status: "OK", scope_id: branch, epoch, entries: [{ ...identity, seq: ownedSeq }] };
    };
    try {
      const run = value => worker.run({ branchId: branch, skipMembership: true }, value);
      assert.equal((await run(enrollment)).merged, 1);
      assert.equal((await state()).sales, 5);
      assert.equal((await checkpoints.get(branch, "__feed__", "pull")).committed_cursor, "100");
      legacyRows = [{ ...original, cursor: 101, row_version: "2",
        row_data: { ...original.row_data, row_version: "2", total_amount: "55.00" } }];
      ownedSeq = "10";
      assert.equal((await run(enrollment)).deferredLocalChanges, true);
      await assert.rejects(run(null), { code: "ESYNC_CASH_LEGACY_COVERAGE" });
      assert.equal((await checkpoints.get(branch, "__feed__", "pull")).committed_cursor, "100");
      assert.equal((await position()).seq, "6");
      ownedSeq = "1";
      assert.equal((await run(enrollment)).merged, 1);
      assert.equal((await checkpoints.get(branch, "__feed__", "pull")).committed_cursor, "101");
      console.log("PASS legacy download skips the archived receipt birth, preserves unrelated rows, and orders corrections after grouped delivery");
    } finally {
      cloud.pullBatch = priorPull;
      cloud.cashLegacyCoverage = priorCoverage;
    }
  } finally { globalThis.fetch = priorFetch; }
}

async function verifyPagedRecovery(receipt, origin) {
  const { scope_id: branch, epoch } = receipt;
  const terminal = randomUUID();
  const local = await createLocal(branch, { extraTables: ["products", "item_activity_logs", "stock_delta_applied"] });
  const { manager, registry } = local;
  const profile = "owned-paged-recovery";
  const backend = "https://owned-paged-recovery.invalid";
  const project = "https://owned-project.invalid";
  manager.profile = { id: profile, host: "owned-private-pipe", database: profile };
  const fetchBefore = globalThis.fetch;
  try {
    const cloud = new CloudClient({ configStore: { get: () => backend },
      terminalStore: { read: () => ({ tokenId: terminal, locationId: branch, deviceUse: "operations", deviceType: "pc",
        deviceBindingProof: "b".repeat(64) }) }, connectionManager: manager,
      financialBasisContext: () => ({ branchId: branch, projectOrigin: project }) });
    const checkpoints = new CheckpointRepository(manager);
    const worker = new PullWorker({ connectionManager: manager, cloud, registry, checkpoints,
      reader: new ChangeReader(manager, registry) });
    const [sale, item] = receipt.changes.map(change => change.row_data);
    const product = item.product_id;
    const otherProduct = randomUUID();
    const pinId = randomUUID(), seq = "3";
    const expires = new Date(Date.now() + 300_000).toISOString();
    const cash = [{ seq: receipt.seq, operation_id: receipt.operation_id, changes: receipt.changes, acceptance: {
      terminal_id: origin, installation_generation: randomUUID(), database_guid: randomUUID(), checkout_sha256: "a".repeat(64),
    } }];
    cash.push(nextReceipt(cash[0], seq, origin, randomUUID(), sale.shift_id));
    const stock = [{ product_id: product, branch_balance: 3, row_version: 2 },
      { product_id: otherProduct, branch_balance: 5, row_version: 2 }]
      .sort((a, b) => a.product_id.localeCompare(b.product_id));
    const settingsTable = registry.tables.find(table => table.cloudTable === grouped.TABLE);
    const setting = { table_name: grouped.TABLE, entity_id: JSON.stringify({ store_id: branch }), tombstone: false,
      row_version: "1", row_data: { ...Object.fromEntries(settingsTable.columns.map(col => [col.cloudColumn, col.nullable ? null : false])),
        store_id: branch, row_version: "1", idle_timeout_minutes: 7, max_drawer_cash_limit: "45",
        created_at: "2026-11-07T09:30:00.1234567Z", updated_at: "2026-11-07T09:30:00.1234567Z", updated_by: "fixture" } };
    const manifest = JSON.stringify({ scope_id: branch, epoch, seq, changes: [setting], cash_count: "2", stock_count: "2" });
    const identity = { status: "OK", scope_id: branch, epoch, seq, pin_id: pinId, expires_at: expires };
    let badDigest = true;
    let interruptStock = false;
    const requests = [];
    globalThis.fetch = async (_url, options) => {
      const read = JSON.parse(options.body).sqlServerGroupedRecovery;
      requests.push(read.action === "begin" ? "begin" : [read.kind, read.after].join(":"));
      assert.equal(read.branchId, branch);
      if (read.action === "begin") return Response.json({ ...identity, manifest_json: manifest, manifest_sha256: digest(manifest) });
      if (interruptStock && read.kind === "stock") throw new TypeError("fixture interrupted stock download");
      const index = Number(read.after);
      assert.equal(read.pinId, pinId);
      const payload = JSON.stringify({ scope_id: branch, epoch, seq, pin_id: pinId, kind: read.kind,
        after: read.after, next: String(index + 1), total: "2", rows: [(read.kind === "cash" ? cash : stock)[index]] });
      return Response.json({ ...identity, payload_json: payload,
        payload_sha256: badDigest && read.kind === "stock" ? "0".repeat(64) : digest(payload) });
    };
    await manager.pool.request().batch(readFileSync(join(__dirname, "preparation", "pos-sync-cash-settings-recovery-stage-v1.sql"), "utf8"));
    await local.insert("products", { id: product, owner_store_id: branch, row_version: 1, stock_quantity: 42,
      stock_by_store: { [branch]: 5, "preserved-foreign": 37 } });
    await local.insert("products", { id: otherProduct, owner_store_id: branch, row_version: 1,
      stock_quantity: 5, stock_by_store: { [branch]: 5 } });
    await local.insert("shifts", { id: sale.shift_id, store_id: branch, terminal_id: origin, state: "ACTIVE", status: "OPEN" });
    const start = (await manager.pool.request().query("SELECT CHANGE_TRACKING_CURRENT_VERSION() AS version;")).recordset[0].version;
    await checkpoints.save(branch, "products", "push", { change_tracking_version: start });
    const enrollment = grouped.pilotEnrollment({ branchId: branch, terminalId: terminal, projectOrigin: project, backendOrigin: backend,
      databaseGuid: await grouped.readDatabaseGuid(manager.pool.request()), projection: grouped.MIXED_PROJECTION, recovery: "paged_stock_v1" });
    assert(enrollment);
    const run = async () => worker.installGroupedSettingsSnapshotFor(await worker.groupedSettingsContext(enrollment));
    const state = async () => (await manager.pool.request().input("id", product).query(`
      SELECT stock_quantity,stock_by_store,row_version,(SELECT COUNT(*) FROM dbo.sales) AS sales,
        (SELECT COUNT(*) FROM dbo.pos_sync_cash_settings_recovery_pages_v1) AS stages
      FROM dbo.products WHERE id=@id;`)).recordset[0];
    const position = () => checkpoints.get(branch, grouped.MIXED_CHECKPOINT, "pull");
    await assert.rejects(run(), { code: "ESYNC_GROUPED_PROTOCOL" });
    assert.equal(await position(), null);
    assert.equal((await state()).stages, 0);
    badDigest = false;
    interruptStock = true;
    await assert.rejects(run());
    assert.equal((await state()).stages, 2);
    assert.equal(await position(), null);
    await local.restart();
    interruptStock = false;
    const beforeResume = requests.length;
    const key = JSON.stringify({ id: product });
    await manager.pool.request().input("branch", branch).input("key", key).query(`
      INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version)
      VALUES(N'products',@key,N'update',@branch,1);`);
    await assert.rejects(run(), { code: "ELOCAL_UPLOAD_PENDING" });
    assert.deepEqual(requests.slice(beforeResume), ["begin", "stock:0", "stock:1"]);
    assert.equal(await position(), null);
    assert.equal((await state()).sales, 0);
    assert.equal((await state()).stock_quantity, 42);
    await manager.pool.request().input("key", key)
      .query("UPDATE dbo.sync_change_journal SET acknowledged_at=SYSUTCDATETIME() WHERE entity_id=@key;");
    await manager.pool.request().input("id", product)
      .query("UPDATE dbo.products SET stock_quantity=43 WHERE id=@id;");
    await assert.rejects(run(), { code: "ELOCAL_UPLOAD_PENDING" });
    assert.equal((await state()).stock_quantity, 43);
    await manager.pool.request().input("id", product).query(`
      WITH CHANGE_TRACKING_CONTEXT (0x434C4F5544) UPDATE dbo.products SET stock_quantity=42 WHERE id=@id;`);

    const save = checkpoints.save.bind(checkpoints);
    checkpoints.save = async (...args) => {
      await save(...args);
      if (args[1] === grouped.MIXED_CHECKPOINT) throw Error("fixture paged recovery checkpoint failure");
    };
    try { await assert.rejects(run(), /fixture paged recovery checkpoint failure/); }
    finally { checkpoints.save = save; }
    assert.equal(await position(), null);
    assert.equal((await state()).sales, 0);
    assert.equal((await state()).stock_quantity, 42);
    assert.deepEqual(await run(), { epoch, seq, changed: true });
    const installed = await state();
    assert.equal(installed.stock_quantity, 40);
    assert.deepEqual(JSON.parse(installed.stock_by_store), { [branch]: 3, "preserved-foreign": 37 });
    assert.equal(installed.row_version, 1);
    assert.equal(installed.sales, 2);
    assert.equal(installed.stages, 0);
    assert.equal(JSON.parse((await position()).committed_cursor).seq, seq);
    assert.equal(requests.at(-1), "begin");
    const tracked = await manager.pool.request().input("start", start).input("id", product).query(`
      SELECT CONVERT(varchar(32),SYS_CHANGE_CONTEXT,2) AS context
      FROM CHANGETABLE(CHANGES dbo.products,@start) AS ct WHERE ct.id=@id;`);
    assert.deepEqual(tracked.recordset, [{ context: "434C4F5544" }]);
    const sql = manager.sql();
    const download = new sql.Transaction(manager.pool);
    await download.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      const products = registry.tables.find(table => table.cloudTable === "products");
      await worker.applyTable(download, products, [{ entity_id: key, tombstone: false,
        row_data: { id: product, stock_quantity: 45, stock_by_store: { [branch]: 8, "preserved-foreign": 37 }, row_version: 3 } }],
      branch);
      await download.commit();
    } catch (error) {
      await download.rollback().catch(() => {});
      throw error;
    }
    const newer = await state();
    assert.equal(newer.row_version, 3);
    assert.equal(newer.stock_quantity, 45);
    const priorPosition = (await position()).committed_cursor;
    await assert.rejects(run(), { code: "ESYNC_GROUPED_REVIEW_REQUIRED" });
    assert.deepEqual(await state(), { ...newer, stages: 4 });
    assert.equal((await position()).committed_cursor, priorPosition);
    await local.restart();
    assert.equal(JSON.parse((await position()).committed_cursor).seq, seq);
    console.log("PASS paged mixed LocalDB recovery preserves pending work, newer cloud stock, and foreign stock, and commits receipts, stock and cursor atomically");

    for (const file of ["pos-sale-outbox-v1.sql", "pos-sale-acceptance-v1.sql",
      "pos-sync-live-stock-native-v1.sql", "pos-sync-refund-native-receipt-v1.sql"])
      await manager.pool.request().batch(readFileSync(join(__dirname, "preparation", file), "utf8"));
    await checkpoints.save(branch, "__feed__", "pull", { committed_cursor: "43" });
    const extended = { ...enrollment, extended: true };
    const env = { POS_GROUPED_SETTINGS_PILOT_MODE: "run", POS_GROUPED_SETTINGS_PILOT_ENROLLMENT: JSON.stringify(extended) };
    const activePilot = grouped.installedGroupedSettingsPilot(env);
    assert.equal(activePilot?.enrollment.extended, true);
    const source = cloud.requestContext(false);
    const installationGeneration = randomUUID();
    const proof = { source, branchId: branch, terminalId: terminal, databaseGuid: enrollment.databaseGuid,
      feedEpoch: epoch, installationGeneration, writingNew: true };
    assert.equal(await worker.cashSenderHandoff(proof, activePilot), false);

    const tender = cash[0].changes[2].row_data;
    const tenderChange = (table, id, row_data) => ({ table_name: table, entity_id: JSON.stringify({ id }),
      row_version: "2", tombstone: false, row_data });
    const correction = { seq: "4", operation_id: randomUUID(), financial: { kind: "tender_v1", sale_id: sale.id },
      changes: [tenderChange("sales", sale.id, { id: sale.id, store_id: branch, row_version: 2,
        payment_type: "card", payments_count: 1 }),
      tenderChange("payment_transactions", tender.id, { id: tender.id, sale_id: sale.id, store_id: branch,
        row_version: 2, method: "card", updated_at: "2026-11-07T09:30:00.1234567Z" })] };
    const extendedStock = stock.map(row => row.product_id === product ? { ...row, row_version: 3, branch_balance: 8 } : row);
    const extendedIdentity = { ...identity, seq: "4", pin_id: randomUUID() };
    const extendedManifest = JSON.stringify({ ...JSON.parse(manifest), seq: "4", financial_count: "1",
      cash_installation: { generation: installationGeneration, database_guid: enrollment.databaseGuid } });
    globalThis.fetch = async (_url, options) => {
      const read = JSON.parse(options.body).sqlServerGroupedRecovery;
      assert.equal(read.extended, true);
      if (read.action === "begin") {
        assert.equal(read.atLeastSeq, seq);
        return Response.json({ ...extendedIdentity, manifest_json: extendedManifest, manifest_sha256: digest(extendedManifest) });
      }
      const rows = { cash, financial: [correction], stock: extendedStock }[read.kind];
      const payload = JSON.stringify({ scope_id: branch, epoch, seq: "4", pin_id: extendedIdentity.pin_id,
        kind: read.kind, after: read.after, next: String(rows.length), total: String(rows.length), rows });
      return Response.json({ ...extendedIdentity, payload_json: payload, payload_sha256: digest(payload) });
    };
    await worker.prepareGroupedSettingsHandoff(extended);
    const changedTender = (await manager.pool.request().input("id", tender.id)
      .query("SELECT method,row_version FROM dbo.payment_transactions WHERE id=@id;")).recordset[0];
    assert.deepEqual(changedTender, { method: "card", row_version: 2 });
    assert.equal(await worker.cashSenderHandoff(proof, activePilot), true);
    assert.equal(await worker.cashSenderHandoff({ ...proof, installationGeneration: randomUUID() }, activePilot), false);
    const handbackPilot = { enrollment: extended, mode: "handback" };
    assert.equal(await worker.cashSenderHandoff(proof, handbackPilot), false);
    assert.equal(await worker.cashSenderHandoff({ ...proof, writingNew: false }, handbackPilot), true);
    const latestSequence = "6";
    const missingShift = randomUUID();
    const shiftTable = registry.tables.find(table => table.cloudTable === "shifts");
    const stamp = "2026-11-07T09:30:00.123456Z";
    const opening = { ...Object.fromEntries(shiftTable.columns.map(column => [column.cloudColumn, null])),
      id: missingShift, store_id: branch, terminal_id: origin, status: "OPEN", state: "ACTIVE",
      opening_float: 10, opened_at: stamp, created_at: stamp, updated_at: stamp, row_version: 1,
      opened_by_name: "Fixture Cashier", note: "", overdue: false };
    const { GRAPH_TABLES } = require("../electron/db/shift-intents.cjs");
    const graphJson = JSON.stringify({ ok: true, shiftGraphVersion: 1, branchId: branch, shiftId: missingShift,
      graphToken: null, closedAtRaw: null,
      tables: GRAPH_TABLES.map(table => ({ table, rows: table === "shifts" ? [opening] : [] })) });
    const shiftGroup = { seq: "5", operation_id: randomUUID(), financial: { kind: "shift_v1", shift_id: missingShift },
      changes: [{ table_name: "shifts", entity_id: JSON.stringify({ id: missingShift }), row_version: "1",
        tombstone: false, row_data: { id: missingShift, store_id: branch, row_version: 1,
          graph_json: graphJson, graph_sha256: digest(graphJson) } }] };
    const historical = nextReceipt(cash[0], latestSequence, origin, randomUUID(), missingShift);
    const movedStock = extendedStock.map(row => row.product_id === product
      ? { product_id: product, row_version: 4, retired: true } : row);
    const movedIdentity = { ...extendedIdentity, seq: latestSequence, pin_id: randomUUID() };
    const movedManifest = JSON.stringify({ ...JSON.parse(extendedManifest), seq: latestSequence, cash_count: "3",
      financial_count: "2" });
    const laterBuckets = { "new-owner": 9, "preserved-foreign": 37 };
    await manager.pool.request().input("id", product).input("buckets", JSON.stringify(laterBuckets)).query(`
      WITH CHANGE_TRACKING_CONTEXT (0x434C4F5544)
      UPDATE dbo.products SET owner_store_id=N'new-owner',row_version=4,stock_quantity=46,stock_by_store=@buckets
      WHERE id=@id;`);
    globalThis.fetch = async (_url, options) => {
      const read = JSON.parse(options.body).sqlServerGroupedRecovery;
      assert.equal(read.extended, true);
      if (read.action === "begin") {
        assert.equal(read.atLeastSeq, "4");
        return Response.json({ ...movedIdentity, manifest_json: movedManifest, manifest_sha256: digest(movedManifest) });
      }
      const rows = { cash: [...cash, historical], financial: [correction, shiftGroup], stock: movedStock }[read.kind];
      const payload = JSON.stringify({ scope_id: branch, epoch, seq: latestSequence, pin_id: movedIdentity.pin_id,
        kind: read.kind, after: read.after, next: String(rows.length), total: String(rows.length), rows });
      return Response.json({ ...movedIdentity, payload_json: payload, payload_sha256: digest(payload) });
    };
    cloud.pullGroupedSettings = async (_source, saved) => saved.seq === "4"
      ? { status: "SNAPSHOT_REQUIRED", reason: "REPLAY_EXPIRED" }
      : { status: "OK", scope_id: branch, epoch, next_seq: saved.seq, upper_seq: saved.seq, has_more: false, groups: [] };
    assert.equal((await worker.runGroupedSettingsPilot(extended, () => false)).position.seq, latestSequence);
    const movedState = await state();
    assert.deepEqual(JSON.parse(movedState.stock_by_store), laterBuckets);
    assert.equal(movedState.sales, 3);
    console.log("PASS extended recovery restores a missing shift before its receipt and preserves the new owner's stock");
    let sealed = false;
    cloud.pullGroupedSettings = async (_source, saved, _limit, _projection, enabled) => {
      assert.equal(enabled, true);
      return { status: "OK", scope_id: branch, epoch, next_seq: saved.seq, upper_seq: saved.seq, has_more: false, groups: [],
        ...(sealed ? { sealed_seq: latestSequence } : {}) };
    };
    cloud.bootstrapPage = async () => ({ rows: [setting.row_data], cursor: null });
    await assert.rejects(worker.returnGroupedSettingsHandoff(extended, () => false), { code: "ESYNC_GROUPED_REVIEW_REQUIRED" });
    sealed = true;
    const waiting = randomUUID();
    await manager.pool.request().input("id", waiting).input("branch", branch).input("sale", sale.id).query(`
      INSERT dbo.local_operation_receipts(operation_id,operation_type,entity_id,refund_branch_id,refund_evidence_json)
      VALUES(@id,N'refund',@sale,@branch,N'{}');`);
    await assert.rejects(worker.returnGroupedSettingsHandoff(extended, () => false), { code: "ELOCAL_UPLOAD_PENDING" });
    assert.equal(await worker.cashSenderHandoff({ ...proof, writingNew: false }, handbackPilot), true);
    assert.equal(await worker.cashSenderHandoff(proof, activePilot), false);
    await manager.pool.request().input("id", waiting).query("DELETE FROM dbo.local_operation_receipts WHERE operation_id=@id;");
    assert.equal((await worker.returnGroupedSettingsHandoff(extended, () => false)).seq, latestSequence);
    assert.equal(await position(), null);
    assert.equal((await checkpoints.get(branch, "__feed__", "pull")).committed_cursor, "43");
    assert.equal(await worker.cashSenderHandoff(proof, activePilot), false);
    console.log("PASS extended recovery applies a pinned tender correction and installed handback waits for pending refund evidence");
  } finally { globalThis.fetch = fetchBefore; await local.close(); }
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
    await verifyPagedRecovery(receipt, origin);
  } finally { await local.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
