/**
 * Live health of the services the till depends on: the central database, the
 * realtime listener, the public member / redeem subdomains and the outbound
 * sync queue. Everything here is diagnostic — nothing blocks checkout.
 */
import { readBusinessValue, writeBusinessValue } from "./business-storage";
import { supabaseExternal } from "@/integrations/supabase/external-client";
import { retryQuarantined } from "@/lib/sync-outbox";
import { readBrowserOutboxStatus } from "./browser-sync-outbox";
import { browserSyncSummary, isNativeDatabaseSnapshot, nativeSyncSummary, type NativeDatabaseSnapshot, type NativeSyncSnapshot } from "./sync-status-summary";

export type ServiceId = "database" | "realtime" | "sync" | (string & {});
export type ServiceState = "ok" | "degraded" | "down" | "checking";

export type ServiceCheck = {
  id: ServiceId;
  label: string;
  state: ServiceState;
  detail: string;
  /** round trip in ms, when the check measured one */
  latency?: number;
  at: string;
  /** for public domain checks: the URL that was tested */
  url?: string;
};

export type HealthError = {
  id: string;
  at: string;
  service: ServiceId;
  code: string;
  detail: string;
};

const ERR_KEY = "pos.health.errors";
const MAX_ERRORS = 100;

export function listHealthErrors(): HealthError[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(readBusinessValue(ERR_KEY) ?? "[]") as HealthError[];
  } catch {
    return [];
  }
}

export function clearHealthErrors() {
  if (typeof window !== "undefined") writeBusinessValue(ERR_KEY, null);
}

function recordError(service: ServiceId, code: string, detail: string) {
  if (typeof window === "undefined") return;
  const entry: HealthError = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    service,
    code,
    detail,
  };
  try {
    writeBusinessValue(
      ERR_KEY,
      JSON.stringify([entry, ...listHealthErrors()].slice(0, MAX_ERRORS)),
    );
  } catch {
    /* diagnostic only */
  }
}

const now = () => new Date().toISOString();

/** Can we read from the central database with the configured key? */
export async function checkDatabase(): Promise<ServiceCheck> {
  const started = Date.now();
  try {
    const { error } = await supabaseExternal
      .from("public_flags")
      .select("key")
      .limit(1);
    if (error) throw error;
    return {
      id: "database",
      label: "Central POS database",
      state: "ok",
      detail: "Members, bills and catalogue reachable.",
      latency: Date.now() - started,
      at: now(),
    };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    recordError("database", "DB_UNREACHABLE", detail);
    return {
      id: "database",
      label: "Central POS database",
      state: "down",
      detail,
      latency: Date.now() - started,
      at: now(),
    };
  }
}

/** Open a throwaway realtime channel to prove the websocket is alive. */
export function checkRealtime(timeoutMs = 6000): Promise<ServiceCheck> {
  return new Promise((resolve) => {
    const started = Date.now();
    let finished = false;
    const finish = (state: ServiceState, detail: string) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      try {
        void supabaseExternal.removeChannel(channel).catch(() => undefined);
      } catch {
        /* already gone */
      }
      if (state !== "ok") recordError("realtime", "WS_NOT_CONNECTED", detail);
      resolve({
        id: "realtime",
        label: "Realtime listener",
        state,
        detail,
        latency: Date.now() - started,
        at: now(),
      });
    };
    const channel = supabaseExternal.channel(`health-${crypto.randomUUID()}`);
    const timer = window.setTimeout(
      () => finish("degraded", "Websocket did not connect in time — updates may lag."),
      timeoutMs,
    );
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") finish("ok", "Instant voucher and stock updates live.");
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
        finish("down", `Websocket status ${status}.`);
    });
  });
}

/** Accept "member.example.com" as well as a full URL. */
export function normaliseDomain(input: string): { url: string; host: string } | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return { url: url.origin, host: url.hostname };
  } catch {
    return null;
  }
}

