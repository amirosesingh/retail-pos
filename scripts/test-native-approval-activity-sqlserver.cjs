// Opt-in owned Windows LocalDB and synthetic HTTPS only.
const assert = require("node:assert/strict");
const { createLocal } = require("./lib/shift-protocol-integration-fixture.cjs");
const { loadRegistry } = require("../electron/db/schema-registry.cjs");
const { ChangeReader } = require("../electron/sync/change-reader.cjs");
const { SyncCoordinator } = require("../electron/sync/coordinator.cjs");
const { createApprovalActivityWake } = require("../electron/sync/approval-activity-wake.cjs");

const id = n => "aaaaaaaa-aaaa-4aaa-8aaa-" + String(n).padStart(12, "0");
const branchId = id(1), foreign = id(2), terminalToken = id(3);
const projectUrl = "https://owned-project.invalid", backendUrl = "https://owned-relay.invalid";
const sessionToken = "synthetic-person", deviceBindingProof = "a".repeat(64);
const exactAmount = "9007199254740993.000000000001";
const meta = '{"audience_user_ids":["operator"],"exact":9007199254740993}';

async function main() {
  assert.deepEqual(process.argv.slice(2), ["--run"]);
  const local = await createLocal(branchId);
  try {
    const { manager } = local;
    const table = loadRegistry().tables.find(table => table.cloudTable === "activity_events");
    const registry = { tables: [table] };
    const reader = new ChangeReader(manager, registry);
    const coordinator = new SyncCoordinator({});
    if (!local.registry.tables.some(candidate => candidate.cloudTable === table.cloudTable)) {
      await manager.pool.request().batch(`
        CREATE TABLE dbo.activity_events(${table.columns.map(column =>
          `[${column.sqlServerColumn}] ${column.sqlServerType} ${column.nullable ? "NULL" : "NOT NULL"}`
        ).join(",")}, PRIMARY KEY(id));
        ALTER TABLE dbo.activity_events ENABLE CHANGE_TRACKING;`);
    }
    await manager.pool.request().batch("CREATE UNIQUE INDEX fixture_client_event ON dbo.activity_events(client_event_id) WHERE client_event_id IS NOT NULL;");
    const row = (n, extra = {}) => ({
      ...Object.fromEntries(table.columns.map(column => [column.cloudColumn, null])),
      id: id(n), store_id: branchId, entity_type: "authorization_request", entity_id: id(n + 50),
      event_type: "approval_granted", client_event_id: "approval-decision-" + id(n + 50),
      severity: "info", title: "Approved", message: "", meta, amount: exactAmount,
      whatsapp_status: "skipped", cleared_by: [], created_at: "2026-11-08T00:00:00.1234567Z", ...extra,
    });
    let epoch = 1;
    let rows = [row(10), row(11)];
    let beforeResponse = () => {};
    const notices = [];
    let requests = 0;
    const wake = createApprovalActivityWake({
      manager, registry, reader, coordinator, publish: change => notices.push(change), runApply: work => work(),
      capture: () => {
        if (!epoch) return null;
        const captured = epoch;
        return { key: String(captured), branchId, terminalToken, projectUrl, backendUrl, sessionToken,
          deviceBindingProof, pool: manager.pool, assertCurrent() { assert.equal(epoch, captured); } };
      },
      fetchResponse: async (target, options) => {
        requests++;
        assert(coordinator.ownsExclusive());
        assert.equal(target, backendUrl + "/api/v1/pos/activity-preferences");
        assert.equal(options.redirect, "error");
        assert.deepEqual(JSON.parse(options.body), { action: "native_approval_wake", projectUrl, sessionToken, terminalToken, deviceBindingProof });
        await beforeResponse();
        return Response.json({ ok: true, protocol: "native-approval-activity-v1", projectUrl, branchId, rows });
      },
    });
    const tableCount = async () => (await manager.pool.request().query("SELECT COUNT(*) AS n FROM dbo.activity_events;")).recordset[0].n;
    await manager.pool.request().input("entity", JSON.stringify({ id: id(11) })).input("branch", branchId).query(`
      INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version)
      VALUES(N'activity_events',@entity,N'delete',@branch,1);`);
    assert.deepEqual(await wake(), { ok: true, inserted: 1 });
    assert.equal(notices.length, 1);
    assert.equal(await tableCount(), 1);
    const saved = (await manager.pool.request().query(`
      SELECT CONVERT(nvarchar(80),amount) AS amount, meta,
        CONVERT(nvarchar(40),SWITCHOFFSET(created_at,'+00:00'),127) AS created
      FROM dbo.activity_events;`)).recordset[0];
    assert.equal(saved.amount, exactAmount);
    assert.equal(saved.meta, meta);
    assert.match(saved.created, /\.1234567(?:Z|\+00:00)$/);
    const ct = (await manager.pool.request().query(`
      SELECT CONVERT(varchar(32),SYS_CHANGE_CONTEXT,2) AS context
      FROM CHANGETABLE(CHANGES dbo.activity_events,0) AS ct;`)).recordset;
    assert.deepEqual(ct, [{ context: "434C4F5544" }]);
    console.log("PASS exact owned native insertion, pending local deletion and no upload echo");

    await manager.pool.request().query("UPDATE dbo.activity_events SET cleared_by=N'[\"operator\"]';");
    rows = [{ ...row(10), id: id(12) }];
    assert.deepEqual(await wake(), { ok: true, inserted: 0 });
    assert.equal(notices.length, 1);
    assert.equal(await tableCount(), 1);
    assert.equal((await manager.pool.request().query("SELECT cleared_by FROM dbo.activity_events;")).recordset[0].cleared_by, '["operator"]');
    console.log("PASS replay by logical identity preserves the local clear");

    rows = [row(13), row(14, { store_id: foreign })];
    assert.equal((await wake()).skipped, true);
    assert.equal(await tableCount(), 1);
    rows = [row(13), row(14, { created_at: "2026-02-30T00:00:00.1234567Z" })];
    assert.equal((await wake()).skipped, true);
    assert.equal(await tableCount(), 1);
    assert.equal(notices.length, 1);
    console.log("PASS a rejected second insert rolls back the entire notification batch");

    const arrived = Promise.withResolvers();
    const release = Promise.withResolvers();
    rows = [];
    beforeResponse = () => { arrived.resolve(); return release.promise; };
    const first = wake();
    await arrived.promise;
    const beforeBurst = requests;
    for (let attempt = 0; attempt < 8; attempt++) assert.equal(wake(), first);
    // Invalidate the old proof before releasing this burst.
    epoch++;
    release.resolve();
    assert.equal((await first).skipped, true);
    assert.equal(requests, beforeBurst);
    console.log("PASS a burst shares one native job and does not retry under a replacement session");

    rows = [row(13)];
    beforeResponse = () => { epoch = 0; };
    assert.equal((await wake()).skipped, true);
    const before = requests;
    assert.equal((await wake()).skipped, true);
    assert.equal(requests, before);
    assert.equal(await tableCount(), 1);
    console.log("PASS malformed branch and signed-out in-flight response leave the local mirror intact");
  } finally { await local.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
