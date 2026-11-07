// Opt-in disposable LocalDB and synthetic HTTPS replies. No operator settings are used.
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { createLocal } = require("./lib/shift-protocol-integration-fixture.cjs");
const { CloudClient } = require("../electron/sync/cloud-client.cjs");
const { PullWorker } = require("../electron/sync/pull-worker.cjs");
const { ChangeReader } = require("../electron/sync/change-reader.cjs");
const { CheckpointRepository } = require("../electron/sync/checkpoints.cjs");
const { CHECKPOINT, TABLE } = require("../electron/sync/grouped-store-settings.cjs");

const id = n => "aaaaaaaa-aaaa-4aaa-8aaa-" + String(n).padStart(12, "0");
const branch = id(1);
const foreign = id(2);
const terminal = id(3);
const epoch = id(4);
const start = 9007199254740993n;
const seq = offset => String(start + BigInt(offset));
const url = "https://owned-grouped-settings.invalid";
const originalProject = { projectOrigin: "https://owned-project.invalid", branchId: branch };
const registration = { tokenId: terminal, deviceUse: "operations", deviceType: "pc", locationId: branch, deviceBindingProof: "a".repeat(64) };
const key = JSON.stringify({ store_id: branch });
const exactDecimal = "10000000000000.123456789123";
const instant = n => `2026-11-07T04:30:0${n}.1234567Z`;

