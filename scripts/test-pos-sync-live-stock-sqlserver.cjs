// Disposable SQL Server LocalDB only. No operator connection or hosted traffic.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { createLocal } = require("./lib/shift-protocol-integration-fixture.cjs");
const { CloudClient } = require("../electron/sync/cloud-client.cjs");
const { ChangeReader } = require("../electron/sync/change-reader.cjs");
const { CheckpointRepository } = require("../electron/sync/checkpoints.cjs");
const handoff = require("../electron/sync/grouped-settings-handoff.cjs");
const { readDatabaseGuid, MIXED_CHECKPOINT } = require("../electron/sync/grouped-store-settings.cjs");
const { applyGroupedStock, noteLocalStockAcceptance, parseStockGroup } = require("../electron/sync/grouped-live-stock.cjs");

async function verify() {
  const branch = "live-stock-A";
  const local = await createLocal(branch, { extraTables: ["products"] });
  const { manager, registry } = local;
  const products = registry.tables.find(table => table.cloudTable === "products");
  const reader = new ChangeReader(manager, registry);
  const checkpoints = new CheckpointRepository(manager);
  const worker = { connectionManager: manager, registry, reader };
  const epoch = randomUUID(), product = randomUUID(), foreign = randomUUID();
  const stock = (version, balance, id = product) => ({ product_id: id, branch_balance: balance, row_version: version });
  const sql = manager.sql();
  const withTransaction = async callback => {
    const tx = new sql.Transaction(manager.pool);
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      const result = await callback(tx);
      await tx.commit();
      return result;
    } catch (error) {
      await tx.rollback().catch(() => {});
      throw error;
    }
  };
  const apply = (row, seq, recovery = false) =>
    withTransaction(tx => applyGroupedStock(worker, tx, branch, [row], { epoch, seq, recovery }));
  const state = async id => {
    const result = await manager.pool.request().input("product", id).input("branch", branch).query(`
      SELECT stock_quantity,row_version,stock_by_store FROM dbo.products WHERE id=@product;
      SELECT product_version,branch_balance FROM dbo.pos_sync_grouped_stock_v1 WHERE branch_id=@branch AND product_id=@product;`);
    const productRow = result.recordsets[0][0];
    return { ...productRow, stock_by_store: JSON.parse(productRow.stock_by_store), stockProof: result.recordsets[1][0] };
  };
  try {
    await manager.pool.request().batch(readFileSync(join(__dirname, "preparation", "pos-sync-live-stock-native-v1.sql"), "utf8"));
    await local.insert("products", { id: product, row_version: 1, owner_store_id: branch,
      stock_quantity: 27, stock_by_store: { [branch]: 7, other: 20 } });
    await local.insert("products", { id: foreign, row_version: 1, owner_store_id: "other",
      stock_quantity: 90, stock_by_store: { other: 90 } });
    const current = async () => (await manager.pool.request().query("SELECT CHANGE_TRACKING_CURRENT_VERSION() AS version;")).recordset[0].version;
    await checkpoints.save(branch, "products", "push", { change_tracking_version: await current() });
    const change = { table_name: "products_stock", entity_id: JSON.stringify({ id: product }), row_version: "2",
      tombstone: false, row_data: stock(2, 5) };
    assert.deepEqual(parseStockGroup({ seq: "1", operation_id: null, changes: [change] }), stock(2, 5));
    assert.throws(() => parseStockGroup({ seq: "1", operation_id: null, changes: [{ ...change, row_version: "3" }] }),
      { code: "ESYNC_GROUPED_PROTOCOL" });
    assert.equal(await apply(stock(2, 5), "1", true), 1);
    assert.deepEqual(await state(product), { stock_quantity: 25, row_version: 1,
      stock_by_store: { [branch]: 5, other: 20 }, stockProof: { product_version: 2, branch_balance: 5 } });
    await assert.rejects(apply(stock(2, 20, foreign), "2"), { code: "ESYNC_CASH_RECEIPT_DEPENDENCY" });

    const databaseGuid = await readDatabaseGuid(manager.pool.request());
    await checkpoints.save(branch, MIXED_CHECKPOINT, "pull", {
      committed_cursor: JSON.stringify({ source: "fixture-stock-source", databaseGuid, epoch, seq: "1", upper: null, extended: true }),
    });
    await withTransaction(async tx => assert.equal(await handoff.isExtendedMixedFence(tx, branch), true));
    const cloud = new CloudClient({ configStore: {}, terminalStore: {}, connectionManager: manager });
    const remoteRow = { id: product, owner_store_id: branch, row_version: 7, stock_by_store: { [branch]: 200, other: 23 },
      stock_quantity: 223 };
    await withTransaction(tx => cloud.applyLocalBatch(tx, products, { rows: [{ row_data: remoteRow }], tombstones: [] }));
    assert.deepEqual(await state(product), { stock_quantity: 28, row_version: 7,
      stock_by_store: { [branch]: 5, other: 23 }, stockProof: { product_version: 2, branch_balance: 5 } });
    const moved = { ...remoteRow, owner_store_id: "other", row_version: 11 };
    const removed = { entity_id: JSON.stringify({ id: product }), tombstone: true };
    const legacyApply = (rows, tombstones) => withTransaction(tx => cloud.applyLocalBatch(tx, products, { rows, tombstones }));
    await assert.rejects(legacyApply([{ row_data: moved }], []), { code: "ESYNC_GROUPED_STOCK_PARENT_FENCED" });
    await assert.rejects(legacyApply([], [removed]), { code: "ESYNC_GROUPED_STOCK_PARENT_FENCED" });
    assert.equal((await state(product)).row_version, 7);
    assert.equal(await apply(stock(3, 4), "2"), 1);
    const settled = await state(product);
    const observed = await current();
    assert.equal(await apply(stock(3, 4), "2"), 0);
    assert.equal(await current(), observed);
    assert.deepEqual(settled, { stock_quantity: 27, row_version: 7,
      stock_by_store: { [branch]: 4, other: 23 }, stockProof: { product_version: 3, branch_balance: 4 } });
    await assert.rejects(apply(stock(3, 25), "3"), { code: "ESYNC_GROUPED_REVIEW_REQUIRED" });
    await assert.rejects(apply(stock(2, 5), "1", true), { code: "ESYNC_GROUPED_REVIEW_REQUIRED" });

    await assert.rejects(withTransaction(async tx => {
      await applyGroupedStock(worker, tx, branch, [stock(4, 8)], { epoch, seq: "3" });
      throw new Error("fixture checkpoint rollback");
    }), /fixture checkpoint rollback/);
    assert.deepEqual(await state(product), settled);
    await manager.pool.request().input("id", product).query("UPDATE dbo.products SET row_version=row_version+1 WHERE id=@id;");
    await assert.rejects(apply(stock(4, 8), "3"), { code: "ELOCAL_UPLOAD_PENDING" });
    assert.deepEqual((await state(product)).stockProof, settled.stockProof);
    const schema = readFileSync(join(__dirname, "../database/sqlserver/retail-pos-local-database.sql"), "utf8");
    const lifecycle = schema.match(/EXEC sys\.sp_executesql N'(CREATE OR ALTER TRIGGER dbo\.products_zero_stock_catalog_lifecycle[\s\S]*?END;)';/)?.[1];
    assert(lifecycle);
    await manager.pool.request().batch(lifecycle.replaceAll("''", "'"));
    const last = randomUUID();
    await local.insert("products", { id: last, row_version: 1, owner_store_id: branch, is_archived: false,
      stock_quantity: 1, stock_by_store: { [branch]: 1 } });
    const lastBaseline = await current();
    await checkpoints.save(branch, "products", "push", { change_tracking_version: lastBaseline });
    assert.equal(await apply(stock(2, 0, last), "3"), 1);
    const lastRead = await manager.pool.request().input("id", last).input("base", lastBaseline).query(`
      SELECT p.is_archived,p.stock_quantity,CONVERT(varchar(32),c.SYS_CHANGE_CONTEXT,2) AS context
      FROM dbo.products AS p JOIN CHANGETABLE(CHANGES dbo.products,@base) AS c ON c.id=p.id WHERE p.id=@id;`);
    assert.deepEqual(lastRead.recordset, [{ is_archived: true, stock_quantity: 0, context: "434C4F5544" }]);
    assert.equal(await apply(stock(3, 1, last), "4"), 1);
    await withTransaction(tx => noteLocalStockAcceptance(tx, branch, epoch, "6", [last]));
    await assert.rejects(withTransaction(tx => noteLocalStockAcceptance(tx, branch, randomUUID(), "7", [last])),
      { code: "ESYNC_GROUPED_REVIEW_REQUIRED" });
    await checkpoints.save(branch, "products", "push", { change_tracking_version: await current() });
    assert.equal(await apply(stock(4, 13, last), "5"), 0);
    assert.equal((await state(last)).stock_quantity, 1);
    await assert.rejects(apply(stock(4, 13, last), "5", true), { code: "ESYNC_GROUPED_REVIEW_REQUIRED" });
    assert.equal(await apply(stock(5, 0, last), "6"), 1);
    const ownerB = "other", moveVersion = 11;
    await checkpoints.save(ownerB, "products", "push", { change_tracking_version: await current() });
    await checkpoints.save(ownerB, MIXED_CHECKPOINT, "pull", {
      committed_cursor: JSON.stringify({ source: "fixture-stock-source", databaseGuid, epoch, seq: "1", upper: null, extended: true }),
    });
    const retirement = { product_id: product, row_version: moveVersion, retired: true };
    const tombstone = { table_name: "products_stock", entity_id: JSON.stringify({ id: product }), row_version: String(moveVersion),
      tombstone: true, row_data: { product_id: product, row_version: moveVersion } };
    assert.deepEqual(parseStockGroup({ seq: "7", operation_id: null, changes: [tombstone] }), retirement);
    assert.equal(await apply(retirement, "7"), 1);
    assert.equal(await apply(retirement, "7"), 0);
    assert.equal((await state(product)).stock_quantity, 23);
    assert.equal((await state(product)).stockProof.branch_balance, null);
    const fresh = { ...moved, owner_store_id: ownerB, stock_by_store: { [ownerB]: 9 }, stock_quantity: 9, deleted_at: null };
    await legacyApply([{ row_data: fresh }], []);
    assert.equal(await withTransaction(tx => applyGroupedStock(worker, tx, ownerB, [stock(moveVersion, 9)], {
      epoch, seq: "2",
    })), 1);
    const shared = await state(product);
    assert.equal(shared.stock_quantity, 9);
    assert.equal(await apply(stock(moveVersion - 1, 42), "6"), 0);
    await legacyApply([{ row_data: { ...remoteRow, row_version: moveVersion - 1 } }], []);
    await withTransaction(tx => cloud.applyLocalBatch(tx, products, {
      rows: [], tombstones: [{ ...removed, row_version: moveVersion - 1 }], branchId: branch,
    }));
    assert.deepEqual(await state(product), shared);
    await assert.rejects(legacyApply([], [{ ...removed, row_version: moveVersion }]),
      { code: "ESYNC_GROUPED_STOCK_PARENT_FENCED" });
    assert.equal(await withTransaction(tx => applyGroupedStock(worker, tx, ownerB, [{
      product_id: product, row_version: moveVersion + 1, retired: true,
    }], { epoch, seq: "3" })), 1);
    await legacyApply([], [{ ...removed, row_version: moveVersion }]);
    assert.equal((await state(product)).stock_quantity, 0);
    await manager.pool.request().input("id", product).query(`
      SELECT id FROM dbo.products WHERE id=@id AND deleted_at IS NOT NULL;`).then(result => assert.equal(result.recordset.length, 1));
    await manager.pool.request().input("scope", branch).input("checkpoint", MIXED_CHECKPOINT).query(`
      DELETE FROM dbo.sync_checkpoints WHERE branch_id=@scope AND entity_type=@checkpoint AND direction=N'pull';`);
    await manager.pool.request().input("scope", ownerB).input("checkpoint", MIXED_CHECKPOINT).query(`
      DELETE FROM dbo.sync_checkpoints WHERE branch_id=@scope AND entity_type=@checkpoint AND direction=N'pull';`);
    await legacyApply([], [removed]);
    const gone = await manager.pool.request().input("id", product).query("SELECT id FROM dbo.products WHERE id=@id;");
    assert.deepEqual(gone.recordset, []);
    console.log("PASS LocalDB live stock keeps legacy metadata and foreign balances, checks revision and pending CT, and rolls back proof with the data");
  } finally { await local.close(); }
}

if (process.argv.length !== 2) throw new Error("No connection arguments are accepted");
verify().catch(error => { console.error(error); process.exitCode = 1; });
