const { fail, MIXED_CHECKPOINT } = require("./grouped-store-settings.cjs");

const CHECKPOINT = "__grouped_settings_handoff_v1__";
const groupedTransactions = new WeakMap();

async function readFence(request, branchId, locked = false) {
  const result = await request.input("branch", branchId).input("entity", CHECKPOINT).query(`
    SELECT committed_cursor FROM dbo.sync_checkpoints ${locked ? "WITH (UPDLOCK,HOLDLOCK)" : ""}
    WHERE organization_id=N'default' AND branch_id=@branch AND entity_type=@entity AND direction=N'pull';`);
  const rows = result.recordset ?? [];
  if (rows.length > 1) throw fail("The grouped settings handoff is ambiguous.", "ESYNC_GROUPED_HANDOFF_REQUIRED");
  return rows[0] ?? null;
}

function fenceValue({ source, databaseGuid }, legacyVersion = 0) {
  return JSON.stringify({ source: source.fingerprint, databaseGuid, ...(legacyVersion ? { legacyVersion } : {}) });
}

function assertGroupedFence(fence, context) {
  let legacyVersion;
  try { legacyVersion = JSON.parse(fence?.committed_cursor).legacyVersion ?? 0; }
  catch { /* No readable fence belongs to this source. */ }
  if (!Number.isInteger(legacyVersion) || legacyVersion < 0 || legacyVersion > 2147483647 ||
      fence.committed_cursor !== fenceValue(context, legacyVersion))
    throw fail("This database has no verified grouped settings handoff.", "ESYNC_GROUPED_HANDOFF_REQUIRED");
  return legacyVersion;
}

function authorizeGroupedApply(transaction, context, fence) {
  assertGroupedFence(fence, context);
  groupedTransactions.set(transaction, context.branch);
}

function legacyFenced() {
  return fail("The grouped settings pilot owns this store's local download. The legacy checkpoint remains pending.",
    "ESYNC_GROUPED_LEGACY_FENCED");
}

function legacySettingsVersion(changes, branchId) {
  let latest = 0;
  for (const change of changes) {
    let key;
    try { key = JSON.parse(change.entity_id); }
    catch { throw legacyFenced(); }
    const eventVersion = rowVersion(change.row_version);
    const currentVersion = rowVersion(change.row_data?.row_version);
    if (change.tombstone !== false || !key || Object.keys(key).length !== 1 || key.store_id !== branchId ||
        change.row_data?.store_id !== branchId || !eventVersion || currentVersion < eventVersion)
      throw legacyFenced();
    // The legacy feed looks up the current row for each event. Its projection
    // can already be newer than the event version stored beside the cursor.
    latest = Math.max(latest, currentVersion);
  }
  return latest;
}

function rowVersion(value) {
  if (typeof value === "string" && !/^[1-9]\d{0,9}$/.test(value)) return 0;
  if (typeof value !== "string" && typeof value !== "number") return 0;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= 2147483647 ? number : 0;
}

async function deleteFence(transaction, branchId) {
  await transaction.request().input("branch", branchId).input("entity", CHECKPOINT).query(`
    DELETE FROM dbo.sync_checkpoints
    WHERE organization_id=N'default' AND branch_id=@branch AND entity_type=@entity AND direction=N'pull';`);
}

async function assertLegacyApply(transaction, branchId) {
  if (branchId && groupedTransactions.get(transaction) !== branchId &&
      await readFence(transaction.request(), branchId, true)) throw legacyFenced();
}

async function isExtendedMixedFence(transaction, branchId) {
  const result = await transaction.request().input("branch", branchId).input("entity", MIXED_CHECKPOINT).query(`
    SELECT committed_cursor FROM dbo.sync_checkpoints WITH (UPDLOCK,HOLDLOCK)
    WHERE organization_id=N'default' AND branch_id=@branch AND entity_type=@entity AND direction=N'pull';`);
  const rows = result.recordset ?? [];
  if (!rows.length) return false;
  try {
    const position = JSON.parse(rows[0].committed_cursor);
    if (rows.length !== 1 || typeof position?.source !== "string" || !position.source ||
        typeof position.databaseGuid !== "string" || typeof position.epoch !== "string" ||
        typeof position.seq !== "string" || !/^\d+$/.test(position.seq) ||
        (Object.hasOwn(position, "extended") && position.extended !== true)) throw legacyFenced();
    return position.extended === true;
  } catch { throw legacyFenced(); }
}

async function assertCashHandbackClear(transaction, branch, epoch, sequence) {
  const result = await transaction.request().input("branch", branch).input("epoch", epoch).input("seq", sequence).query(`
    IF OBJECT_ID(N'dbo.pos_sync_sale_outbox_v1',N'U') IS NULL
       OR OBJECT_ID(N'dbo.pos_sync_sale_acceptance_v1',N'U') IS NULL
    BEGIN SELECT N'unverified' AS state; RETURN; END;
    EXEC sys.sp_executesql N'
      SELECT CASE WHEN EXISTS(
        SELECT 1 FROM dbo.pos_sync_sale_outbox_v1 AS saved WITH(UPDLOCK,HOLDLOCK)
        LEFT JOIN dbo.pos_sync_sale_acceptance_v1 AS accepted WITH(HOLDLOCK) ON accepted.operation_id=saved.operation_id
        WHERE saved.branch_id=@branch AND JSON_QUERY(saved.payload_json,''$.bridge.attestation'') IS NOT NULL
          AND (accepted.operation_id IS NULL OR JSON_VALUE(accepted.receipt_json,''$.epoch'') IS NULL
            OR JSON_VALUE(accepted.receipt_json,''$.epoch'')<>@epoch
            OR TRY_CONVERT(bigint,JSON_VALUE(accepted.receipt_json,''$.seq'')) IS NULL
            OR TRY_CONVERT(bigint,JSON_VALUE(accepted.receipt_json,''$.seq''))>CONVERT(bigint,@seq)))
        THEN N''pending'' ELSE N''clear'' END AS state;',
      N'@branch nvarchar(128),@epoch nvarchar(36),@seq nvarchar(20)',@branch=@branch,@epoch=@epoch,@seq=@seq;`);
  const state = result.recordset?.[0]?.state;
  if (state === "pending") throw fail("A grouped checkout still needs confirmation and download.", "ELOCAL_UPLOAD_PENDING");
  if (state !== "clear") throw fail("The saved checkout boundary could not be verified.", "ELOCAL_PENDING_UNVERIFIED");
}

module.exports = { CHECKPOINT, readFence, fenceValue, assertGroupedFence, authorizeGroupedApply, assertLegacyApply,
  legacyFenced, legacySettingsVersion, deleteFence, isExtendedMixedFence, assertCashHandbackClear };