async function main() {
  assert.deepEqual(process.argv.slice(2), ["--run"]);
  const fetchBefore = globalThis.fetch;
  let local;
  let passed = 0;
  const test = async (name, fn) => {
    await fn();
    passed++;
    console.log("PASS " + name);
  };
  try {
    local = await createLocal(branch);
    const { manager, registry } = local;
    manager.profile = { id: "owned-localdb", host: "owned-private-pipe", database: "owned-grouped-settings" };
    const table = registry.tables.find(item => item.cloudTable === TABLE);
    const seedRow = Object.fromEntries(table.columns.map(column => [
      column.cloudColumn, column.nullable ? null : false,
    ]));
    const change = (version, options = {}) => ({
      table_name: TABLE,
      entity_id: `{"store_id": "${branch}"}`,
      tombstone: false,
      row_version: String(version),
      row_data: { ...seedRow, store_id: branch, row_version: String(version), idle_timeout_minutes: 7,
        created_at: instant(0), updated_at: instant(version), updated_by: "fixture ✓  ",
        max_drawer_cash_limit: exactDecimal, show_opening_float_at_close: version % 2 === 0, ...options },
    });
    const snapshot = (position = seq(0), changes = [change(1)], extra = {}) => {
      const manifest_json = JSON.stringify({ scope_id: branch, epoch, seq: position, changes });
      return { status: "OK", scope_id: branch, epoch, seq: position, pin_id: id(5),
        expires_at: new Date(Date.now() + 60_000).toISOString(), manifest_json,
        manifest_sha256: createHash("sha256").update(manifest_json).digest("hex"), ...extra };
    };
    const page = (next, upper, entries) => ({ status: "OK", scope_id: branch, epoch,
      next_seq: seq(next), upper_seq: seq(upper), has_more: next < upper,
      groups: entries.map(([offset, settings]) => ({ seq: seq(offset), operation_id: null, changes: [settings] })) });
    let terminalConfig = registration;
    let project = originalProject;
    let reply = snapshot();
    let status = 200;
    let afterResponse = () => {};
    const calls = [];
    globalThis.fetch = async (target, options) => {
      assert.equal(target, url + "/api/v1/pos/sync");
      assert.equal(options.method, "POST");
      const payload = JSON.parse(options.body);
      const readKey = Object.hasOwn(payload, "sqlServerGroupedSnapshot") ? "sqlServerGroupedSnapshot" : "sqlServerGroupedFeed";
      assert.deepEqual(Object.keys(payload).sort(), [readKey, "deviceBindingProof", "terminalToken"].sort());
      assert.equal(payload.terminalToken, terminal);
      assert.equal(payload.deviceBindingProof, registration.deviceBindingProof);
      assert.equal(payload[readKey].branchId, branch);
      assert.equal(payload[readKey].organizationId, "default");
      calls.push(payload[readKey]);
      afterResponse();
      return new Response(JSON.stringify(reply), { status, headers: { "content-type": "application/json" } });
    };
    const cloud = new CloudClient({ configStore: { get: () => url }, terminalStore: { read: () => terminalConfig },
      connectionManager: manager, financialBasisContext: () => project });
    const checkpoints = new CheckpointRepository(manager);
    const notices = [];
    const worker = () => new PullWorker({ connectionManager: manager, cloud, registry, checkpoints,
      reader: new ChangeReader(manager, registry), publish: notice => notices.push(notice) });
    const pull = (limit = 100) => worker().pullGroupedSettingsPage({ limit });
    const install = () => worker().installGroupedSettingsSnapshot();
    const cursor = async () => JSON.parse((await checkpoints.get(branch, CHECKPOINT, "pull"))?.committed_cursor ?? "null");
    const saved = async (scope = branch) => (await manager.pool.request().input("branch", scope).query(`
      SELECT row_version, show_opening_float_at_close, updated_by,
        CONVERT(nvarchar(80),max_drawer_cash_limit) AS amount,
        CONVERT(nvarchar(40),SWITCHOFFSET(updated_at,'+00:00'),127) AS updated,
        CONVERT(nvarchar(40),SWITCHOFFSET(created_at,'+00:00'),127) AS created
      FROM dbo.pos_store_settings WHERE store_id=@branch;`)).recordset[0];
    const ackTracking = () => manager.pool.request().input("branch", branch).query(`
      UPDATE dbo.sync_checkpoints SET change_tracking_version=CHANGE_TRACKING_CURRENT_VERSION()
      WHERE branch_id=@branch AND entity_type=N'pos_store_settings' AND direction=N'push';`);

    await test("verified snapshot commits the exact row and grouped cursor, with no legacy cursor movement or upload echo", async () => {
      await checkpoints.save(branch, "__feed__", "pull", { committed_cursor: "83" });
      await local.insert(TABLE, { store_id: foreign, row_version: 77 });
      assert.deepEqual(await pull(), { status: "SNAPSHOT_REQUIRED", reason: "UNINITIALIZED" });
      assert.equal(calls.length, 0);
      assert.deepEqual(await install(), { epoch, seq: seq(0), changed: true });
      assert.deepEqual(calls[0], { organizationId: "default", branchId: branch });
      assert.equal((await cursor()).seq, seq(0));
      assert.equal(String((await checkpoints.get(branch, "__feed__", "pull")).committed_cursor), "83");
      assert.equal(await checkpoints.get(foreign, CHECKPOINT, "pull"), null);
      assert.equal((await saved(foreign)).row_version, 77);
      assert.equal((await saved()).amount, exactDecimal);
      assert.equal((await saved()).updated_by, "fixture ✓  ");
      assert.match((await saved()).updated, /04:30:01\.1234567(?:Z|\+00:00)$/);
      assert.match((await saved()).created, /04:30:00\.1234567(?:Z|\+00:00)$/);
      const ct = await manager.pool.request().input("branch", branch).query(`
        SELECT CONVERT(varchar(32),SYS_CHANGE_CONTEXT,2) AS context
        FROM CHANGETABLE(CHANGES dbo.pos_store_settings,0) AS ct WHERE ct.store_id=@branch;`);
      assert.deepEqual(ct.recordset.map(item => item.context), ["434C4F5544"]);
      assert.equal((await manager.pool.request().query("SELECT count(*) AS n FROM dbo.sync_change_journal;")).recordset[0].n, 0);
    });

    await test("exact sequence and fixed upper resume after restarting the owned ODBC pool", async () => {
      reply = page(1, 2, [[1, change(2)]]);
      assert.deepEqual(await pull(1), { status: "OK", merged: 1, seq: seq(1), hasMore: true });
      assert.equal((await cursor()).upper, seq(2));
      assert.equal(calls.at(-1).afterSeq, seq(0));
      assert.equal(calls.at(-1).upperSeq, null);
      await local.restart();
      reply = page(2, 2, [[2, change(3)]]);
      assert.deepEqual(await pull(1), { status: "OK", merged: 1, seq: seq(2), hasMore: false });
      assert.equal(calls.at(-1).afterSeq, seq(1));
      assert.equal(calls.at(-1).upperSeq, seq(2));
      assert.equal((await cursor()).upper, null);
      assert.equal((await saved()).row_version, 3);
    });

    await test("pending native journal and unjournaled local CT edits both retain the exact prior cursor", async () => {
      reply = page(3, 3, [[3, change(4)]]);
      await manager.pool.request().input("key", key).input("branch", branch).query(`
        INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version)
        VALUES(N'pos_store_settings',@key,N'update',@branch,4);`);
      assert.deepEqual(await pull(), { status: "DEFERRED", reason: "ELOCAL_UPLOAD_PENDING", merged: 0, seq: seq(2), hasMore: true });
      await manager.pool.request().query("UPDATE dbo.sync_change_journal SET acknowledged_at=SYSDATETIMEOFFSET();");
      await manager.pool.request().input("branch", branch).query("UPDATE dbo.pos_store_settings SET idle_timeout_minutes=55 WHERE store_id=@branch;");
      assert.equal((await pull()).status, "DEFERRED");
      assert.equal((await cursor()).seq, seq(2));
      assert.equal((await saved()).row_version, 3);
      assert.equal((await manager.pool.request().input("branch", branch).query("SELECT idle_timeout_minutes FROM dbo.pos_store_settings WHERE store_id=@branch;")).recordset[0].idle_timeout_minutes, 55);
      await ackTracking();
      assert.equal((await pull()).merged, 1);
    });

    await test("checkpoint failure rolls back its own group, keeps prior committed group, and resumes once", async () => {
      reply = page(5, 5, [[4, change(5)], [5, change(6)]]);
      const save = checkpoints.save.bind(checkpoints);
      checkpoints.save = async (...args) => {
        await save(...args);
        if (JSON.parse(args[3].committed_cursor).seq === seq(5)) throw Error("fixture checkpoint failure");
      };
      const before = notices.length;
      try { await assert.rejects(pull(), /fixture checkpoint failure/); }
      finally { checkpoints.save = save; }
      assert.equal(notices.length, before + 1);
      assert.equal((await saved()).row_version, 5);
      assert.equal((await cursor()).seq, seq(4));
      assert.equal((await cursor()).upper, seq(5));
      await local.restart();
      reply = page(5, 5, [[5, change(6)]]);
      assert.equal((await pull()).seq, seq(5));
      assert.equal((await saved()).row_version, 6);
      assert.equal(notices.length, before + 2);
    });

    await test("scope, a missing group, rounded row data and a changed source cannot advance the cursor", async () => {
      reply = { ...page(6, 6, [[6, change(7)]]), scope_id: foreign };
      await assert.rejects(pull(), { code: "ESYNC_GROUPED_PROTOCOL" });
      reply = page(7, 7, [[7, change(7)]]);
      await assert.rejects(pull(), { code: "ESYNC_GROUPED_PROTOCOL" });
      reply = page(6, 6, [[6, change(7, { max_drawer_cash_limit: Number(exactDecimal) })]]);
      await assert.rejects(pull(), { code: "ESYNC_GROUPED_PROTOCOL" });
      reply = page(6, 6, [[6, change(7)]]);
      afterResponse = () => { project = { ...originalProject, projectOrigin: "https://wrong-owned-project.invalid" }; };
      await assert.rejects(pull(), { code: "ESYNC_REQUEST_CONTEXT_CHANGED" });
      await assert.rejects(pull(), { code: "ESYNC_GROUPED_PROTOCOL" });
      project = originalProject;
      afterResponse = () => {};
      assert.equal((await cursor()).seq, seq(5));
      assert.equal((await saved()).row_version, 6);
    });

    await test("Management, mobile and a missing local branch binding never reach the grouped transport", async () => {
      const before = calls.length;
      terminalConfig = { ...registration, locationId: "", deviceUse: "management" };
      await assert.rejects(pull(), { code: "ESYNC_GROUPED_SCOPE" });
      terminalConfig = { ...registration, deviceType: "mobile" };
      await assert.rejects(install(), { code: "ESYNC_GROUPED_SCOPE" });
      terminalConfig = registration;
      project = { ...originalProject, branchId: foreign };
      await assert.rejects(pull(), { code: "ESYNC_GROUPED_SCOPE" });
      project = originalProject;
      assert.equal(calls.length, before);
    });

    await test("typed replay expiry and invalid or divergent snapshots preserve local work and prior position", async () => {
      status = 409;
      reply = { status: "SNAPSHOT_REQUIRED", reason: "REPLAY_EXPIRED" };
      assert.deepEqual(await pull(), reply);
      status = 200;
      reply = snapshot(seq(6), [change(6)], { manifest_sha256: "0".repeat(64) });
      await assert.rejects(install(), { code: "ESYNC_GROUPED_PROTOCOL" });
      reply = snapshot(seq(6), [change(6)], { expires_at: "2000-01-01T00:00:00.000Z" });
      await assert.rejects(install(), { code: "ESYNC_GROUPED_PROTOCOL" });
      reply = snapshot(seq(6), [change(7)]);
      await assert.rejects(install(), { code: "ESYNC_GROUPED_REVIEW_REQUIRED" });
      assert.equal((await cursor()).seq, seq(5));
      assert.equal((await saved()).row_version, 6);
      reply = snapshot(seq(6), [change(6)]);
      assert.deepEqual(await install(), { epoch, seq: seq(6), changed: false });
      assert.equal((await cursor()).seq, seq(6));
    });

    console.log("PASS " + passed + " isolated LocalDB grouped settings cases");
  } finally {
    globalThis.fetch = fetchBefore;
    await local?.close();
  }
}

