/**
 * One shared answer to "can we reach a database right now?".
 *
 * The central database and the local SQL Server on this machine are checked
 * in parallel, each with its own short timeout, and the answer is cached for
 * two seconds so a burst of till actions never becomes a burst of probes.
 *
 * The local engine lives in the Windows desktop shell (native SQL Server
 * driver in the Electron main process); this module only asks the bridge.
 */
import { supabaseExternal } from "@/integrations/supabase/external-client";
import { localDb } from "@/core/local-db/local-db";
import { hydrateTerminalConfig } from "@/core/activation/terminal-tokens";
import { hasSupabaseConfig } from "@/lib/external-supabase-config";
import { awaitProfileHydrated } from "@/lib/connection-profile";
import { clearConnectivityIssue } from "@/lib/session-expiry";
import { isMobileShell } from "@/platform-config/features";

/**
 * Why the central database is or is not usable right now.
 *
 * `verified` is the only value that proves the saved URL *and* key answer:
 * a device that is merely "online" can still be pointing at nothing.
 */
export type CloudVerdict = "verified" | "unreachable" | "rejected" | "unconfigured";
export type CloudIssue =
  | "none"
  | "device-offline"
  | "timeout"
  | "service-error"
  | "rate-limited"
  | "authentication"
  | "permission"
  | "transport"
  | "configuration";

export type CloudDiagnosis = {
  issue: CloudIssue;
  /** Safe HTTP status only; response bodies and credentials are never exposed. */
  status?: number;
};

export type HealthReport = {
  /** Central database answered in time. */
  cloud: boolean;
  /** Local SQL Server answered in time. */
  local: boolean;
  /** At least one place can take a read or a write. */
  anyOnline: boolean;
  /** When the probe ran (epoch ms). */
  at: number;
};

// A phone on mobile data regularly needs more than a second for the first
// call of a session (DNS + TLS on a cold connection). Calling that "offline"
// is what sent a correctly configured terminal back to the setup screen, so
// the first probe of a launch is given a realistic budget and later probes,
// which reuse a warm connection, stay quick.
const CLOUD_TIMEOUT_FIRST = 15_000;
const CLOUD_TIMEOUT_DESKTOP = 5_000;
const CLOUD_TIMEOUT_MOBILE = 8_000;
const LOCAL_TIMEOUT = 800;
const CACHE_MS = 2000;

/** False until the first probe of this launch has settled. */
let probedOnce = false;

/** True once the launch's first connection check has produced a verdict. */
export const hasProbedCloud = (): boolean => probedOnce;

const OFFLINE: HealthReport = { cloud: false, local: false, anyOnline: false, at: 0 };

let cached: HealthReport | null = null;
let inflight: Promise<HealthReport> | null = null;

type Listener = (report: HealthReport) => void;
const listeners = new Set<Listener>();

/** Resolve to `false` rather than hang when a target is slow to answer. */
function withTimeout(work: Promise<boolean>, ms: number, onTimeout?: () => void): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      resolve(false);
    }, ms);
    work
      .then((ok) => {
        clearTimeout(timer);
        resolve(ok);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(false);
      });
  });
}

let verdict: CloudVerdict = "unreachable";
let diagnosis: CloudDiagnosis = { issue: "transport" };

/** The last verdict on the central database, without running a new probe. */
export const cloudVerdict = (): CloudVerdict => verdict;
export const cloudDiagnosis = (): CloudDiagnosis => diagnosis;

const cloudTimeout = () => (isMobileShell() ? CLOUD_TIMEOUT_MOBILE : CLOUD_TIMEOUT_DESKTOP);

