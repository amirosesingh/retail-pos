"use strict";
// Adapter for the existing coordinator, not another queue or retry engine.
const COUNT_MESSAGE = "Saved closing upload status could not be verified. Pending work remains intact and will be checked again.";
const HOLD_MESSAGE = "Saved closing recovery is waiting for administrator review or connection recovery. Other eligible uploads can continue.";
const codeOf = error => typeof error?.code === "string" && /^(?:ELEGACY_RECOVERY_|ESYNC_SHIFT_AUTHOR_|ESHIFT_AUTHOR_|SYNC_BRANCH_FORBIDDEN|HTTP_)[A-Z0-9_]{0,80}$/.test(error.code) ? error.code : "ELEGACY_RECOVERY_PENDING";
const unsafe = error => ["SYNC_BRANCH_FORBIDDEN", "ELEGACY_RECOVERY_SCOPE", "ELEGACY_RECOVERY_BUSY", "ESYNC_SHIFT_AUTHOR_CHANGED"].includes(error?.code);
function createLegacyShiftRecoveryRuntime({ reader: baseReader, recovery, enabled, captureSource, activeBranch }) {
  let readFailure = null, hold = null, branch = null;
  const select = next => { if (branch !== String(next ?? "")) { branch = String(next ?? ""); readFailure = null; hold = null; } };
  const skip = () => { if (enabled()) return false; readFailure = null; hold = null; return true; };
  const reader = Object.create(baseReader);
  reader.pendingSummary = async branchId => {
    if (skip()) return baseReader.pendingSummary(branchId);
    select(branchId);
    try {
      const assertCurrent = captureSource();
      const summary = await baseReader.pendingSummary(branchId); assertCurrent();
      const saved = await recovery().pendingSummary(); assertCurrent();
      readFailure = null;
      if (!saved.pending) return summary;
      return { ...summary, pending: Number(summary.pending ?? 0) + saved.pending,
        queuedTables: [...(summary.queuedTables ?? []), { table: "legacy_shift_recovery", pending: saved.pending, failed: 0 }] };
    } catch (error) { readFailure = codeOf(error); throw error; }
  };
  async function run(options, ordinaryRun) {
    if (skip()) return ordinaryRun(options);
    select(options.branchId);
    const assertCurrent = captureSource(); let result = { pushed: 0, pending: null }, failure = null;
    try { result = await recovery().pushPending({ branchId: options.branchId, limit: 5 }); }
    catch (error) { failure = error; hold = codeOf(error); }
    // A changed trusted source must not continue into another profile/branch.
    assertCurrent();
    if (failure && unsafe(failure)) throw failure;
    if (!failure && result.pending === 0) hold = null;
    // A held historical review must not strand ordinary eligible sales. Its
    // immutable event remains pending; no failed response is acknowledged.
    const ordinary = await ordinaryRun(options); assertCurrent();
    return { ...ordinary, pushed: Number(ordinary?.pushed ?? 0) + Number(result?.pushed ?? 0),
      ...(hold ? { legacyRecoveryHeld: true, legacyRecoveryCode: hold } : {}) };
  }
  function status(snapshot) {
    if (skip()) return snapshot;
    select(activeBranch());
    if (!readFailure && !hold) return snapshot;
    const message = readFailure ? COUNT_MESSAGE : HOLD_MESSAGE;
    const lastError = typeof snapshot.lastError === "string" && snapshot.lastError && snapshot.lastError !== message
      ? snapshot.lastError + " " + message : message;
    return { ...snapshot, ...(readFailure ? { pending: null, pendingVerified: false } : {}), lastError,
      legacyRecovery: { held: Boolean(hold), pendingVerified: !readFailure, code: readFailure ?? hold, downloadRecoveryComplete: false } };
  }
  return Object.freeze({ reader, run, status });
}
module.exports = { createLegacyShiftRecoveryRuntime };