async function postgresWire() {
  const { readFileSync } = require("node:fs");
  const { baseline, page } = JSON.parse(readFileSync(0, "utf8"));
  const scope = baseline?.scope_id;
  assert.equal(typeof scope, "string");
  assert(scope.length > 0 && scope.length <= 128);
  assert.equal(page.scope_id, scope);
  const before = JSON.parse(baseline.manifest_json).changes[0].row_data;
  const after = page.groups.at(-1).changes[0].row_data;
  assert.equal(before.store_id, scope);
  assert.equal(after.store_id, scope);
  const fetchBefore = globalThis.fetch;
  let local;
  try {
    local = await createLocal(scope);
    const { manager, registry } = local;
    manager.profile = { id: "owned-postgres-wire", host: "owned-private-pipe", database: "owned-postgres-wire" };
    const settings = registry.tables.find(table => table.cloudTable === TABLE);
    const changed = settings.columns.find(column => column.sqlServerType === "bit" &&
      before[column.cloudColumn] !== after[column.cloudColumn]);
    assert(changed, "The actual Postgres feed must carry an observable settings change.");
    const shift = id(991);
    await local.insert("shifts", { id: shift, store_id: scope, terminal_id: terminal, state: "ACTIVE", status: "OPEN", row_version: 1 });
    await manager.pool.request().input("branch", scope).input("key", JSON.stringify({ id: shift })).query(`
      INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version)
      VALUES(N'shifts',@key,N'insert',@branch,1);`);
    const requests = [];
    globalThis.fetch = async (target, options) => {
      assert.equal(target, url + "/api/v1/pos/sync");
      const body = JSON.parse(options.body);
      assert.equal(body.terminalToken, terminal);
      assert.equal(body.deviceBindingProof, registration.deviceBindingProof);
      const read = body.sqlServerGroupedSnapshot ?? body.sqlServerGroupedFeed;
      requests.push(read);
      assert.equal(read.branchId, scope);
      return Response.json(body.sqlServerGroupedSnapshot ? baseline : page);
    };
    const cloud = new CloudClient({ configStore: { get: () => url },
      terminalStore: { read: () => ({ ...registration, locationId: scope }) },
      connectionManager: manager, financialBasisContext: () => ({ ...originalProject, branchId: scope }) });
    const checkpoints = new CheckpointRepository(manager);
    const worker = new PullWorker({ connectionManager: manager, cloud, registry, checkpoints,
      reader: new ChangeReader(manager, registry) });
    const readFlag = async () => (await manager.pool.request().input("branch", scope).query(
      `SELECT [${changed.sqlServerColumn}] AS actual FROM dbo.pos_store_settings WHERE store_id=@branch;`)).recordset[0].actual;
    assert.deepEqual(await worker.installGroupedSettingsSnapshot(), { epoch: baseline.epoch, seq: baseline.seq, changed: true });
    assert.equal(await readFlag(), before[changed.cloudColumn]);
    assert.equal((await worker.pullGroupedSettingsPage()).seq, page.next_seq);
    assert.equal(requests[1].afterSeq, baseline.seq);
    assert.equal(await readFlag(), after[changed.cloudColumn]);
    assert.equal(JSON.parse((await checkpoints.get(scope, CHECKPOINT, "pull")).committed_cursor).seq, page.next_seq);
    assert.equal((await manager.pool.request().input("shift", shift).query("SELECT state FROM dbo.shifts WHERE id=@shift;")).recordset[0].state, "ACTIVE");
    assert.equal((await manager.pool.request().query("SELECT COUNT(*) AS n FROM dbo.sync_change_journal WHERE entity_type=N'shifts' AND acknowledged_at IS NULL;")).recordset[0].n, 1);
    console.log("PASS actual PostgreSQL snapshot and group applied by the native LocalDB worker");
  } finally {
    globalThis.fetch = fetchBefore;
    await local?.close();
  }
}

const run = process.argv.slice(2).join(" ") === "--postgres-wire" ? postgresWire : main;
run().catch(error => { console.error(error); process.exitCode = 1; });
