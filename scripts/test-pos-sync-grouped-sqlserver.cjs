// Opt-in disposable LocalDB and synthetic HTTPS replies. No operator settings are used.
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { createLocal } = require("./lib/shift-protocol-integration-fixture.cjs");
const { CloudClient } = require("../electron/sync/cloud-client.cjs");
const { PullWorker } = require("../electron/sync/pull-worker.cjs");
const { SyncCoordinator } = require("../electron/sync/coordinator.cjs");
const { ChangeReader } = require("../electron/sync/change-reader.cjs");
const { CheckpointRepository } = require("../electron/sync/checkpoints.cjs");
const { CHECKPOINT, TABLE, assertLocalTracking, readDatabaseGuid } = require("../electron/sync/grouped-store-settings.cjs");
const { CHECKPOINT: HANDOFF } = require("../electron/sync/grouped-settings-handoff.cjs");
const { refreshTable, runBootstrap } = require("../electron/jobs/bootstrap.cjs");

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
      const manifest_json = JSON.stringify({ scope_id: branch, epoch: extra.epoch ?? epoch, seq: position, changes });
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
      const response = new Response(JSON.stringify(reply), { status, headers: { "content-type": "application/json" } });
      await afterResponse();
      return response;
    };
    const makeCloud = () => new CloudClient({ configStore: { get: () => url }, terminalStore: { read: () => terminalConfig },
      connectionManager: manager, financialBasisContext: () => project });
    const cloud = makeCloud();
    const checkpoints = new CheckpointRepository(manager);
    const notices = [];
    const worker = (client = cloud) => new PullWorker({ connectionManager: manager, cloud: client, registry, checkpoints,
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

    await test("a checksum-valid empty snapshot cannot initialize the branch position", async () => {
      const valid = reply;
      reply = snapshot(seq(0), []);
      await assert.rejects(install(), { code: "ESYNC_GROUPED_PROTOCOL" });
      assert.equal(await cursor(), null);
      assert.equal(await saved(), undefined);
      reply = valid;
    });

    await test("verified snapshot commits the exact row and grouped cursor, with no legacy cursor movement or upload echo", async () => {
      await checkpoints.save(branch, "__feed__", "pull", { committed_cursor: "83" });
      await local.insert(TABLE, { store_id: foreign, row_version: 77 });
      const before = calls.length;
      assert.deepEqual(await pull(), { status: "SNAPSHOT_REQUIRED", reason: "UNINITIALIZED" });
      assert.equal(calls.length, before);
      assert.deepEqual(await install(), { epoch, seq: seq(0), changed: true });
      assert.deepEqual(calls.at(-1), { organizationId: "default", branchId: branch });
      assert.equal((await cursor()).seq, seq(0));
      assert.equal((await cursor()).databaseGuid, await readDatabaseGuid(manager.pool.request()));
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

    await test("a copied checkpoint cannot resume or commit against another SQL Server database", async () => {
      const replacement = await createLocal(branch);
      const originalPool = manager.pool;
      const originalSql = manager.sql;
      try {
        const position = await cursor();
        const replacementPool = replacement.manager.pool;
        assert.notEqual(await readDatabaseGuid(replacementPool.request()), position.databaseGuid);
        await new CheckpointRepository(replacement.manager).save(branch, CHECKPOINT, "pull",
          { committed_cursor: JSON.stringify(position) });
        reply = page(3, 3, [[3, change(4)]]);
        const before = calls.length;
        manager.pool = replacementPool;
        await assert.rejects(pull(), { code: "ESYNC_GROUPED_DATABASE_CHANGED" });
        await assert.rejects(install(), { code: "ESYNC_GROUPED_DATABASE_CHANGED" });
        assert.equal(calls.length, before);

        // Keep the captured profile and pool references stable but route the
        // actual apply transaction to the second disposable database.
        manager.pool = originalPool;
        const sql = originalSql();
        manager.sql = () => ({ ...sql, Transaction: class extends sql.Transaction {
          constructor(pool) {
            assert.equal(pool, originalPool);
            super(replacementPool);
          }
        } });
        await assert.rejects(pull(), { code: "ESYNC_GROUPED_DATABASE_CHANGED" });
        assert.equal(calls.length, before + 1);
        assert.deepEqual(await cursor(), position);
        assert.equal((await saved()).row_version, 3);
        manager.pool = replacementPool;
        assert.deepEqual(await cursor(), position);
        assert.equal(await saved(), undefined);
      } finally {
        manager.pool = originalPool;
        manager.sql = originalSql;
        await replacement.close();
      }
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

    await test("retention advancing during the native CT scan invalidates its proof", async () => {
      const sql = manager.sql();
      const transaction = new sql.Transaction(manager.pool);
      await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      try {
        await assertLocalTracking(transaction, branch);
        const request = transaction.request();
        const query = request.query.bind(request);
        const recheck = "SET @minimum = CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(N'dbo.pos_store_settings'));";
        request.query = statement => {
          const scan = statement.indexOf("CHANGETABLE(CHANGES");
          assert(scan >= 0 && statement.indexOf(recheck) > scan);
          // Keep the real CHANGETABLE scan and simulate a later cleanup deterministically.
          return query(statement.replace(recheck, "SET @minimum = @baseline + 1;"));
        };
        await assert.rejects(assertLocalTracking({ request: () => request }, branch), { code: "ELOCAL_PENDING_UNVERIFIED" });
      } finally { await transaction.rollback(); }
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

    await test("a delayed snapshot cannot replace a different epoch committed while it was fetching", async () => {
      const staleEpoch = id(6);
      const newerEpoch = id(7);
      const started = Promise.withResolvers();
      const release = Promise.withResolvers();
      reply = snapshot(seq(7), [change(6)], { epoch: staleEpoch });
      afterResponse = () => {
        started.resolve();
        return release.promise;
      };
      const rejected = assert.rejects(install(), { code: "ESYNC_GROUPED_POSITION_CHANGED" });
      await started.promise;
      afterResponse = () => {};
      try {
        // Separate request lanes simulate two native workers sharing the database.
        reply = snapshot("15", [change(6)], { epoch: newerEpoch });
        assert.deepEqual(await worker(makeCloud()).installGroupedSettingsSnapshot(),
          { epoch: newerEpoch, seq: "15", changed: false });
      } finally { release.resolve(); }
      await rejected;
      assert.equal((await cursor()).epoch, newerEpoch);
      assert.equal((await cursor()).seq, "15");
      assert.equal((await saved()).row_version, 6);
    });

    await test("the verified coordinator bounds catch-up, preserves pending work, and resumes the same window after restart", async () => {
      const enrollment = { branchId: branch, terminalId: terminal, backendOrigin: url, projectOrigin: originalProject.projectOrigin,
        databaseGuid: await readDatabaseGuid(manager.pool.request()) };
      const states = [];
      let legacyRuns = 0;
      const coordinator = (gate, pullWorker = worker()) => new SyncCoordinator({ groupedSettingsPilot: gate, pullWorker,
        pushWorker: { run: async () => ({}) }, publish: state => states.push(state.groupedSettingsPilot) });
      const ordinary = coordinator(undefined, { run: async () => { legacyRuns++; return {}; } });
      const before = calls.length;
      assert.equal((await ordinary.runGroupedSettingsPilot()).status, "DISABLED");
      assert.equal((await ordinary.runNow({ branchId: branch })).ok, true);
      assert.equal(legacyRuns, 1);
      assert.equal(ordinary.snapshot().groupedSettingsPilot, undefined);
      assert.equal((await coordinator({ ...enrollment, databaseGuid: id(33) }).runGroupedSettingsPilot()).status, "REFUSED");
      assert.equal(calls.length, before);

      const pilot = coordinator(enrollment);
      pilot.pause();
      assert.equal((await pilot.runGroupedSettingsPilot()).status, "PAUSED");
      assert.equal(calls.length, before);
      pilot.resume();
      assert.deepEqual(await pilot.runGroupedSettingsPilot(), { status: "REFUSED", reason: "ESYNC_GROUPED_HANDOFF_REQUIRED", branchId: branch, position: null });
      assert.equal(calls.length, before);

      const legacyEpoch = (await cursor()).epoch;
      reply = snapshot("15", [change(7)], { epoch: legacyEpoch });
      await assert.rejects(pilot.prepareGroupedSettingsHandoff(), { code: "ESYNC_GROUPED_REVIEW_REQUIRED" });
      assert.equal(await checkpoints.get(branch, HANDOFF, "pull"), null);
      reply = snapshot("15", [change(6)], { epoch: legacyEpoch });
      const originalSave = checkpoints.save.bind(checkpoints);
      checkpoints.save = async (...args) => {
        await originalSave(...args);
        if (args[1] === CHECKPOINT) throw Error("fixture handoff checkpoint failure");
      };
      try { await assert.rejects(pilot.prepareGroupedSettingsHandoff(), /fixture handoff checkpoint failure/); }
      finally { checkpoints.save = originalSave; }
      assert.equal(await checkpoints.get(branch, HANDOFF, "pull"), null);
      assert.equal((await cursor()).seq, "15");
      assert.deepEqual(await pilot.prepareGroupedSettingsHandoff(), { epoch: legacyEpoch, seq: "15", changed: false });
      assert(await checkpoints.get(branch, HANDOFF, "pull"));
      assert.equal((await saved()).row_version, 6);

      const legacy = makeCloud();
      legacy.pullBatch = async () => ({ cursor: 84, count: 1,
        rows: [{ ...change(7), cursor: 84 }], tombstones: [] });
      await assert.rejects(worker(legacy).run({ branchId: branch, skipMembership: true }), { code: "ESYNC_GROUPED_LEGACY_FENCED" });
      const legacyCursor = async () => String((await checkpoints.get(branch, "__feed__", "pull")).committed_cursor);
      assert.equal(await legacyCursor(), "83");
      assert.equal((await saved()).row_version, 6);
      const legacyOptions = { registry: { ...registry, tables: [table] }, cloud: legacy, connectionManager: manager,
        checkpoints, branchId: branch, reader: new ChangeReader(manager, registry) };
      legacy.bootstrapPage = async () => ({ rows: [], cursor: null });
      let pageSaved = false;
      const bootstrapContext = { job: {}, waitWhilePaused: async () => {}, checkpoint: async (_value, tx) => { pageSaved ||= Boolean(tx); } };
      const pushBaseline = (await checkpoints.get(branch, TABLE, "push")).change_tracking_version;
      await assert.rejects(runBootstrap({ ...legacyOptions, context: bootstrapContext }), { code: "ESYNC_GROUPED_LEGACY_FENCED" });
      assert.equal(pageSaved, false);
      assert.equal((await checkpoints.get(branch, TABLE, "push")).change_tracking_version, pushBaseline);
      await assert.rejects(refreshTable({ ...legacyOptions, tableName: TABLE, diagnosticOrigin: "gap_recovery" }), { code: "ESYNC_GROUPED_LEGACY_FENCED" });
      const foreignChange = change(78, { store_id: foreign, updated_at: "2026-11-07T04:30:10.1234567Z" });
      await legacy.applyLocalBatchToPool(manager, table, [{ ...foreignChange, entity_id: JSON.stringify({ store_id: foreign }) }]);
      assert.equal((await saved(foreign)).row_version, 78);
      const runStart = calls.length;

      // Simulate an epoch expiry, then install a verified matching snapshot
      // and catch up over two pages within the same exclusive lease.
      const started = Promise.withResolvers();
      const release = Promise.withResolvers();
      let fixtureWriterRan = false;
      const responses = [
        [200, snapshot(seq(0), [change(6)])],
        [200, page(1, 3, [[1, change(7)]])],
        [200, page(2, 3, [[2, change(8)]])],
      ];
      status = 409;
      reply = { status: "SNAPSHOT_REQUIRED", reason: "EPOCH_MISMATCH" };
      afterResponse = async () => {
        assert(pilot.ownsExclusive());
        if (responses.length === 3) {
          started.resolve();
          await release.promise;
          assert.equal(fixtureWriterRan, false);
        }
        if (responses.length) [status, reply] = responses.shift();
      };
      const catchingUp = pilot.runGroupedSettingsPilot();
      await started.promise;
      const competingWork = pilot.withExclusive(() => { fixtureWriterRan = true; });
      release.resolve();
      const partial = { status: "MORE", reason: null, branchId: branch, position: { epoch, seq: seq(2), upper: seq(3) } };
      assert.deepEqual(await catchingUp, partial);
      await competingWork;
      assert.equal(fixtureWriterRan, true);
      assert.deepEqual(states.at(-1), partial);
      assert.deepEqual(calls.slice(runStart + 2).map(read => [read.afterSeq, read.upperSeq, read.limit]), [
        [seq(0), null, 25], [seq(1), seq(3), 25],
      ]);
      afterResponse = () => {};

      reply = page(3, 3, [[3, change(9)]]);
      await local.restart();
      await assert.rejects(worker(legacy).run({ branchId: branch, skipMembership: true }), { code: "ESYNC_GROUPED_LEGACY_FENCED" });
      assert.equal(await legacyCursor(), "83");
      await manager.pool.request().input("key", key).input("branch", branch).query(`
        INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version)
        VALUES(N'pos_store_settings',@key,N'update',@branch,9);`);
      const restarted = coordinator(enrollment);
      assert.deepEqual(await restarted.runGroupedSettingsPilot(), { ...partial, status: "DEFERRED", reason: "ELOCAL_UPLOAD_PENDING" });
      assert.equal((await saved()).row_version, 8);
      assert.deepEqual([calls.at(-1).afterSeq, calls.at(-1).upperSeq], [seq(2), seq(3)]);
      await manager.pool.request().query("UPDATE dbo.sync_change_journal SET acknowledged_at=SYSDATETIMEOFFSET();");
      const done = { ...partial, status: "CAUGHT_UP", position: { epoch, seq: seq(3), upper: null } };
      assert.deepEqual(await restarted.runGroupedSettingsPilot(), done);
      assert.deepEqual(restarted.snapshot().groupedSettingsPilot, done);
      assert.equal((await saved()).row_version, 9);
      assert.equal((await cursor()).seq, seq(3));
      assert.equal(String((await checkpoints.get(branch, "__feed__", "pull")).committed_cursor), "83");

      status = 404;
      reply = { ok: false, code: "GROUPED_FEED_UNAVAILABLE" };
      assert.deepEqual(await restarted.runGroupedSettingsPilot(), { ...done, status: "UNAVAILABLE", reason: "GROUPED_FEED_UNAVAILABLE" });
      assert.equal((await saved()).row_version, 9);
      assert.equal((await cursor()).seq, seq(3));
      assert.equal(legacyRuns, 1);

      status = 200;
      reply = page(4, 4, [[4, change(10, { updated_at: "2026-11-07T04:30:10.1234567Z" })]]);
      afterResponse = () => { restarted.pause(); };
      assert.deepEqual(await restarted.runGroupedSettingsPilot(), { ...done, status: "PAUSED" });
      assert.equal((await saved()).row_version, 9);
      afterResponse = () => {};
      restarted.resume();

      const save = checkpoints.save.bind(checkpoints);
      checkpoints.save = async (...args) => {
        await save(...args);
        restarted.pause();
      };
      try { assert.deepEqual(await restarted.runGroupedSettingsPilot(), { ...done, status: "PAUSED" }); }
      finally { checkpoints.save = save; }
      assert.equal((await saved()).row_version, 9);
      assert.equal((await cursor()).seq, seq(3));
      restarted.resume();
      assert.equal((await restarted.runGroupedSettingsPilot()).position.seq, seq(4));
      assert.equal((await saved()).row_version, 10);
    });

    console.log("PASS " + passed + " isolated LocalDB grouped settings cases");
  } finally {
    globalThis.fetch = fetchBefore;
    await local?.close();
  }
}

async function postgresWire({ baseline, page, send, terminalId = terminal, deviceBindingProof = registration.deviceBindingProof }) {
  const scope = baseline?.scope_id;
  assert.equal(typeof scope, "string");
  assert(scope.length > 0 && scope.length <= 128);
  const before = JSON.parse(baseline.manifest_json).changes[0].row_data;
  assert.equal(before.store_id, scope);
  const fetchBefore = globalThis.fetch;
  let local;
  try {
    local = await createLocal(scope);
    const { manager, registry } = local;
    manager.profile = { id: "owned-postgres-wire", host: "owned-private-pipe", database: "owned-postgres-wire" };
    const settings = registry.tables.find(table => table.cloudTable === TABLE);
    const shift = id(991);
    await local.insert("shifts", { id: shift, store_id: scope, terminal_id: terminalId, state: "ACTIVE", status: "OPEN", row_version: 1 });
    await manager.pool.request().input("branch", scope).input("key", JSON.stringify({ id: shift })).query(`
      INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version)
      VALUES(N'shifts',@key,N'insert',@branch,1);`);
    const requests = [];
    globalThis.fetch = async (target, options) => {
      if (send && target !== url + "/api/v1/pos/sync") return fetchBefore(target, options);
      assert.equal(target, url + "/api/v1/pos/sync");
      const body = JSON.parse(options.body);
      assert.equal(body.terminalToken, terminalId);
      assert.equal(body.deviceBindingProof, deviceBindingProof);
      const read = body.sqlServerGroupedSnapshot ?? body.sqlServerGroupedFeed;
      requests.push(read);
      assert.equal(read.branchId, scope);
      if (send) return send(new Request(target, options));
      return Response.json(body.sqlServerGroupedSnapshot ? baseline : page);
    };
    const cloud = new CloudClient({ configStore: { get: () => url },
      terminalStore: { read: () => ({ ...registration, tokenId: terminalId, locationId: scope, deviceBindingProof }) },
      connectionManager: manager, financialBasisContext: () => ({ ...originalProject, branchId: scope }) });
    const checkpoints = new CheckpointRepository(manager);
    const worker = new PullWorker({ connectionManager: manager, cloud, registry, checkpoints,
      reader: new ChangeReader(manager, registry) });
    const initial = JSON.parse(baseline.manifest_json).changes[0];
    await cloud.applyLocalBatchToPool(manager, settings, [initial]);
    await checkpoints.save(scope, "__feed__", "pull", { committed_cursor: "1" });
    const coordinator = new SyncCoordinator({ pullWorker: worker, pushWorker: {}, groupedSettingsPilot: {
      branchId: scope, terminalId, backendOrigin: url, projectOrigin: originalProject.projectOrigin,
      databaseGuid: await readDatabaseGuid(manager.pool.request()),
    } });
    assert.deepEqual(await coordinator.prepareGroupedSettingsHandoff(), { epoch: baseline.epoch, seq: baseline.seq, changed: false });
    const update = typeof page === "function" ? await page() : page;
    assert.equal(update.scope_id, scope);
    const after = update.groups.at(-1).changes[0].row_data;
    assert.equal(after.store_id, scope);
    const changed = settings.columns.find(column => column.sqlServerType === "bit" &&
      before[column.cloudColumn] !== after[column.cloudColumn]);
    assert(changed, "The actual Postgres feed must carry an observable settings change.");
    const readFlag = async () => (await manager.pool.request().input("branch", scope).query(
      `SELECT [${changed.sqlServerColumn}] AS actual FROM dbo.pos_store_settings WHERE store_id=@branch;`)).recordset[0].actual;
    assert.equal(await readFlag(), before[changed.cloudColumn]);
    const result = await coordinator.runGroupedSettingsPilot();
    assert.equal(result.status, "CAUGHT_UP");
    assert.equal(result.position.seq, update.next_seq);
    assert.equal(requests[1].afterSeq, baseline.seq);
    assert.equal(await readFlag(), after[changed.cloudColumn]);
    if (typeof after.max_drawer_cash_limit === "string") {
      const saved = await manager.pool.request().input("branch", scope).input("value", after.max_drawer_cash_limit).query(
        "SELECT CASE WHEN max_drawer_cash_limit=CONVERT(decimal(38,12),@value) THEN 1 ELSE 0 END AS matches FROM dbo.pos_store_settings WHERE store_id=@branch;");
      assert.equal(saved.recordset[0].matches, 1);
    }
    assert.equal(JSON.parse((await checkpoints.get(scope, CHECKPOINT, "pull")).committed_cursor).seq, update.next_seq);
    assert.equal((await manager.pool.request().input("shift", shift).query("SELECT state FROM dbo.shifts WHERE id=@shift;")).recordset[0].state, "ACTIVE");
    assert.equal((await manager.pool.request().query("SELECT COUNT(*) AS n FROM dbo.sync_change_journal WHERE entity_type=N'shifts' AND acknowledged_at IS NULL;")).recordset[0].n, 1);
    console.log("PASS actual PostgreSQL snapshot and group applied by the native LocalDB worker" +
      (send ? " through the grouped relay handler" : ""));
  } finally {
    globalThis.fetch = fetchBefore;
    await local?.close();
  }
}

if (require.main === module) {
  const run = async () => process.argv.slice(2).join(" ") === "--postgres-wire"
    ? postgresWire(JSON.parse(require("node:fs").readFileSync(0, "utf8")))
    : main();
  run().catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { postgresWire };
