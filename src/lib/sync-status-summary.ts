/** Presentation only. Queue counts describe their own transport; they do not
 * prove that historical Change Tracking rows reached the central database. */
export type NativeSyncSnapshot = {
  pending?: unknown;
  failed?: unknown;
  conflicts?: unknown;
  lastError?: unknown;
  lastPushAt?: unknown;
  lastPullAt?: unknown;
  phase?: unknown;
  running?: boolean;
  paused?: boolean;
  historyRecovery?: unknown;
};

export type NativeDatabaseSnapshot = {
  enabled?: boolean;
  connected?: boolean;
  tradingReady?: boolean;
  state?: string;
  detail?: { phase?: unknown; syncReady?: unknown; historyPending?: unknown; branchId?: unknown } | null;
};

export type SyncStatusSummary = {
  state: "ok" | "degraded" | "checking";
  label: string;
  detail: string;
  pending: number | null;
};

export type BrowserQueueSnapshot = import("./browser-sync-outbox").BrowserOutboxStatus;

export function isNativeDatabaseSnapshot(value: unknown): value is NativeDatabaseSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const snapshot = value as NativeDatabaseSnapshot;
  return typeof snapshot.enabled === "boolean" || typeof snapshot.connected === "boolean" || snapshot.state === "disabled";
}

