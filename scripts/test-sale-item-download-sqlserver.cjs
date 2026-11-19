"use strict";
// Native opt-in regression: no configured POS connection or hosted access.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createOwnedUpgradeFixture } = require("./lib/owned-upgrade-fixture.cjs");
const { CloudClient } = require("../electron/sync/cloud-client.cjs");
const { PullWorker } = require("../electron/sync/pull-worker.cjs");
const { ChangeReader } = require("../electron/sync/change-reader.cjs");
const { CheckpointRepository } = require("../electron/sync/checkpoints.cjs");
const { assertSaleItemDownloadScope } = require("../electron/sync/sale-item-download-scope.cjs");
const { sqlErrorDiagnostic } = require("../electron/db/sql-error-diagnostic.cjs");

async function main() {
  assert.deepEqual(process.argv.slice(2), ["--run"], "Only --run is accepted; no connection arguments");
  const f = await createOwnedUpgradeFixture(); let runtime;
  try {
    await f.installCore(); runtime = await f.connect(f.database);
    const manager = { pool: runtime, sql: () => f.sql }, saleA = randomUUID(), saleB = randomUUID();
    const product = randomUUID(), item = randomUUID(), foreignItem = randomUUID();
    await runtime.request().input("saleA", saleA).input("saleB", saleB).input("product", product).input("foreignItem", foreignItem)
      .query(`INSERT dbo.stores(id,code,name,group_id) VALUES(N'owned-a',N'OWNA',N'Owned A',N'default'),(N'owned-b',N'OWNB',N'Owned B',N'default');
        INSERT dbo.products(id,barcode,name,owner_store_id,stock_by_store,catalogue_store_ids)
          VALUES(@product,N'OWN-PRODUCT',N'Owned product',N'owned-b',N'{"owned-a":3,"owned-b":2}',N'["owned-a","owned-b"]');
        INSERT dbo.sales(id,bill_number,store_id) VALUES(@saleA,N'OWN-SALE-A',N'owned-a'),(@saleB,N'OWN-SALE-B',N'owned-b');
        INSERT dbo.sale_items(id,sale_id,product_id,product_name,branch_id) VALUES(@foreignItem,@saleB,@product,N'Owned foreign child',NULL);
        INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version)
          VALUES(N'audit_logs',N'{"id":"unrelated-pending-evidence"}',N'insert',N'owned-a',1);`);
    const registry = require("../electron/db/schema-registry.cjs").loadRegistry();
    const table = registry.tables.find(value => value.cloudTable === "sale_items");
    const local = new CloudClient({ connectionManager: manager, configStore: { get: () => undefined }, terminalStore: { read: () => ({ tokenId: "owned-till" }) } });
    const checkpoints = new CheckpointRepository(manager), reader = new ChangeReader(manager, registry);
    await checkpoints.save("owned-a", "__feed__", "pull", { committed_cursor: 51 });
    let page, published = 0, progress = 0, fetchedParents = 0;
    const cloud = {
      pullBatch: async () => page,
      applyLocalBatch: (...args) => local.applyLocalBatch(...args),
      bootstrapPage: async () => { fetchedParents++; throw Error("A foreign parent must not be fetched"); },
    };
    const worker = new PullWorker({ connectionManager: manager, registry: { tables: [table] }, reader, checkpoints, cloud, publish: () => published++ });
    const row = { id: item, sale_id: saleA, product_id: product, product_name: "Owned product", quantity: 1,
      unit_price: 2.5, refunded_qty: 0, row_version: 1, branch_id: null, created_at: "2026-01-01T00:00:00.000Z" };
    const entry = data => ({ table_name: "sale_items", entity_id: JSON.stringify({ id: data.id }), row_data: data, tombstone: false });
    const tombstone = id => ({ table_name: "sale_items", entity_id: JSON.stringify({ id }), row_data: null, tombstone: true });
    const cursor = async () => Number((await checkpoints.get("owned-a", "__feed__", "pull")).committed_cursor);
    const run = async (change, nextCursor) => {
      page = { count: 1, cursor: nextCursor, rows: change.tombstone ? [] : [change], tombstones: change.tombstone ? [change] : [] };
      return worker.run({ branchId: "owned-a", skipMembership: true, onProgress: () => progress++ });
    };
    assert.equal((await run(entry(row), 52)).merged, 1); assert.equal(await cursor(), 52);
    assert.equal((await run(entry({ ...row, branch_id: "  " }), 53)).merged, 1); assert.equal(await cursor(), 53);
    const own = (await runtime.request().input("id", item).query("SELECT COUNT(*) n,MAX(row_version) version FROM dbo.sale_items WHERE id=@id;")).recordset[0];
    assert.equal(own.n, 1); assert.equal(own.version, 1);
    console.log("PASS native own legacy-null/blank child replay; product ownership may differ");

    for (const [change, code] of [
      [entry({ ...row, id: randomUUID(), branch_id: "owned-b" }), "SYNC_BRANCH_FORBIDDEN"],
      [entry({ ...row, id: randomUUID(), sale_id: saleB }), "SYNC_BRANCH_FORBIDDEN"],
      [entry({ ...row, id: randomUUID(), sale_id: randomUUID() }), "ESYNC_DOWNLOAD_PARENT_MISSING"],
      [tombstone(foreignItem), "SYNC_BRANCH_FORBIDDEN"],
    ]) {
      const previousPublished = published, previousProgress = progress;
      await assert.rejects(run(change, 54), { code });
      assert.equal(await cursor(), 53); assert.equal(published, previousPublished); assert.equal(progress, previousProgress);
      assert.equal((await runtime.request().query("SELECT COUNT(*) n FROM dbo.sale_items;")).recordset[0].n, 2);
    }
    console.log("PASS rejected native feed pages retain cursor/rows and publish no progress");

    assert.equal((await run(tombstone(item), 54)).merged, 1); assert.equal(await cursor(), 54);
    const absent = randomUUID(); await run(tombstone(absent), 55); assert.equal(await cursor(), 55);
    assert.equal((await runtime.request().input("id", foreignItem).query("SELECT COUNT(*) n FROM dbo.sale_items WHERE id=@id;")).recordset[0].n, 1);
    console.log("PASS own tombstone/absent retry retain another branch's child");

    const tx = new f.sql.Transaction(runtime); await tx.begin(f.sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      await assertSaleItemDownloadScope({ transaction: tx, connectionManager: manager, changes: [tombstone(absent)], branchId: "owned-a" });
      let blocked;
      try {
        await f.pool.request().input("id", absent).input("sale", saleA).input("product", product).query(`SET LOCK_TIMEOUT 200;
          INSERT dbo.sale_items(id,sale_id,product_id,product_name) VALUES(@id,@sale,@product,N'Blocked synthetic child');`);
      } catch (error) { blocked = error; }
      assert.deepEqual(sqlErrorDiagnostic(blocked), { sqlNumber: 1222 });
    } finally { await tx.rollback(); }
    const pending = (await runtime.request().query("SELECT COUNT(*) n,SUM(CASE WHEN acknowledged_at IS NULL THEN 1 ELSE 0 END) pending FROM dbo.sync_change_journal;")).recordset[0];
    assert.deepEqual(pending, { n: 1, pending: 1 }); assert.equal(fetchedParents, 0);
    assert.equal((await runtime.request().input("id", absent).query("SELECT COUNT(*) n FROM dbo.sale_items WHERE id=@id;")).recordset[0].n, 0);
    console.log("PASS serializable absent-child lock blocks racing insert; pending evidence stays unacknowledged");
  } finally { await runtime?.close(); await f.close(); }
}
if (require.main === module) main().catch(error => {
  console.error(JSON.stringify({ code: error.code ?? "ETEST", ...sqlErrorDiagnostic(error), message: error.message }));
  process.exitCode = 1;
});