async function probeCloudVerdict(signal?: AbortSignal): Promise<CloudVerdict> {
  await hydrateTerminalConfig();
  if (signal?.aborted) return "unreachable";
  // The device's own saved connection is the authority and is restored
  // asynchronously. Probing before it lands tests either nothing at all or the
  // pair carried by an older activation record — both of which come back as
  // "not configured" or "refused" on a perfectly good terminal.
  try {
    await awaitProfileHydrated();
  } catch {
    /* the restore is best-effort; the checks below still hold */
  }
  if (signal?.aborted) return "unreachable";
  if (!hasSupabaseConfig()) {
    if (signal?.aborted) return "unreachable";
    diagnosis = { issue: "configuration" };
    return "unconfigured";
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    if (signal?.aborted) return "unreachable";
    diagnosis = { issue: "device-offline" };
    return "unreachable";
  }
  try {
    const limited = supabaseExternal.from("public_flags").select("key").limit(1);
    const request =
      signal && typeof limited.abortSignal === "function" ? limited.abortSignal(signal) : limited;
    const { error } = await request;
    // Some query-builder versions cannot cancel the underlying fetch. In that
    // case the promise may settle after our timeout; never let that expired
    // result overwrite the newer timeout/recovery verdict.
    if (signal?.aborted) return "unreachable";
    if (!error) {
      diagnosis = { issue: "none" };
      return "verified";
    }
    const msg = error.message ?? "";
    const status = Number((error as { status?: unknown }).status) || undefined;
    const code = String((error as { code?: unknown }).code ?? "");
    // A rejected key is a configuration fault, not a network fault: saying
    // "offline" here is what let a wrong key look like a working connection.
    if (/invalid api ?key/i.test(msg)) {
      diagnosis = { issue: "configuration", status };
      return "rejected";
    }
    if (status === 401 || /jwt|unauthorized|401/i.test(msg)) {
      diagnosis = { issue: "authentication", status };
      return "rejected";
    }
    // PostgREST only reaches table/RLS permission evaluation after accepting
    // the project address and publishable key. A 42501/permission response is
    // therefore a healthy connection with restricted anonymous data access,
    // not a bad key. Treating it as rejected traps an already-configured till
    // on the first-run connection screen before anybody can sign in.
    if (
      code === "42501" ||
      /permission denied for/i.test(msg) ||
      /new row violates row-level security policy/i.test(msg)
    ) {
      diagnosis = { issue: "none", status };
      return "verified";
    }
    if (status === 403 || /not authorized|403/i.test(msg)) {
      diagnosis = { issue: "permission", status };
      return "rejected";
    }
    // Key accepted, schema not deployed yet — the connection itself is good.
    if (/does not exist|relation/i.test(msg)) {
      diagnosis = { issue: "none", status };
      return "verified";
    }
    if (status === 429) diagnosis = { issue: "rate-limited", status };
    else if (status && status >= 500) diagnosis = { issue: "service-error", status };
    else diagnosis = { issue: "transport", status };
    return "unreachable";
  } catch {
    if (signal?.aborted) return "unreachable";
    diagnosis = { issue: "transport" };
    return "unreachable";
  }
}

async function probeCloud(signal?: AbortSignal): Promise<boolean> {
  const next = await probeCloudVerdict(signal);
  if (signal?.aborted) return false;
  verdict = next;
  return next === "verified";
}

/** Abort the underlying request as well as releasing the caller on timeout. */
function probeCloudWithin(ms: number): Promise<boolean> {
  const controller = new AbortController();
  return withTimeout(probeCloud(controller.signal), ms, () => {
    diagnosis = { issue: "timeout" };
    verdict = "unreachable";
    controller.abort();
  });
}

/** A probe that timed out never leaves a stale "verified" behind. */
function settleVerdict(cloud: boolean) {
  if (!cloud && verdict === "verified") {
    verdict = "unreachable";
    diagnosis = { issue: "timeout" };
  }
}

async function probeLocal(): Promise<boolean> {
  const bridge = localDb();
  if (!bridge) return false;
  // Current Electron builds expose the startup-restored SQL Server state on
  // `database.getState`. Keep the old `status` fallback for installed shells
  // that have not updated yet; calling only the legacy API made the loader say
  // "Terminal database unavailable" while the main process was connected.
  const status = bridge.database?.getState
    ? await bridge.database.getState()
    : await bridge.status();
  return !!status?.connected;
}

/** The last probe result without running a new one. */
export const lastHealth = (): HealthReport | null => cached;

/** True when the cached answer is still fresh enough to reuse. */
const fresh = (report: HealthReport | null): report is HealthReport =>
  !!report && Date.now() - report.at < CACHE_MS;