function count(value: unknown): number | null {
  if ((typeof value !== "string" && typeof value !== "number") || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

export function nativeSyncSummary(
  snapshot: NativeSyncSnapshot | null | undefined,
  database: NativeDatabaseSnapshot = {},
  readFailed = false,
): SyncStatusSummary {
  const disabled = database.enabled === false || database.state === "disabled";
  if (readFailed || !snapshot) return {
    state: disabled ? "ok" : "degraded", label: disabled ? "Local sync disabled" : "Status unavailable",
    detail: disabled ? "Local SQL synchronization is disabled; saved local work has not been checked."
      : "Native synchronization status could not be read. Upload completion is not confirmed.", pending: null,
  };
  const pending = count(snapshot.pending);
  const failed = count(snapshot.failed);
  const conflicts = count(snapshot.conflicts);
  const error = typeof snapshot.lastError === "string" ? snapshot.lastError.trim() : "";
  if (error || failed || conflicts) return {
    state: "degraded", label: "Needs attention", pending,
    detail: [error, snapshot.running ? "Retrying synchronization; the previous failure is not yet resolved." : "", failed ? `${failed} failed journal upload${failed === 1 ? "" : "s"}.` : "",
      conflicts ? `${conflicts} unresolved conflict${conflicts === 1 ? "" : "s"}.` : "",
      "A zero queue count does not confirm that every local record uploaded."].filter(Boolean).join(" "),
  };
  if (disabled) return {
    state: pending ? "degraded" : "ok", label: "Local sync disabled", pending,
    detail: pending ? `${pending} journal change${pending === 1 ? " is" : "s are"} reported pending while local SQL synchronization is disabled.`
      : "Local SQL synchronization is disabled. Browser uploads use a separate queue.",
  };
  if (database.connected === false) return {
    state: "degraded", label: "Local SQL unavailable", pending,
    detail: "The local SQL connection is unavailable; native upload status is not confirmed.",
  };
  if (database.connected === true && database.tradingReady === false) return {
    state: "checking", label: "Preparing local database", pending,
    detail: "Local SQL is connected but preparation has not completed. Upload completion is not confirmed.",
  };
  if (snapshot.paused) return {
    state: "degraded", label: "Paused", pending, detail: "Native synchronization is paused; queued work is retained.",
  };
  if (snapshot.running || ["pushing", "pulling"].includes(String(snapshot.phase))) return {
    state: "checking", label: snapshot.phase === "pulling" ? "Receiving updates" : snapshot.phase === "pushing" ? "Sending updates" : "Synchronizing",
    detail: "Native synchronization is running. Its final result is not yet confirmed.", pending,
  };
  const history=snapshot.historyRecovery&&typeof snapshot.historyRecovery==='object'&&!Array.isArray(snapshot.historyRecovery)
    ?snapshot.historyRecovery as Record<string,unknown>:null;
  const policyHistoryPending = history?.pending === true && history.status === "retrying" &&
    history.code === "EHISTORY_POLICY_UNAVAILABLE";
  if (policyHistoryPending && (pending === null || pending === 0)) {
    const detail = database.detail;
    const checkoutReady = database.enabled === true && database.state === "enabled_ready" &&
      database.connected === true && database.tradingReady === true &&
      detail?.phase === "history_recovery" && detail.syncReady === false && detail.historyPending === true &&
      typeof detail.branchId === "string" && detail.branchId.length > 0 && detail.branchId === history.branchId;
    return {
      state: "degraded", label: checkoutReady ? "Checkout ready · History pending" : "History recovery waiting", pending,
      detail: [
        checkoutReady ? "The local checkout data is ready." : "",
        "The scoped history reader is temporarily unavailable. History remains pending and will retry automatically.",
        pending === null || failed === null || conflicts === null ? "Some local journal counts still need verification." : "",
        "Full synchronization still needs verification.",
      ].filter(Boolean).join(" "),
    };
  }
  if(history?.pending===true&&history.membershipOnly===true&&pending===0&&failed===0&&conflicts===0){
    const saved=count(history.completedRows),warning=typeof history.error==='string'?history.error.trim():'';
    return{state:warning?'degraded':'checking',label:warning?'History recovery waiting':'Recovering history',pending,
      detail:[warning,saved?`${saved} missing history record${saved===1?' has':'s have'} been saved locally.`:'Checking retained history for missing records.',
        'Recovery continues from saved progress. This does not acknowledge retained local uploads.'].filter(Boolean).join(' ')};
  }
  if (pending === null || failed === null || conflicts === null) return {
    state: "checking", label: "Checking synchronization", pending,
    detail: "The native journal queue and error counts have not all been confirmed.",
  };
  if (pending > 0) return {
    state: "degraded", label: "Waiting to upload", pending,
    detail: [`${pending} journal change${pending === 1 ? " is" : "s are"} waiting for central acknowledgement.`,
      policyHistoryPending ? "History also remains pending and will retry automatically." : ""].filter(Boolean).join(" "),
  };
  if (typeof snapshot.lastPushAt !== "string" || !Number.isFinite(Date.parse(snapshot.lastPushAt))) return {
    state: "checking", label: "Upload not confirmed", pending,
    detail: "No pending journal uploads reported. A successful native upload pass has not been reported.",
  };
  if (!isNativeDatabaseSnapshot(database)) return {
    state: "checking", label: "Database status not confirmed", pending,
    detail: "The local database status has not been confirmed. Queue counts alone do not confirm upload completion.",
  };
  return {
    state: "ok", label: "Journal queue clear", pending,
    detail: "No pending journal uploads reported. The queue count alone does not verify historical data completeness.",
  };
}

export function browserSyncSummary(snapshot: BrowserQueueSnapshot, online: boolean): SyncStatusSummary {
  if (snapshot.state === "unavailable" || count(snapshot.pending) === null) return {
    state: "degraded", label: "Browser queue unavailable", pending: null,
    detail: "Saved browser uploads could not be checked. Upload completion is not confirmed.",
  };
  const pending = snapshot.pending;
  if (!online) return {
    state: "degraded", label: "Offline", pending,
    detail: `${pending} saved browser upload batch${pending === 1 ? "" : "es"} pending. Cloud upload is unavailable while offline.`,
  };
  if (pending > 0) return {
    state: "degraded", label: "Waiting to upload", pending,
    detail: `${pending} saved browser upload batch${pending === 1 ? " is" : "es are"} waiting to upload.`,
  };
  return {
    state: "ok", label: "Browser queue clear", pending,
    detail: snapshot.state === "uninitialized" ? "No persisted browser upload queue exists on this device."
      : "No pending browser upload batches are stored.",
  };
}
