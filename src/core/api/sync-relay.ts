/**
 * Client side of the server write relay.
 *
 * When a direct write to the central database is refused because the till has
 * no cloud account (cashier PIN sign-in), the same operation is posted to
 * `/api/v1/pos/sync`, which proves the caller and writes only within the
 * branch and permissions that caller actually has.
 */
import { authHeaders, cashierTokenSync, readCredentials } from "@/lib/pos-credentials";
import { serverOrigin, serverUnreachableOnDevice, serverUrl } from "@/lib/server-origin";
import { readTerminalConfig } from "@/core/activation/terminal-tokens";
import type { SyncOp } from "@/lib/sync-outbox";
import { centralAuthAccessToken, hasCentralAuthSession } from "@/lib/session-presence";

const credentials = readCredentials;

/** Answer from the server setup probe: presence only, never key material. */
export type SyncHealth = {
  serviceKey: boolean;
  posUrl: boolean;
  membershipService: boolean;
  host: string;
};

/** Why the setup probe could not be read, in words staff can act on. */
export type SyncHealthResult = { ok: true; health: SyncHealth } | { ok: false; reason: string };

/**
 * Ask the server that is actually answering this device whether it holds the
 * central database key. Used by the connection check so an administrator can
 * tell a server setup problem apart from a till problem — so every failure
 * says which of the two it is instead of one catch-all sentence.
 */
export async function syncHealthResult(): Promise<SyncHealthResult> {
  const origin = serverOrigin();
  if (serverUnreachableOnDevice())
    return {
      ok: false,
      reason:
        "No POS backend address is saved on this device — enter it in Settings → Database & Cloud Connection.",
    };
  const where = origin || (typeof window === "undefined" ? "" : window.location.origin);
  let res: Response;
  try {
    res = await fetch(serverUrl("/api/public/sync-health"), { cache: "no-store" });
  } catch (e) {
    return {
      ok: false,
      reason: `${where} did not answer — check the address, its certificate and this device's connection (${(e as Error).message}).`,
    };
  }
  const text = await res.text().catch(() => "");
  let body: { serviceKey?: boolean; posUrl?: boolean; membershipService?: boolean } | null = null;
  try {
    body = JSON.parse(text) as { serviceKey?: boolean; posUrl?: boolean };
  } catch {
    /* handled below */
  }
  if (!res.ok) return { ok: false, reason: `${where} refused the setup check (${res.status}).` };
  if (!body || typeof body.serviceKey !== "boolean")
    return {
      ok: false,
      reason: `${where} answered with a web page, not the POS backend — check the backend address.`,
    };
  return {
    ok: true,
    health: {
      serviceKey: !!body.serviceKey,
      posUrl: !!body.posUrl,
      membershipService: !!body.membershipService,
      host: origin || (typeof window === "undefined" ? "" : window.location.host),
    },
  };
}

/** Back-compat shape: the health answer, or null when it could not be read. */
export async function syncHealth(): Promise<SyncHealth | null> {
  const res = await syncHealthResult();
  return res.ok ? res.health : null;
}

/** Every relay call carries the bearer token as well as the credential body. */
async function relayHeaders(): Promise<Record<string, string>> {
  return { "Content-Type": "application/json", ...(await authHeaders()) };
}

/**
 * One place that reacts to the relay refusing a caller: a dead token or a
 * deleted branch ends the session, anything else is left to the caller.
 */
async function inspectRelay(res: Response, body: { code?: string } | null): Promise<void> {
  if (res.status !== 401 && res.status !== 403) return;
  const { notifySessionExpired } = await import("@/lib/session-expiry");
  if (body?.code === "SESSION_INVALID" || body?.code === "BRANCH_MISSING" || res.status === 401)
    notifySessionExpired();
}

/** True when a staff account is signed in to the central database in this browser. */
export function hasStaffSession(): boolean {
  if (typeof window === "undefined") return false;
  // A token in localStorage is only a cache. AuthProvider must first prove the
  // server-side session still exists before any protected table is queried.
  if (!hasCentralAuthSession()) return false;
  try {
    const token = centralAuthAccessToken();
    if (!token) return false;
    const encoded = token.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/") ?? "";
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    const payload = JSON.parse(
      atob(padded),
    ) as { exp?: number };
    // Leave a small margin so a token cannot expire between this check and
    // the business-table request it is supposed to authorize.
    return typeof payload.exp === "number" && payload.exp * 1000 > Date.now() + 30_000;
  } catch {
    return false;
  }
}