/**
 * Check both databases. Repeated calls inside the cache window share one
 * result, and simultaneous callers share one in-flight probe.
 */
export function checkHealth(force = false): Promise<HealthReport> {
  if (!force && fresh(cached)) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = (async () => {
    const budget = probedOnce ? cloudTimeout() : CLOUD_TIMEOUT_FIRST;
    const [firstCloud, local] = await Promise.all([
      probeCloudWithin(budget),
      withTimeout(probeLocal(), LOCAL_TIMEOUT),
    ]);
    // A single slow answer must not be recorded as "cannot be reached": that
    // verdict sends a configured terminal back to the connection screen.
    let cloud = firstCloud;
    if (!cloud && verdict === "unreachable")
      cloud = await probeCloudWithin(budget);
    probedOnce = true;
    settleVerdict(cloud);
    const report: HealthReport = { cloud, local, anyOnline: cloud || local, at: Date.now() };
    cached = report;
    inflight = null;
    for (const l of listeners) l(report);
    return report;
  })();
  return inflight;
}

/** Is anything reachable? Uses the cached answer when it is still fresh. */
export async function anyDatabaseReachable(): Promise<boolean> {
  return (await checkHealth()).anyOnline;
}

/** Watch health changes (status pills, banners). */
export function subscribeHealth(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Forget the cached answer — used by tests and after a manual reconnect. */
export function resetHealthCache() {
  cached = null;
  inflight = null;
  verdict = "unreachable";
  diagnosis = { issue: "transport" };
}

/* ------------------------------------------------------------------ */
/* Connectivity: the single source of truth for "are we online?"       */
/* ------------------------------------------------------------------ */

/**
 * `connecting` is the honest answer before the first heartbeat has come
 * back. The app shows a pulsing cloud during that window and never claims to
 * be offline on a guess — `navigator.onLine` is only ever used as a hint that
 * it is worth running a probe right now.
 */
export type Connectivity = "connecting" | "online" | "offline";

/** Shortest time the "connecting" cloud stays on screen, so the eye sees it. */
export const MIN_CONNECTING_MS = 1500;

type ConnListener = (state: Connectivity) => void;
const connListeners = new Set<ConnListener>();

let connectivityState: Connectivity = "connecting";
let resolvedOnce = false;
let minElapsed = false;
let pendingResolved: Exclude<Connectivity, "connecting"> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
let minTimer: ReturnType<typeof setTimeout> | undefined;
let heartbeatInflight: Promise<Connectivity> | null = null;
let consecutiveCloudFailures = 0;

/** Shared lifecycle events consumed by auth, queries and non-query stores. */
export const APP_RESUME_EVENT = "pos:app-resume";
export const CONNECTIVITY_RESTORED_EVENT = "pos:connectivity-restored";

/** Connectivity as it stands right now. */
export const connectivity = (): Connectivity => connectivityState;

export function subscribeConnectivity(listener: ConnListener) {
  connListeners.add(listener);
  return () => {
    connListeners.delete(listener);
  };
}

function publish(next: Connectivity) {
  if (next === connectivityState) {
    // The connection category may have changed while still offline (for
    // example timeout -> authentication). Refresh status screens anyway.
    for (const l of connListeners) l(next);
    return;
  }
  const previous = connectivityState;
  connectivityState = next;
  for (const l of connListeners) l(next);
  if (next === "online") {
    clearConnectivityIssue();
    if (typeof window !== "undefined" && previous !== "online") {
      window.dispatchEvent(new CustomEvent(CONNECTIVITY_RESTORED_EVENT));
    }
  }
}

/**
 * A definitive answer is only shown once the minimum display time has also
 * elapsed; until then it waits. There is no upper cap — a slow network keeps
 * the connecting cloud on screen for as long as the probe really takes.
 */
function settle(next: Exclude<Connectivity, "connecting">) {
  resolvedOnce = true;
  pendingResolved = next;
  if (minElapsed) publish(next);
}

function startMinTimer() {
  if (minTimer || minElapsed) return;
  minTimer = setTimeout(() => {
    minTimer = undefined;
    minElapsed = true;
    if (pendingResolved) publish(pendingResolved);
  }, MIN_CONNECTING_MS);
}

/**
 * The first probe never races a stopwatch: it waits for the request to give a
 * real answer within the cold-connection budget instead of assuming offline
 * after a second.
 */
async function probeDefinitive(): Promise<boolean> {
  try {
    return await probeCloudWithin(CLOUD_TIMEOUT_FIRST);
  } catch {
    return false;
  }
}

/** Run one heartbeat now and publish the result. */
export async function heartbeat(): Promise<Connectivity> {
  if (heartbeatInflight) return heartbeatInflight;
  heartbeatInflight = (async () => {
    const cloud = resolvedOnce
      ? await probeCloudWithin(cloudTimeout())
      : await probeDefinitive();
    settleVerdict(cloud);
    consecutiveCloudFailures = cloud ? 0 : consecutiveCloudFailures + 1;
    const local = await withTimeout(probeLocal(), LOCAL_TIMEOUT);
    cached = { cloud, local, anyOnline: cloud || local, at: Date.now() };
    for (const l of listeners) l(cached);
    if (cloud) clearConnectivityIssue();
    // A single slow mobile request must not cover the app with an offline
    // gate. Keep the last proven-online state while the next heartbeat checks
    // again; two consecutive failures still fail closed.
    const definitiveConfigurationFailure = verdict === "rejected" || verdict === "unconfigured";
    const next =
      cloud ||
      (!definitiveConfigurationFailure &&
        connectivityState === "online" &&
        consecutiveCloudFailures < 2)
        ? "online"
        : "offline";
    settle(next);
    return connectivityState;
  })().finally(() => {
    heartbeatInflight = null;
    if (monitoring && connectivityState === "offline" && !recoveryTimer) {
      recoveryTimer = setTimeout(() => {
        recoveryTimer = undefined;
        void heartbeat();
      }, 5_000);
    }
  });
  return heartbeatInflight;
}

let monitoring = false;

/**
 * Start the one heartbeat loop for the whole app. Browser online/offline
 * events only nudge it to probe sooner; the probe result decides the state.
 */
export function startConnectivityMonitor(intervalMs = 20_000): () => void {
  if (typeof window === "undefined" || monitoring) return () => {};
  monitoring = true;
  let active = true;
  startMinTimer();
  void heartbeat();
  heartbeatTimer = setInterval(() => void heartbeat(), intervalMs);
  const nudge = () => void heartbeat();
  const resume = () => {
    if (document.visibilityState === "hidden") return;
    window.dispatchEvent(new CustomEvent(APP_RESUME_EVENT));
    void heartbeat();
  };
  window.addEventListener("online", nudge);
  window.addEventListener("offline", nudge);
  window.addEventListener("focus", resume);
  window.addEventListener("pageshow", resume);
  document.addEventListener("visibilitychange", resume);
  let removeNative: (() => Promise<void>) | undefined;
  void import("@capacitor/app")
    .then(({ App }) =>
      App.addListener("appStateChange", ({ isActive }) => {
        if (isActive) resume();
      }),
    )
    .then((handle) => {
      if (!active) void handle.remove();
      else removeNative = () => handle.remove();
    })
    .catch(() => {
      /* Browser visibility/focus remains the lifecycle fallback. */
    });
  return () => {
    active = false;
    monitoring = false;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
    if (recoveryTimer) clearTimeout(recoveryTimer);
    recoveryTimer = undefined;
    window.removeEventListener("online", nudge);
    window.removeEventListener("offline", nudge);
    window.removeEventListener("focus", resume);
    window.removeEventListener("pageshow", resume);
    document.removeEventListener("visibilitychange", resume);
    if (removeNative) void removeNative();
  };
}

/** Test seam: back to the pre-startup "connecting" state. */
export function resetConnectivity() {
  connectivityState = "connecting";
  resolvedOnce = false;
  minElapsed = false;
  pendingResolved = null;
  heartbeatInflight = null;
  consecutiveCloudFailures = 0;
  monitoring = false;
  if (minTimer) clearTimeout(minTimer);
  minTimer = undefined;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = undefined;
  if (recoveryTimer) clearTimeout(recoveryTimer);
  recoveryTimer = undefined;
}

export { OFFLINE as offlineHealth };
