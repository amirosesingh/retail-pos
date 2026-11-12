"use strict";

const messages = Object.freeze({
  EPRIVILEGE: "Unlock Emergency Access again before repairing terminal registration.",
  EACTIVATION_REPAIR_STORE: "The previous terminal binding could not be read safely. Your saved setup has been kept. Retry recovery before changing registration.",
  EACTIVATION_REPAIR_EXISTING: "A saved native registration is available. Retry saved registration before changing activation.",
  EACTIVATION_REPAIR_DATABASE: "Connect the saved local database to check pending transactions before registering this terminal again.",
  EACTIVATION_REPAIR_DATABASE_UNKNOWN: "The saved local database configuration is unavailable. Registration cannot safely change until the previous local work can be verified. Your saved setup has been kept.",
  EACTIVATION_REPAIR_PENDING: "Synchronize or review pending local transactions and store settings edits before changing terminal registration.",
  EACTIVATION_REPAIR_CONTEXT: "The registration, connection or recovery session changed. Check the current setup and retry.",
  EACTIVATION_REPAIR_CHECK: "Pending local work could not be verified. Keep the saved local database connected and retry.",
});
const refusal = code => ({ ok: false, ready: false, code, error: messages[code],
  ...(code === "EACTIVATION_REPAIR_DATABASE" ? { requiresLocalDatabase: true } : {}) });
const fail = code => { throw Object.assign(new Error(messages[code]), { code }); };
const target = profile => {
  if (!profile || typeof profile !== "object" || Array.isArray(profile) || typeof profile.host !== "string" || !profile.host.trim() ||
      typeof profile.database !== "string" || !profile.database.trim() || !["windows","sql"].includes(profile.authMode) ||
      (profile.authMode==="sql" && (typeof profile.username!=="string" || !profile.username.trim()))) return null;
  return JSON.stringify([profile.host, profile.instanceName ?? "", Number(profile.port) || 0, profile.database,
    profile.authMode, profile.authMode === "sql" ? profile.username : ""]);
};

// Read-only prerequisites, never an activation grant. Pin the retained target
// so an empty replacement database cannot stand in for the previous local work.
function createTerminalRepair({ terminalStore, activationBoundary, adminSession, databaseManager,
  databaseConfig, cloudCredentials, configStore, withExclusive, canCheck = () => true }) {
  let pinned = null;
  const authorized = () => adminSession.hasLevel("admin") || adminSession.recoveryActive();
  const capture = () => ({
    active: terminalStore.read({ strict: true }), previous: terminalStore.lastBinding({ strict: true }),
    provisioned: terminalStore.wasProvisioned(), cloud: cloudCredentials.read({ strict: true }),
    backend: configStore.getStrict("backendUrl"), profile: configStore.getStrict("localDatabaseProfile"),
  });
  const check = () => {
    if (!authorized()) fail("EPRIVILEGE");
    if (!canCheck()) fail("EACTIVATION_REPAIR_CONTEXT");
    let source;
    try { source = capture(); } catch { fail("EACTIVATION_REPAIR_STORE"); }
    if (source.active) fail("EACTIVATION_REPAIR_EXISTING");
    let previous;
    try { previous = activationBoundary.binding(source.previous); } catch { fail("EACTIVATION_REPAIR_STORE"); }
    if ((source.provisioned || source.previous) && !previous) fail("EACTIVATION_REPAIR_STORE");
    const identity = JSON.stringify(source);
    const retained = JSON.stringify([previous,source.provisioned,target(source.profile)]);
    if (pinned !== null && retained !== pinned) fail("EACTIVATION_REPAIR_CONTEXT");
    pinned = retained;
    if (previous && !target(source.profile)) fail("EACTIVATION_REPAIR_DATABASE_UNKNOWN");
    return { source, previous, identity, epoch: adminSession.epoch() };
  };
  const current = (saved, pool) => {
    const next = check();
    if (next.identity !== saved.identity || next.epoch !== saved.epoch ||
        (pool !== undefined && databaseManager.pool !== pool)) fail("EACTIVATION_REPAIR_CONTEXT");
  };
  const guarded = async work => {
    try { return await work(); }
    catch (error) { return refusal(Object.hasOwn(messages, error?.code) ? error.code :
      error?.code === "ESETTINGS_EDIT_PENDING" ? "EACTIVATION_REPAIR_PENDING" : "EACTIVATION_REPAIR_CHECK"); }
  };
  async function assertReady() {
    const saved = check();
    if (!saved.previous) return;
    if (!databaseManager.isConnected() || !databaseManager.pool) fail("EACTIVATION_REPAIR_DATABASE");
    if (target(databaseManager.profile) !== target(saved.source.profile)) fail("EACTIVATION_REPAIR_CONTEXT");
    const pool = databaseManager.pool;
    await withExclusive(async () => {
      current(saved, pool);
      await assertPendingWorkClear(pool, saved.previous, saved.source.profile.database);
      current(saved, pool);
    });
    current(saved, pool);
  }
  return {
    status: () => guarded(async () => { await assertReady(); return { ok: true, ready: true }; }),
    connect: () => guarded(async () => {
      const saved = check();
      if (!saved.previous) return { ok: true, ready: true };
      let credentials;
      try { credentials = databaseConfig.credentials(); } catch { fail("EACTIVATION_REPAIR_DATABASE_UNKNOWN"); }
      if (target(credentials) !== target(saved.source.profile)) fail("EACTIVATION_REPAIR_DATABASE_UNKNOWN");
      current(saved);
      // No saving, enabling, migrating, bootstrapping, acknowledging queues or
      // publishing trading readiness: only connect the retained target.
      await withExclusive(async () => {
        current(saved);
        const pool = await databaseManager.open(credentials);
        current(saved, pool);
      });
      await assertReady();
      return { ok: true, ready: true };
    }),
    assertReady,
    complete: () => { pinned = null; },
  };
}

