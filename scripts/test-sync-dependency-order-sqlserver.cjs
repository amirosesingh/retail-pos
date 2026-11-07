"use strict";

// Opt-in acceptance on a uniquely owned LocalDB fixture.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createOwnedUpgradeFixture } = require("./lib/owned-upgrade-fixture.cjs");
const { loadRegistry } = require("../electron/db/schema-registry.cjs");
const { CheckpointRepository } = require("../electron/sync/checkpoints.cjs");
const { CloudClient } = require("../electron/sync/cloud-client.cjs");
const { PullWorker } = require("../electron/sync/pull-worker.cjs");
const { refreshTable } = require("../electron/jobs/bootstrap.cjs");

function change(table, row, cursor) {
  return { table_name: table, row_data: row, entity_id: JSON.stringify({ id: row.id }), cursor };
}

async function main() {
  assert.deepEqual(process.argv.slice(2), ["--run"]);
  const fixture = await createOwnedUpgradeFixture();
  try {
    await fixture.installCore();
    const { pool, manager } = fixture;
    const registry = loadRegistry();
    const branch = randomUUID();
    const cloud = new CloudClient({ connectionManager: manager });
    const reader = { unacknowledged: async () => [] };
    const checkpoints = new CheckpointRepository(manager);
    const events = [];
    const pull = new PullWorker({
      connectionManager: manager, registry, cloud, reader, checkpoints,
      publish: (event) => events.push(event),
    });
    const pass = (rows, cursor) => {
      cloud.pullBatch = async () => ({ rows, tombstones: [], cursor, count: rows.length });
      return pull.run({ branchId: branch, skipMembership: true });
    };
    const storedCursor = async () =>
      Number((await checkpoints.get(branch, "__feed__", "pull"))?.committed_cursor);
    const categoryParent = { id: randomUUID(), name: "Fixture parent category", row_version: 1 };
    const categoryChild = { id: randomUUID(), name: "Fixture child category", parent_id: categoryParent.id, row_version: 1 };
    const storeParent = { id: branch, code: "FIXTURE-P", name: "Fixture parent store", row_version: 1 };
    const storeChild = { id: randomUUID(), code: "FIXTURE-C", name: "Fixture child store", parent_id: branch, row_version: 1 };
    const transferParent = { id: randomUUID(), ref: "FIXTURE-REQ", kind: "request", from_store_id: branch, to_store_id: storeChild.id, row_version: 1 };
    const transferChild = { ...transferParent, id: randomUUID(), ref: "FIXTURE-XFER", kind: "transfer", source_request_id: transferParent.id };

    const reversedPage = [
      change("stock_transfers", transferChild, 1),
      change("stores", storeChild, 2),
      change("product_categories", categoryChild, 3),
      change("stock_transfers", transferParent, 4),
      change("stores", storeParent, 5),
      change("product_categories", categoryParent, 6),
    ];
    await pass(reversedPage, 6);
    assert.equal(await storedCursor(), 6);
    assert.equal(events.length, 1);
    const links = (await pool.request()
      .input("category", categoryChild.id).input("store", storeChild.id).input("transfer", transferChild.id)
      .query(`SELECT (SELECT parent_id FROM dbo.product_categories WHERE id=@category) category_parent,
        (SELECT parent_id FROM dbo.stores WHERE id=@store) store_parent,
        (SELECT source_request_id FROM dbo.stock_transfers WHERE id=@transfer) transfer_parent;`)).recordset[0];
    assert.equal(links.category_parent.toLowerCase(), categoryParent.id);
    assert.equal(links.store_parent.toLowerCase(), branch);
    assert.equal(links.transfer_parent.toLowerCase(), transferParent.id);
    console.log("PASS child-first feed page applies all three registered self references before checkpoint");

    const missing = { id: randomUUID(), name: "Fixture later parent", row_version: 1 };
    const orphan = { id: randomUUID(), name: "Fixture pending child", parent_id: missing.id, row_version: 1 };
    const unrelated = { id: randomUUID(), name: "Fixture rollback witness", row_version: 1 };
    await assert.rejects(pass([change("product_categories", unrelated, 7), change("product_categories", orphan, 8)], 8),
      (error) => error.number === 547 || /foreign key/i.test(error.message));
    assert.equal(await storedCursor(), 6);
    assert.equal(events.length, 1);
    const rolledBack = await pool.request().input("id", unrelated.id)
      .query("SELECT id FROM dbo.product_categories WHERE id=@id;");
    assert.equal(rolledBack.recordset.length, 0);
    console.log("PASS missing parent rolls back the feed page and retains its checkpoint");

    cloud.bootstrapPage = async () => ({ rows: [orphan, missing], cursor: null });
    const result = await refreshTable({ registry, cloud, connectionManager: manager,
      branchId: branch, tableName: "product_categories", reader });
    assert.equal(result.completed, 2);
    const retried = await pool.request().input("id", orphan.id)
      .query("SELECT parent_id FROM dbo.product_categories WHERE id=@id;");
    assert.equal(retried.recordset[0].parent_id.toLowerCase(), missing.id);
    assert.equal(await storedCursor(), 6);
    console.log("PASS branch snapshot applies a child-first retry without moving the feed cursor");
  } finally {
    await fixture.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
