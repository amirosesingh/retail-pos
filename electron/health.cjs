/**
 * Boot health tracker.
 *
 * Every launch writes a "pending" marker before the UI loads. The renderer
 * calls app:ready once the till has actually mounted, which clears the marker
 * and records the running version as known-good. A launch that never reports
 * ready (crash, white screen, broken update) leaves the marker behind, so the
 * next launch can count the failure and fall back to safe mode.
 *
 * Nothing here touches the activation mirror or the local SQL Server data —
 * recovery never costs the branch its terminal registration.
 */
const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

const FAILURE_LIMIT = 2;
const file = () => path.join(app.getPath("userData"), "boot-health.json");

const EMPTY = {
  version: null,
  pending: false,
  closedBeforeReady: false,
  failures: 0,
  lastGoodVersion: null,
  lastGoodAt: null,
  lastFailureAt: null,
};

/** A record that cannot be parsed or is out of range must never block a launch. */
function sanitize(raw) {
  const state = { ...EMPTY, ...(raw && typeof raw === "object" ? raw : {}) };
  const failures = Number(state.failures);
  state.failures = Number.isFinite(failures) && failures > 0 ? Math.min(Math.floor(failures), 99) : 0;
  state.pending = state.pending === true;
  state.closedBeforeReady = state.closedBeforeReady === true;
  state.version = typeof state.version === "string" ? state.version : null;
  state.lastGoodVersion =
    typeof state.lastGoodVersion === "string" ? state.lastGoodVersion : null;
  return state;
}

function read() {
  try {
    return sanitize(JSON.parse(fs.readFileSync(file(), "utf8")));
  } catch {
    return { ...EMPTY };
  }
}

function save(next) {
  try {
    fs.writeFileSync(file(), JSON.stringify(next, null, 2), "utf8");
  } catch (err) {
    console.error("[health] cannot persist boot health:", err);
  }
  return next;
}

/**
 * Called before any window opens. Returns the state for this launch, including
 * whether the previous attempt died before the UI came up.
 *
 * Failures are version-scoped: an update replaces the build that was failing,
 * so its record can never keep the new build in recovery.
 */
function beginBoot() {
  const version = app.getVersion();
  const prev = read();
  const sameBuild = !prev.version || prev.version === version;
  if (!sameBuild && (prev.pending || prev.failures)) {
    console.warn(
      `[health] discarding failure record for ${prev.version}; ${version} is installed now`,
    );
  }
  // A pending marker from a previous run means that run never reached the UI.
  const carried = sameBuild && prev.pending;
  const failures = carried ? prev.failures + 1 : sameBuild && prev.closedBeforeReady ? prev.failures : 0;
  if (carried) console.error(`[health] previous launch of ${prev.version} never became ready`);
  return save({
    ...prev,
    version,
    pending: true,
    closedBeforeReady: false,
    failures,
    lastFailureAt: carried ? new Date().toISOString() : prev.lastFailureAt,
  });
}

/**
 * The launch went straight into recovery. The pending marker is cleared right
 * away so sitting in safe mode cannot count as further failed launches.
 */
function beginRecovery(reason) {
  const prev = read();
  return save({
    ...prev,
    pending: false,
    lastFailureAt: new Date().toISOString(),
    reason: reason ? String(reason) : prev.reason ?? null,
  });
}

/** The renderer mounted — this build works. */
function markHealthy() {
  const version = app.getVersion();
  countedThisLaunch = false;
  return save({
    ...read(),
    version,
    pending: false,
    closedBeforeReady: false,
    failures: 0,
    reason: null,
    lastGoodVersion: version,
    lastGoodAt: new Date().toISOString(),
  });
}

/** A confirmed normal quit can happen before the register finishes loading. */
function markClosed() {
  const state = read();
  if (state.version !== app.getVersion() || !state.pending) return state;
  return save({ ...state, pending: false, closedBeforeReady: true });
}

/** At most one failure is ever counted per launch. */
let countedThisLaunch = false;

/** The watchdog fired, or the app server refused to start. */
function markFailed(reason) {
  const prev = read();
  if (countedThisLaunch) {
    return save({ ...prev, pending: false, reason: reason ? String(reason) : prev.reason ?? null });
  }
  countedThisLaunch = true;
  console.error(`[health] launch of ${prev.version ?? "?"} failed: ${reason ?? "unknown reason"}`);
  return save({
    ...prev,
    pending: false,
    failures: prev.failures + 1,
    lastFailureAt: new Date().toISOString(),
    reason: reason ? String(reason) : prev.reason ?? null,
  });
}

/** Operator asked to try the current build again. */
function reset() {
  countedThisLaunch = false;
  return save({ ...read(), pending: false, failures: 0, reason: null });
}

const shouldEnterSafeMode = (state) => (state?.failures ?? 0) >= FAILURE_LIMIT;

module.exports = {
  read,
  beginBoot,
  beginRecovery,
  markHealthy,
  markClosed,
  markFailed,
  reset,
  shouldEnterSafeMode,
  FAILURE_LIMIT,
};
