// Opt-in disposable LocalDB fixture. The authority and receipt adapters are synthetic.
"use strict";

const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { createLocal } = require("./lib/shift-protocol-integration-fixture.cjs");
const { StoreSettingsEditOutbox, assertStoreSettingsEditHandbackClear,
  assertStoreSettingsEditReassignmentClear } = require("../electron/db/store-settings-edit-outbox.cjs");
const grouped = require("../electron/sync/grouped-store-settings.cjs");
const handoff = require("../electron/sync/grouped-settings-handoff.cjs");
const { createStoreSettingsEditRuntime } = require("../electron/sync/store-settings-edit-runtime.cjs");
const { CloudClient } = require("../electron/sync/cloud-client.cjs");
const { SyncCoordinator } = require("../electron/sync/coordinator.cjs");

async function main() {
  assert.deepEqual(process.argv.slice(2), ["--run"]);
  const branchId = randomUUID();
  const local = await createLocal(branchId);
  try {
    const { manager } = local;
    await assertStoreSettingsEditReassignmentClear(manager.pool, { branchId, terminalId: randomUUID() });
    await manager.pool.request().batch(readFileSync(join(__dirname, "preparation/pos-store-settings-edit-outbox-v1.sql"), "utf8"));
    await local.insert("pos_store_settings", { store_id: branchId, row_version: 7,
      block_shift_close_on_hold: true, max_drawer_cash_limit: 50 });
    const before = (await manager.pool.request().query("SELECT CHANGE_TRACKING_CURRENT_VERSION() AS version;")).recordset[0].version;
    const scope = { branchId, terminalId: randomUUID(), installationGeneration: randomUUID(),
      databaseGuid: await grouped.readDatabaseGuid(manager.pool.request()), feedEpoch: randomUUID() };
    const personId = randomUUID();
    let currentScope = scope;
    let activePerson = personId;
    const transactions = new WeakSet();
    const assertContext = (tx, candidate, person) => transactions.has(tx) && (person === null || activePerson === person) &&
      Object.keys(currentScope).every(key => candidate[key] === currentScope[key]);
    const witnesses = new WeakMap();
    const assertReceipt = witness => witnesses.get(witness);
    const repository = source => new StoreSettingsEditOutbox({ connectionManager: manager, scope: source, assertContext, assertReceipt });
    let outbox = repository(scope);
    const atomic = async work => {
      const sql = manager.sql();
      const tx = new sql.Transaction(manager.pool);
      await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      transactions.add(tx);
      try { const result = await work(tx); await tx.commit(); return result; }
      catch (error) { await tx.rollback().catch(() => undefined); throw error; }
      finally { transactions.delete(tx); }
    };
    await manager.pool.request().batch(`CREATE USER fixture_settings_reassign_reader WITHOUT LOGIN;
      GRANT SELECT ON dbo.sync_checkpoints TO fixture_settings_reassign_reader;`);
    const legacyLogin = work => atomic(async tx => {
      await tx.request().batch("EXECUTE AS USER=N'fixture_settings_reassign_reader';");
      try {
        const { visible, can_see_schema: canSeeSchema } = (await tx.request().query(`SELECT
          OBJECT_ID(N'dbo.pos_store_settings_edit_commands',N'U') AS visible,
          HAS_PERMS_BY_NAME(DB_NAME(),N'DATABASE',N'VIEW DEFINITION') AS can_see_schema;`)).recordset[0];
        assert.equal(visible, null);
        assert.equal(canSeeSchema, 0);
        return await work(tx);
      } finally { await tx.request().batch("REVERT;"); }
    });
    await legacyLogin(tx => assertStoreSettingsEditReassignmentClear(tx, scope));
    const counts = async () => (await manager.pool.request().query(`SELECT
      (SELECT COUNT(*) FROM dbo.pos_store_settings_edit_commands) AS commands,
      (SELECT COUNT(*) FROM dbo.pos_store_settings_edit_receipts) AS receipts,
      (SELECT COUNT(*) FROM dbo.sync_change_journal) AS journal,
      (SELECT COUNT(*) FROM dbo.local_operation_receipts) AS generic_receipts;`)).recordset[0];
    const make = (expectedVersion = 7) => ({ personId, operationId: randomUUID(), expectedVersion,
      patch: { block_shift_close_on_hold: false, max_drawer_cash_limit: "10000000000000.123456789123" } });
    const witness = (command, status = "APPLIED", changes = {}, commandSha256 = command.commandSha256) => {
      const proof = {};
      witnesses.set(proof, { commandSha256, receipt: { status, result: {
        scope_id: command.branchId, epoch: command.feedEpoch, operation_id: command.operationId,
        terminal_id: command.terminalId, person_id: command.personId, installation_generation: command.installationGeneration,
        database_guid: command.databaseGuid, expected_version: command.expectedVersion,
        ...(status === "REVIEW_REQUIRED" ? { code: "STALE_RULES" } : { row_version: command.expectedVersion + 1, seq: "9007199254740993" }),
        ...changes,
      } } });
      return proof;
    };

    const original = make();
    await assert.rejects(atomic(tx => outbox.capture(tx, make(6))), { code: "STALE_RULES" });
    await assert.rejects(atomic(tx => outbox.capture(tx, { ...original, patch: { idle_timeout_minutes: 1 } })), { code: "ESETTINGS_EDIT_INVALID" });
    await assert.rejects(atomic(tx => outbox.capture(tx, { ...original, patch: { max_drawer_cash_limit: 1.1 } })), { code: "ESETTINGS_EDIT_INVALID" });
    await assert.rejects(atomic(tx => outbox.capture(tx, { ...original, personId: randomUUID() })), { code: "ESETTINGS_EDIT_SCOPE" });
    await assert.rejects(atomic(async tx => {
      await outbox.capture(tx, original);
      throw new Error("fixture rollback");
    }), /fixture rollback/);
    assert.deepEqual(await counts(), { commands: 0, receipts: 0, journal: 0, generic_receipts: 0 });

    const concurrent = await Promise.allSettled([atomic(tx => outbox.capture(tx, original)), atomic(tx => outbox.capture(tx, make()))]);
    const saved = concurrent.find(result => result.status === "fulfilled")?.value;
    assert(saved);
    assert.equal(concurrent.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(concurrent.find(result => result.status === "rejected")?.reason.code, "ESETTINGS_EDIT_PENDING");
    assert.equal(saved.expectedVersion, 7);
    assert.equal(saved.patch.max_drawer_cash_limit, original.patch.max_drawer_cash_limit);
    assert.equal(createHash("sha256").update(saved.commandJson, "utf8").digest("hex"), saved.commandSha256);
    await local.restart();
    outbox = repository(scope);
    assert.deepEqual(await atomic(tx => outbox.readPending(tx, { personId })), saved);
    assert.deepEqual(await atomic(tx => outbox.readUpload(tx, { personId: null })), { status: "AWAITING_OPERATOR" });
    await assert.rejects(atomic(tx => assertStoreSettingsEditHandbackClear(tx, { ...scope, rowVersion: 7 })), { code: "ESETTINGS_EDIT_PENDING" });
    await assert.rejects(assertStoreSettingsEditReassignmentClear(manager.pool, scope), { code: "ESETTINGS_EDIT_PENDING" });
    await assertStoreSettingsEditReassignmentClear(manager.pool, { ...scope, terminalId: randomUUID() });
    const same = { personId, operationId: saved.operationId, expectedVersion: 7, patch: saved.patch };
    assert.deepEqual(await atomic(tx => outbox.capture(tx, same)), saved);
    await assert.rejects(atomic(tx => outbox.capture(tx, { ...same, patch: { block_shift_close_on_hold: true } })), { code: "ESETTINGS_EDIT_CONFLICT" });
    console.log("PASS same-operation bytes survive rollback, concurrent capture and LocalDB restart");

    activePerson = randomUUID();
    await assert.rejects(atomic(tx => outbox.readPending(tx, { personId: activePerson })), { code: "ESETTINGS_EDIT_SCOPE" });
    activePerson = personId;
    currentScope = { ...scope, installationGeneration: randomUUID() };
    await assert.rejects(atomic(tx => outbox.readPending(tx, { personId })), { code: "ESETTINGS_EDIT_SCOPE" });
    await assert.rejects(atomic(tx => repository(currentScope).readPending(tx, { personId })), { code: "ESETTINGS_EDIT_SCOPE" });
    currentScope = { ...scope, databaseGuid: randomUUID() };
    await assert.rejects(atomic(tx => repository(currentScope).readPending(tx, { personId })), { code: "ESETTINGS_EDIT_SCOPE" });
    currentScope = scope;
    console.log("PASS original person, installation generation and actual SQL database are required");

    const ack = proof => atomic(tx => outbox.acknowledge(tx, { personId, operationId: saved.operationId, witness: proof }));
    await assert.rejects(ack({}), { code: "ESETTINGS_EDIT_RECEIPT" });
    await assert.rejects(ack(witness(saved, "APPLIED", {}, "0".repeat(64))), { code: "ESETTINGS_EDIT_RECEIPT" });
    await assert.rejects(ack(witness(saved, "APPLIED", { expected_version: 6 })), { code: "ESETTINGS_EDIT_RECEIPT" });
    await assert.rejects(ack(witness(saved, "APPLIED", { row_version: 7 })), { code: "ESETTINGS_EDIT_RECEIPT" });
    assert.equal((await counts()).receipts, 0);
    const accepted = await ack(witness(saved));
    assert.deepEqual(await ack(witness(saved, "ALREADY_APPLIED")), accepted);
    await assert.rejects(ack(witness(saved, "APPLIED", { seq: "9007199254740994" })), { code: "ESETTINGS_EDIT_RECEIPT" });
    assert.equal(await atomic(tx => outbox.readPending(tx, { personId })), null);
    assert.deepEqual(await atomic(tx => outbox.readUpload(tx, { personId: null })), { status: "AWAITING_DOWNLOAD" });
    await assert.rejects(atomic(tx => assertStoreSettingsEditHandbackClear(tx, { ...scope, rowVersion: 7 })), { code: "ESETTINGS_EDIT_PENDING" });
    await assert.rejects(assertStoreSettingsEditReassignmentClear(manager.pool, scope), { code: "ESETTINGS_EDIT_PENDING" });
    await atomic(tx => assertStoreSettingsEditHandbackClear(tx, { ...scope, rowVersion: 8 }));
    await assert.rejects(atomic(tx => outbox.capture(tx, make())), { code: "ESETTINGS_EDIT_PENDING" });
    assert.deepEqual(await counts(), { commands: 1, receipts: 1, journal: 0, generic_receipts: 0 });
    const current = (await manager.pool.request().query("SELECT row_version,block_shift_close_on_hold,max_drawer_cash_limit FROM dbo.pos_store_settings;")).recordset[0];
    assert.equal(current.row_version, 7);
    assert.equal(current.block_shift_close_on_hold, true);
    assert.equal(Number(current.max_drawer_cash_limit), 50);
    const ct = (await manager.pool.request().input("baseline", Number(before)).query(`SELECT COUNT(*) AS changed
      FROM CHANGETABLE(CHANGES dbo.pos_store_settings,@baseline) AS ct;`)).recordset[0].changed;
    assert.equal(ct, 0);
    console.log("PASS verified acceptance is exact and idempotent without legacy settings, journal or Change Tracking writes");

    // Represents the independently verified canonical download advancing the saved store row.
    await manager.pool.request().query("UPDATE dbo.pos_store_settings SET row_version=8;");
    await assertStoreSettingsEditReassignmentClear(manager.pool, scope);
    const next = await atomic(tx => outbox.capture(tx, make(8)));
    const held = await atomic(tx => outbox.acknowledge(tx, { personId, operationId: next.operationId, witness: witness(next, "REVIEW_REQUIRED") }));
    assert.equal(held.disposition, "REVIEW_REQUIRED");
    assert.equal(await atomic(tx => outbox.readPending(tx, { personId })), null);
    await local.restart();
    assert.deepEqual(await atomic(tx => outbox.readUpload(tx, { personId: null })), { status: "REVIEW_REQUIRED" });
    await assert.rejects(atomic(tx => assertStoreSettingsEditHandbackClear(tx, { ...scope, rowVersion: 8 })), { code: "ESETTINGS_EDIT_PENDING" });
    await assert.rejects(assertStoreSettingsEditReassignmentClear(manager.pool, scope), { code: "ESETTINGS_EDIT_PENDING" });
    await assert.rejects(atomic(tx => outbox.capture(tx, make(8))), { code: "ESETTINGS_EDIT_PENDING" });
    await assert.rejects(manager.pool.request().query("DELETE FROM dbo.pos_store_settings_edit_receipts;"), /immutable/i);
    await assert.rejects(manager.pool.request().query("UPDATE dbo.pos_store_settings_edit_commands SET command_sha256=command_sha256;"), /immutable/i);
    assert.deepEqual(await counts(), { commands: 2, receipts: 2, journal: 0, generic_receipts: 0 });
    console.log("PASS stale review remains durable and blocks automatic rebase or a new edit");

    manager.profile = { id: "fixture-installed-settings", host: "fixture-private-pipe", database: "fixture-settings" };
    const enrollment = { branchId, terminalId: randomUUID(), databaseGuid: scope.databaseGuid,
      backendOrigin: "https://settings-relay.fixture", projectOrigin: "https://settings-project.fixture" };
    const cloud = new CloudClient({ configStore: { get: () => enrollment.backendOrigin }, terminalStore: { read: () => ({
      tokenId: enrollment.terminalId, locationId: branchId, deviceUse: "operations", deviceType: "pc", deviceBindingProof: "b".repeat(64),
    }) }, connectionManager: manager, financialBasisContext: () => ({ branchId, projectOrigin: enrollment.projectOrigin }) });
    cloud.setAuthorizationProof({ accessToken: "fixture-never-sent" });
    const coordinator = new SyncCoordinator({ pushWorker: {}, pullWorker: {} });
    let actor = { personId, branchId, epoch: 1 };
    const runtime = () => createStoreSettingsEditRuntime({ pilot: { mode: "run", enrollment }, installationGeneration: scope.installationGeneration,
      cloud, coordinator, connectionManager: manager, ready: () => true, actor: () => actor });
    const { personId: _person, ...input } = make(8);
    const draft = { ...input, branchId };
    assert.equal((await runtime().capture(draft)).code, "ESETTINGS_EDIT_UNAVAILABLE");
    const source = cloud.requestContext(false);
    const saveCheckpoint = async (entity, cursor) => manager.pool.request().input("branch", branchId).input("entity", entity).input("cursor", cursor)
      .query(`INSERT dbo.sync_checkpoints(branch_id,entity_type,direction,committed_cursor) VALUES(@branch,@entity,N'pull',@cursor);`);
    await saveCheckpoint(handoff.CHECKPOINT, handoff.fenceValue({ source, databaseGuid: scope.databaseGuid }));
    await saveCheckpoint(grouped.CHECKPOINT, JSON.stringify({ source: source.fingerprint, databaseGuid: scope.databaseGuid,
      epoch: scope.feedEpoch, seq: "1", upper: null }));
    await assert.rejects(legacyLogin(tx => assertStoreSettingsEditReassignmentClear(tx, enrollment)), { code: "ESETTINGS_EDIT_STATE" });
    await assert.rejects(atomic(tx => local.repository.applyOperation(tx, { table: "pos_store_settings", kind: "update",
      match: { store_id: branchId }, values: { block_shift_close_on_hold: false } }, { branchId })), { code: "ESYNC_GROUPED_LEGACY_FENCED" });
    assert.equal((await runtime().capture({ ...draft, branchId: randomUUID() })).code, "ESETTINGS_EDIT_UNAVAILABLE");
    assert.deepEqual(await runtime().capture(draft), { ok: true, operationId: draft.operationId });
    await local.restart();
    actor = null;
    assert.deepEqual(await runtime().upload(), { status: "AWAITING_OPERATOR", reason: null, branchId });
    assert.equal((await runtime().capture(draft)).code, "ESETTINGS_EDIT_OPERATOR");
    assert.deepEqual(await counts(), { commands: 3, receipts: 2, journal: 0, generic_receipts: 0 });
    console.log("PASS installed capture requires the scoped handoff and actor; restart preserves the queued command and fences the old native writer");
  } finally { await local.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