/** Is one public domain serving? One check per domain so the UI can name it. */
export async function checkDomain(input: string, label: string): Promise<ServiceCheck> {
  const started = Date.now();
  const parsed = normaliseDomain(input);
  const base = { id: `domain:${parsed?.host ?? label}`, label, at: now() };

  if (!parsed) {
    return {
      ...base,
      state: "down",
      detail: `"${input}" is not a valid address — fix it in Subdomains & API configuration.`,
    };
  }
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return {
      ...base,
      url: parsed.url,
      state: "degraded",
      detail: `Unknown — this terminal is offline, so ${parsed.host} could not be tested.`,
    };
  }
  try {
    await fetch(parsed.url, { mode: "no-cors", cache: "no-store" });
    return {
      ...base,
      url: parsed.url,
      state: "ok",
      detail: `${parsed.host} is responding.`,
      latency: Date.now() - started,
    };
  } catch {
    const detail = `${parsed.host} did not respond — check the domain is connected and its DNS records are live.`;
    recordError(base.id, "DOMAIN_UNREACHABLE", detail);
    return {
      ...base,
      url: parsed.url,
      state: "down",
      detail,
      latency: Date.now() - started,
    };
  }
}

async function readNativeStatus<T>(read: () => Promise<T> | undefined): Promise<T | undefined> {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(read),
      new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error("Native status did not answer.")), 5_000); }),
    ]);
  } finally { clearTimeout(deadline); }
}

/** Read existing transport status once during the existing diagnostic run.
 * Neither a journal count nor a renderer compatibility stub proves all records
 * uploaded. Online fallback can have both native and browser work to report. */
export async function checkSync(): Promise<ServiceCheck> {
  const online = typeof navigator === "undefined" ? true : navigator.onLine;
  const bridge = typeof window === "undefined" ? undefined : (window as unknown as {
    pos?: { database?: { getState?(): Promise<NativeDatabaseSnapshot> };
      sync?: { getStatus?(): Promise<NativeSyncSnapshot> } };
  }).pos;
  const native = typeof bridge?.database?.getState === "function" || typeof bridge?.sync?.getStatus === "function";
  const [browserResult, databaseResult, syncResult] = await Promise.allSettled([
    readBrowserOutboxStatus(),
    native ? readNativeStatus(() => bridge?.database?.getState?.()) : Promise.resolve(undefined),
    native ? readNativeStatus(() => bridge?.sync?.getStatus?.()) : Promise.resolve(undefined),
  ]);
  const browser = browserSyncSummary(browserResult.status === "fulfilled" ? browserResult.value
    : { state: "unavailable", pending: null }, online);
  const database = databaseResult.status === "fulfilled" && isNativeDatabaseSnapshot(databaseResult.value)
    ? databaseResult.value : null;
  const snapshot = syncResult.status === "fulfilled" && syncResult.value && typeof syncResult.value === "object"
    ? syncResult.value : null;
  const local = native ? nativeSyncSummary(snapshot, database ?? {},
    !database || syncResult.status === "rejected" || !snapshot) : null;
  const summaries = local ? [local, browser] : [browser];
  return {
    id: "sync",
    label: "POS sync queue",
    state: summaries.some(summary => summary.state === "degraded") ? "degraded"
      : summaries.some(summary => summary.state === "checking") ? "checking" : "ok",
    detail: local ? `Local SQL: ${local.detail} Browser: ${browser.detail}` : browser.detail,
    at: now(),
  };
}

/** Worst state across every service, used for the top-bar pill. */
export { retryQuarantined };

export function overallState(checks: ServiceCheck[]): ServiceState {
  if (!checks.length) return "checking";
  if (checks.some((c) => c.state === "down")) return "down";
  if (checks.some((c) => c.state === "degraded" || c.state === "checking")) return "degraded";
  return "ok";
}

export const STATE_LABEL: Record<ServiceState, string> = {
  ok: "Connected",
  degraded: "Degraded / offline mode",
  down: "Disconnected",
  checking: "Checking…",
};

export async function runDiagnostics(
  domains: Array<string | { url: string; label: string }>,
): Promise<ServiceCheck[]> {
  const entries = domains.map((d) =>
    typeof d === "string" ? { url: d, label: normaliseDomain(d)?.host ?? d } : d,
  );
  const [database, realtime, sync, ...domainChecks] = await Promise.all([
    checkDatabase(),
    checkRealtime(),
    checkSync(),
    ...entries.map((e) => checkDomain(e.url, e.label)),
  ]);
  return [database, realtime, ...domainChecks, sync];
}