/**
 * Whether the server write relay may be used. Activated tills qualify, and so
 * does any browser with a signed-in staff account — admins and supervisors work
 * from Chrome, where no till is registered. The endpoint still proves the
 * caller before writing, so this never opens an anonymous path.
 */
export function canRelay(): boolean {
  if (typeof window === "undefined") return false;
  if (cashierTokenSync()) return true;
  return !!readTerminalConfig()?.tokenId || hasStaffSession();
}

/**
 * Where relay calls go.
 *
 * The website talks to itself, so it uses the canonical path. A till or a
 * phone talks to a hosted deployment from another origin, and only the
 * `/api/public/*` prefix is guaranteed to stay reachable there without a site
 * session — so devices use the alias, which runs the identical handler and
 * the identical caller checks.
 */
const syncPath = (): string => (serverOrigin() ? "/api/public/sync" : "/api/v1/pos/sync");

/** Push one operation through the relay. */
export async function relayOp(op: SyncOp): Promise<{ ok: boolean; error?: string; code?: string }> {
  try {
    const res = await fetch(serverUrl(syncPath()), {
      method: "POST",
      headers: await relayHeaders(),
      body: JSON.stringify({ ...(await credentials()), ops: [op] }),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
      code?: string;
      detail?: { table?: string; kind?: string; role?: string | null; branch?: string | null };
      results?: { ok: boolean; error?: string }[];
    } | null;
    await inspectRelay(res, body);
    if (!res.ok) {
      const d = body?.detail;
      const where = d?.table
        ? ` (${d.kind ?? "write"} on ${d.table}` +
          `${d.role ? `, signed in as ${d.role}` : ""}` +
          `${d.branch ? `, branch ${d.branch}` : ""})`
        : "";
      return {
        ok: false,
        error: `${body?.error ?? `Relay refused (${res.status})`}${where}`,
        ...(body?.code ? { code: body.code } : {}),
      };
    }
    const first = body?.results?.[0];
    return first ?? { ok: !!body?.ok };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Quick health probe used by the connection check panel. */
export async function relayActiveShift(
  storeId: string,
): Promise<{ ok: boolean; row?: Record<string, unknown> | null; error?: string }> {
  try {
    const res = await fetch(serverUrl(syncPath()), {
      method: "POST",
      headers: await relayHeaders(),
      body: JSON.stringify({ ...(await credentials()), read: { kind: "activeShift", storeId } }),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      row?: Record<string, unknown> | null;
      error?: string;
      code?: string;
    } | null;
    await inspectRelay(res, body);
    if (!res.ok || !body?.ok)
      return { ok: false, error: body?.error ?? `Relay refused (${res.status})` };
    return { ok: true, row: body.row ?? null };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Protected branch-list read for startup and terminal administration. */
export async function relayStores(): Promise<{
  ok: boolean;
  rows?: Record<string, unknown>[];
  error?: string;
}> {
  try {
    const res = await fetch(serverUrl(syncPath()), {
      method: "POST",
      headers: await relayHeaders(),
      body: JSON.stringify({ ...(await credentials()), read: { kind: "stores" } }),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      rows?: Record<string, unknown>[];
      error?: string;
      code?: string;
    } | null;
    await inspectRelay(res, body);
    if (!res.ok || !body?.ok)
      return { ok: false, error: body?.error ?? `Relay refused (${res.status})` };
    return { ok: true, rows: body.rows ?? [] };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Quick health probe used by the connection check panel. */
export async function probeRelay(): Promise<{ ok: boolean; error?: string; code?: string }> {
  try {
    const res = await fetch(serverUrl(syncPath()), {
      method: "POST",
      headers: await relayHeaders(),
      body: JSON.stringify({
        ...(await credentials()),
        ops: [{ kind: "update", table: "shift_sessions", values: {}, match: { id: "probe" } }],
      }),
    });
    const body = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
    await inspectRelay(res, body);
    if (res.status === 401)
      return {
        ok: false,
        ...(body?.code ? { code: body.code } : {}),
        error: body?.error ?? "This till is not recognised yet",
      };
    if (!res.ok)
      return {
        ok: false,
        ...(body?.code ? { code: body.code } : {}),
        error: body?.error ?? `Relay error ${res.status}`,
      };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
