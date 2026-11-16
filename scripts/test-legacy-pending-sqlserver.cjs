"use strict";
// Native ODBC regression only. No configured POS connection or network is used.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createOwnedUpgradeFixture } = require("./lib/owned-upgrade-fixture.cjs");
const { sourceModules } = require("./package-existing-local-upgrade.cjs");
const { LegacyShiftRecoveryService } = require("../electron/sync/legacy-shift-recovery-service.cjs");
const { ShiftRecoveryEvidenceStore } = require("../electron/db/shift-recovery-evidence.cjs");
const { LegacyShiftRecoveryOutbox } = require("../electron/db/legacy-shift-recovery-outbox.cjs");
const { ReviewedShiftAdoption } = require("../electron/sync/reviewed-shift-adoption.cjs");
const { sqlErrorDiagnostic } = require("../electron/db/sql-error-diagnostic.cjs");

async function main() {
  assert.deepEqual(process.argv.slice(2), ["--run"], "Only --run is accepted; no connection arguments");
  const f = await createOwnedUpgradeFixture();
  try {
    await f.installCore();
    for (const module of sourceModules()) await f.pool.request().batch(module.sql);
    const context = { branchId: "text-shop", terminalId: "text-till", backendOriginHash: "a".repeat(64), profileKey: "owned-fixture" };
    const registry = require("../electron/db/schema-registry.cjs").loadRegistry();
    let service, network = 0;
    const assertScope = (tx, scope) => service.assertScope(tx, scope);
    const authority = { capture: () => { throw Error("Pending reads must not request approval"); } };
    const cloud = { pushLegacyRecovery: () => { network++; throw Error("No network is permitted"); } };
    const evidenceStore = new ShiftRecoveryEvidenceStore({ connectionManager: f.manager, registry, assertScope });
    const outbox = new LegacyShiftRecoveryOutbox({ connectionManager: f.manager, registry, assertScope, evidenceStore, authority });
    const adopter = new ReviewedShiftAdoption({ connectionManager: f.manager, registry, assertScope, evidenceStore, outbox, authority });
    service = new LegacyShiftRecoveryService({ connectionManager: f.manager, registry, cloud, evidenceStore, outbox, authority, adopter, readContext: () => context });
    const summary = pending => ({ available: true, adoptionAvailable: true, uploadPending: pending, convergencePending: 0, pending });
    assert.deepEqual(await service.pendingSummary(), summary(0));
    assert.deepEqual(await service.pushPending({ branchId: context.branchId }), {
      skipped: false, acknowledged: 0, pushed: 0, ...summary(0), downloadRecoveryComplete: false,
    });
    await assert.rejects(service.pushPending({ branchId: "another-shop" }), { code: "SYNC_BRANCH_FORBIDDEN" });
    console.log("PASS native preflights, zero counts and empty retry for text branch/terminal scope");

    // Synthetic pending evidence is deliberately not signed or sent anywhere.
    // Counting it must preserve the unknown/unaccepted work rather than ACK it.
    await f.pool.request().input("capture", "b".repeat(64)).input("database", f.guid)
      .input("branch", context.branchId).input("terminal", context.terminalId).input("backend", context.backendOriginHash)
      .input("shift", randomUUID()).input("job", randomUUID()).input("recovery", randomUUID())
      .input("reviewer", randomUUID()).input("key", randomUUID()).query(`
      INSERT dbo.pos_shift_recovery_evidence(capture_key,owner_tag,format_tag,codec_version,database_guid,branch_id,terminal_id,
        backend_origin_hash,shift_id,job_id,local_sha256,cloud_sha256,local_graph_json,cloud_graph_json,classification,reason_code,captured_at)
      VALUES(@capture,'retail.shift-recovery','retained-graph-v1',1,@database,@branch,@terminal,@backend,@shift,@job,
        @capture,@capture,N'[]',N'[]','unverified-difference-needs-review','owned-fixture',SYSDATETIMEOFFSET());
      INSERT dbo.pos_sync_shift_legacy_recoveries(recovery_id,capture_key,database_guid,branch_id,terminal_id,backend_origin_hash,
        shift_id,reviewer_id,key_id,payload_hash,payload_json,proof_json,created_at)
      VALUES(@recovery,@capture,@database,@branch,@terminal,@backend,@shift,@reviewer,@key,@capture,N'{}',N'{}',SYSDATETIMEOFFSET());`);
    assert.deepEqual(await service.pendingSummary(), summary(1));
    for (const [field, value] of [["branchId", "TEXT-shop"], ["terminalId", "other-till"], ["backendOriginHash", "c".repeat(64)]]) {
      const before = context[field]; context[field] = value;
      try { assert.deepEqual(await service.pendingSummary(), summary(0)); }
      finally { context[field] = before; }
    }
    assert.deepEqual(await service.pendingSummary(), summary(1));
    console.log("PASS real pending count with exact case-sensitive branch/terminal/backend isolation");

    let failure;
    try { await f.pool.request().query("INSERT dbo.pos_sync_shift_legacy_recoveries SELECT * FROM dbo.pos_sync_shift_legacy_recoveries;"); }
    catch (error) { failure = error; }
    assert(failure, "Duplicate pending event must fail");
    assert.deepEqual(sqlErrorDiagnostic(failure), { sqlNumber: 2627 });
    assert.deepEqual(await service.pendingSummary(), summary(1));
    const state = (await f.pool.request().query(`SELECT
      (SELECT COUNT(*) FROM dbo.pos_sync_shift_legacy_recoveries) events,
      (SELECT COUNT(*) FROM dbo.pos_sync_shift_legacy_recovery_receipts) receipts,
      (SELECT COUNT(*) FROM dbo.pos_shift_recovery_adoptions) adoptions;`)).recordset[0];
    assert.deepEqual(state, { events: 1, receipts: 0, adoptions: 0 });
    assert.equal(network, 0);
    console.log("PASS native primary error survives termination wrapper; pending work and zero ACKs preserved");
  } finally { await f.close(); }
}
if (require.main === module) main().catch(error => {
  console.error(JSON.stringify({ code: error.code ?? "ETEST", ...sqlErrorDiagnostic(error), message: error.message }));
  process.exitCode = 1;
});