async function assertPendingWorkClear(pool, previous, database) {
  const names = ["pos_sync_shift_intents", "pos_shift_recovery_evidence", "pos_sync_shift_legacy_recoveries",
    "pos_sync_shift_legacy_recovery_receipts", "pos_shift_recovery_adoptions", "pos_sync_sale_outbox_v1", "pos_sync_sale_acceptance_v1"];
  const base = await pool.request().input("database", database).input("branch", previous.branchId ?? null).query(`
    SELECT CASE WHEN DB_ID()=DB_ID(@database) THEN 1 ELSE 0 END matches_profile,
      CASE WHEN EXISTS(SELECT 1 FROM dbo.sync_change_journal WHERE acknowledged_at IS NULL
        AND (@branch IS NULL OR branch_id IN (@branch,'global') OR NULLIF(LTRIM(RTRIM(branch_id)),N'') IS NULL)) THEN 1 ELSE 0 END journal_pending,
      CASE WHEN EXISTS(SELECT 1 FROM dbo.sync_conflicts WHERE status='unresolved') THEN 1 ELSE 0 END conflict_pending,
      CASE WHEN EXISTS(SELECT 1 FROM dbo.shifts WHERE (@branch IS NULL OR store_id=@branch)
        AND COALESCE(state,CASE WHEN closed_at IS NULL THEN 'ACTIVE' ELSE 'CLOSED' END) NOT IN ('ACTIVE','CLOSED')) THEN 1 ELSE 0 END shift_pending;
    SELECT CASE WHEN USER_NAME()=N'dbo' THEN 1 ELSE 0 END metadata_visible,
      ${names.map((name, index) => `OBJECT_ID(N'dbo.${name}') object_${index},OBJECT_ID(N'dbo.${name}',N'U') table_${index}`).join(",\n      ")};
  `);
  const row = base.recordsets?.[0]?.[0], schema = base.recordsets?.[1]?.[0];
  if (!row || row.matches_profile !== 1 || [row.journal_pending,row.conflict_pending,row.shift_pending].some(value=>![0,1].includes(value))) fail("EACTIVATION_REPAIR_CHECK");
  if (row.journal_pending || row.conflict_pending || row.shift_pending) fail("EACTIVATION_REPAIR_PENDING");
  if (!schema || names.some((_, index) =>
    !Object.hasOwn(schema, `object_${index}`) || !Object.hasOwn(schema, `table_${index}`) || schema[`object_${index}`] !== schema[`table_${index}`])) fail("EACTIVATION_REPAIR_CHECK");
  if (names.some((_,index)=>schema[`table_${index}`]===null) && schema.metadata_visible!==1) fail("EACTIVATION_REPAIR_CHECK");
  const present = index => schema[`table_${index}`] !== null;
  const pending = async query => {
    const result = await pool.request().input("branch", previous.branchId ?? null).input("terminal", previous.id).query(query);
    if (!Array.isArray(result.recordset)) fail("EACTIVATION_REPAIR_CHECK");
    if (result.recordset.length) fail("EACTIVATION_REPAIR_PENDING");
  };
  if (present(0)) await pending(`SELECT TOP (1) 1 pending FROM dbo.pos_sync_shift_intents
    WHERE acknowledged_at IS NULL AND (@branch IS NULL OR branch_id=@branch);`);
  if ([1, 2, 3].some(present)) {
    if (![1, 2, 3].every(present)) fail("EACTIVATION_REPAIR_CHECK");
    const adoption = present(4) ? "NOT EXISTS(SELECT 1 FROM dbo.pos_shift_recovery_adoptions a WHERE a.receipt_recovery_id=e.recovery_id)" : "1=1";
    await pending(`SELECT TOP (1) 1 pending FROM dbo.pos_sync_shift_legacy_recoveries e
      WHERE (@branch IS NULL OR e.branch_id=@branch) AND e.terminal_id=@terminal
      AND (NOT EXISTS(SELECT 1 FROM dbo.pos_sync_shift_legacy_recovery_receipts r WHERE r.recovery_id=e.recovery_id) OR ${adoption});`);
  } else if (present(4)) fail("EACTIVATION_REPAIR_CHECK");
  if (present(5) || present(6)) {
    if (!present(5) || !present(6)) fail("EACTIVATION_REPAIR_CHECK");
    await pending(`SELECT TOP (1) 1 pending FROM dbo.pos_sync_sale_outbox_v1 saved
      LEFT JOIN dbo.pos_sync_sale_acceptance_v1 accepted ON accepted.operation_id=saved.operation_id
      WHERE (@branch IS NULL OR saved.branch_id=@branch) AND accepted.operation_id IS NULL;`);
  }
  if (previous.branchId && previous.id)
    await require("./db/store-settings-edit-outbox.cjs").assertStoreSettingsEditReassignmentClear(pool, { branchId: previous.branchId, terminalId: previous.id });
}

module.exports = { createTerminalRepair, assertPendingWorkClear };
