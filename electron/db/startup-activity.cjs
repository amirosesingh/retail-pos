// Read-only startup telemetry. It never releases readiness or starts work.
const PHASES = new Set([
  "preparing",
  "authorizing",
  "uploading",
  "downloading",
  "applying",
  "checking",
  "retaining",
]);
function reportActivity(sink, value) {
  try {
    sink(value);
  } catch {
    /* Progress cannot reject accepted database work. */
  }
}
function failureKind(error) {
  const code = String(error?.code ?? ""),
    message = String(error?.message ?? error ?? ""),
    status = Number(error?.status ?? error?.statusCode ?? 0);
  if (
    /SYNC_SHIFT_GRAPH_CONFLICT|SYNC_SHIFT_GRAPH_MISSING|SYNC_SHIFT_TARGET_FACTS_INVALID|ESYNC_APPLY_CONFLICT|EHISTORY_CONFLICT/.test(
      `${code} ${message}`,
    )
  )
    return { failure: "blocked", reason: "shift-data" };
  if (
    [401, 403].includes(status) ||
    /EPRIVILEGE|EPERMISSION|EAUTH|EACTIVATION|ESYNC_SHIFT_AUTHOR|ESHIFT_AUTHOR/.test(code)
  )
    return { failure: "blocked", reason: "authorization" };
  if (
    [400, 404, 422].includes(status) ||
    /ESCHEMA|EDRIVER_MISSING|ETLS|EDATABASE|EDPAPI|EBADARG|EBRANCH/.test(code)
  )
    return { failure: "blocked", reason: "configuration" };
  if (
    [429, 500, 502, 503, 504].includes(status) ||
    /^(?:HTTP_(?:429|500|502|503|504)|E(?:CONNECTION|CONNRESET|CONNREFUSED|TIMEOUT|TIMEDOUT|OFFLINE|HOSTUNREACH|NETUNREACH|PIPE|DNS))$/.test(
      code,
    ) ||
    /timed? out|timeout|failed to fetch|network (?:error|unavailable)|server did not answer/i.test(
      message,
    )
  )
    return { failure: "temporary", reason: "connection" };
  return { failure: "blocked", reason: "unknown" };
}
class StartupActivity {
  constructor({
    identity = () => [],
    publish = () => {},
    now = () => new Date().toISOString(),
  } = {}) {
    Object.assign(this, { identity, publish, now });
    this.entry = null;
    this.unresolved = null;
  }
  matches(entry) {
    try {
      const current = this.identity();
      return (
        this.entry === entry &&
        current.length === entry.identity.length &&
        current.every((value, index) => value === entry.identity[index])
      );
    } catch {
      return false;
    }
  }
  snapshot() {
    const entry = this.entry;
    return entry && this.matches(entry) ? { ...entry.value } : null;
  }
  emit() {
    try {
      this.publish();
    } catch {
      /* A status subscriber must never fail database work. */
    }
  }
  begin() {
    let identity;
    try {
      identity = this.identity();
    } catch {
      this.entry = null;
      this.emit();
      return { report: () => {}, finish: () => {} };
    }
    const scope = identity.slice(1);
    const previous =
      this.unresolved && JSON.stringify(scope) === JSON.stringify(this.unresolved.scope)
        ? this.unresolved.value
        : this.snapshot();
    const unresolved = previous?.failure
      ? { failure: previous.failure, reason: previous.reason }
      : {};
    const entry = {
      identity,
      value: { active: true, phase: "preparing", ...unresolved, updatedAt: this.now() },
    };
    this.entry = entry;
    this.emit();
    return {
      report: (next = {}) => {
        if (!this.matches(entry)) return;
        const table =
          typeof next.table === "string" && /^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/.test(next.table)
            ? next.table
            : undefined;
        const processedRows =
          Number.isSafeInteger(next.processedRows) && next.processedRows >= 0
            ? next.processedRows
            : undefined;
        const unresolved = entry.value.failure
          ? { failure: entry.value.failure, reason: entry.value.reason }
          : {};
        entry.value = {
          active: true,
          phase: PHASES.has(next.phase) ? next.phase : "preparing",
          ...(table ? { table } : {}),
          ...(processedRows !== undefined ? { processedRows } : {}),
          ...unresolved,
          updatedAt: this.now(),
        };
        this.emit();
      },
      finish: (error, { complete = true, paused = false } = {}) => {
        if (!this.matches(entry)) return;
        const value = {
          active: false,
          phase: error || !complete ? "waiting" : "complete",
          updatedAt: this.now(),
        };
        entry.value = {
          ...value,
          ...(paused ? { paused: true } : {}),
          ...(error
            ? entry.value.failure === "blocked"
              ? { failure: entry.value.failure, reason: entry.value.reason }
              : failureKind(error)
            : !complete && entry.value.failure
              ? { failure: entry.value.failure, reason: entry.value.reason }
              : {}),
        };
        this.unresolved = entry.value.failure
          ? {
              scope: entry.identity.slice(1),
              value: { failure: entry.value.failure, reason: entry.value.reason },
            }
          : null;
        this.emit();
      },
    };
  }
}
module.exports = { StartupActivity, failureKind, reportActivity };
