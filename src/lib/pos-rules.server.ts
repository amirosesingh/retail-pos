/**
 * Server-only helpers behind the POS rules engine.
 *
 * Everything here talks to the POS database directly and never trusts a
 * client payload: manager PINs are verified through the database, and the
 * grant token handed back is signed so a later call can prove an override
 * really happened.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { supabaseConfig } from "./external-supabase-config";
import { DEFAULT_POS_RULES, normalizeRules, type PosRules } from "./pos-rules";

const GRANT_TTL_MS = 5 * 60 * 1000;

function secret(): Buffer {
  const raw = process.env["SETTINGS_ENCRYPTION_KEY"];
  if (!raw) throw new Error("SETTINGS_ENCRYPTION_KEY is not configured");
  return createHash("sha256").update(raw, "utf8").digest();
}

export type OverrideGrant = {
  action: string;
  approvedBy: string;
  role: string;
  storeId: string;
  binding: string;
  requestId?: string;
  approvedAmount?: number | null;
  exp: number;
};

export function signOverrideGrant(grant: Omit<OverrideGrant, "exp">): string {
  const body = Buffer.from(
    JSON.stringify({ ...grant, exp: Date.now() + GRANT_TTL_MS }),
    "utf8",
  ).toString("base64url");
  const sig = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyOverrideGrant(
  token: string | undefined,
  action: string,
  expectedGrant?: { storeId?: string | null; binding?: string | null },
): OverrideGrant | null {
  const [body, sig] = (token || "").split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OverrideGrant;
    if (!parsed.exp || parsed.exp < Date.now()) return null;
    if (parsed.action !== action) return null;
    if (expectedGrant?.storeId != null && parsed.storeId !== expectedGrant.storeId) return null;
    if (expectedGrant?.binding != null && parsed.binding !== expectedGrant.binding) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Execute a sensitive write only after its exact branch/action/payload grant verifies. */
export async function runAuthorizedMutation<T>(
  proof: { token?: string | null; action: string; storeId: string; binding: string },
  mutate: () => Promise<T> | T,
): Promise<T> {
  if (
    !verifyOverrideGrant(proof.token ?? undefined, proof.action, {
      storeId: proof.storeId,
      binding: proof.binding,
    })
  ) {
    throw new Error("A valid authorization grant is required");
  }
  return await mutate();
}

function headers(accessToken?: string): Record<string, string> {
  return {
    apikey: supabaseConfig().key,
    "Content-Type": "application/json",
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
}

/**
 * Call a rules routine on the central database.
 *
 * These routines run with elevated rights, so they are no longer reachable by
 * visitors: the call is made here with the internal service key, which never
 * leaves the server. The publishable key is only used as a last resort when
 * the service key is not configured on this deployment.
 */
export async function rpc<T>(name: string, body: unknown, accessToken?: string): Promise<T> {
  const payload = JSON.stringify(body ?? {});
  let res: Response;
  if (accessToken) {
    res = await fetch(`${supabaseConfig().url}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: headers(accessToken),
      body: payload,
    });
  } else {
    const { serviceRest } = await import("@/core/api/pos-relay.server");
    res = await serviceRest(`rpc/${name}`, { method: "POST", body: payload });
  }
  if (!res.ok) throw new Error((await res.text()) || `${name} failed`);
  return (await res.json()) as T;
}

/** Where an answer came from, so the UI can say when rules are not live. */
export type RulesSource = "database" | "defaults";

/**
 * Why a read failed. Every case keeps the strict fallback; the difference is
 * only what is recorded and shown, so a stale key is never reported as a
 * network outage.
 */
export type RulesFailure =
  "none" | "config" | "network" | "auth" | "permission" | "data" | "unknown";

export type RulesResult = {
  rules: PosRules;
  source: RulesSource;
  error?: string;
  failure: RulesFailure;
  /** Content stamp of the rule set, so a till can tell one version from another. */
  revision: string;
  fetchedAt: number;
  storeId: string;
  rowVersion: number;
  updatedAt: string | null;
  updatedBy: string | null;
};

type RulesSnapshotRow = {
  rules?: unknown;
  store_id?: unknown;
  row_version?: unknown;
  updated_at?: unknown;
  updated_by?: unknown;
};

/** Classify a raw database/transport error without leaking credentials. */
export function classifyRulesFailure(message: string): RulesFailure {
  const m = message.toLowerCase();
  if (m.includes("service key is not configured") || m.includes("not configured")) return "config";
  if (m.includes("invalid api key") || m.includes("jwt") || m.includes("not signed in")) {
    return "auth";
  }
  if (m.includes("permission denied") || m.includes("row-level security") || m.includes("42501")) {
    return "permission";
  }
  if (m.includes("pgrst") || m.includes("schema cache") || m.includes("does not exist")) {
    return "data";
  }
  if (
    m.includes("fetch") ||
    m.includes("network") ||
    m.includes("timeout") ||
    m.includes("econn") ||
    m.includes("getaddrinfo")
  ) {
    return "network";
  }
  return "unknown";
}

/** Stable content stamp for a rule set (order-independent). */
export function rulesRevision(rules: PosRules): string {
  const body = JSON.stringify(
    Object.fromEntries(Object.entries(rules).sort(([a], [b]) => a.localeCompare(b))),
  );
  return createHash("sha256").update(body).digest("hex").slice(0, 16);
}

/**
 * Effective rule set for a branch (store row layered over the global row).
 *
 * A failure still returns the strict built-in defaults so the till keeps
 * working, but it is reported — with its real category — rather than hidden.
 */
export async function loadRulesResult(storeId: string): Promise<RulesResult> {
  try {
    const json = await rpc<RulesSnapshotRow>("pos_rules_snapshot", { _store_id: storeId || "" });
    const rules = normalizeRules(json?.rules);
    return {
      rules,
      source: "database",
      failure: "none",
      revision: rulesRevision(rules),
      fetchedAt: Date.now(),
      storeId: String(json?.store_id ?? storeId ?? ""),
      rowVersion: Math.max(0, Number(json?.row_version) || 0),
      updatedAt: typeof json?.updated_at === "string" ? json.updated_at : null,
      updatedBy: typeof json?.updated_by === "string" ? json.updated_by : null,
    };
  } catch (e) {
    const message = (e as Error).message.slice(0, 300);
    return {
      rules: { ...DEFAULT_POS_RULES },
      source: "defaults",
      error: message,
      failure: classifyRulesFailure(message),
      revision: "",
      fetchedAt: Date.now(),
      storeId: storeId || "",
      rowVersion: 0,
      updatedAt: null,
      updatedBy: null,
    };
  }
}

export async function loadRules(storeId: string): Promise<PosRules> {
  return (await loadRulesResult(storeId)).rules;
}

export async function saveRules(
  storeId: string,
  patch: Partial<PosRules>,
  accessToken: string,
  expectedVersion: number,
): Promise<RulesResult> {
  const body = {
    _store_id: storeId || "",
    _patch: patch,
    _expected_version: expectedVersion,
  };
  const res = await fetch(`${supabaseConfig().url}/rest/v1/rpc/pos_rules_save`, {
    method: "POST",
    headers: headers(accessToken),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.text()).slice(0, 400) || "Could not save rules");
  // The transactional RPC returns the effective rules and their new version.
  // Do not issue a second read: a brief outage after a committed save used to
  // make the editor claim that the saved rules could not be refreshed.
  const json = (await res.json()) as RulesSnapshotRow;
  const rules = normalizeRules(json?.rules);
  return {
    rules,
    source: "database",
    failure: "none",
    revision: rulesRevision(rules),
    fetchedAt: Date.now(),
    storeId: String(json?.store_id ?? storeId ?? ""),
    rowVersion: Math.max(0, Number(json?.row_version) || 0),
    updatedAt: typeof json?.updated_at === "string" ? json.updated_at : null,
    updatedBy: typeof json?.updated_by === "string" ? json.updated_by : null,
  };
}

export async function verifyManagerPinInDb(
  userId: string,
  pin: string,
  audit?: {
    action?: string | null;
    ruleKey?: string | null;
    requestedBy?: string | null;
    storeId?: string | null;
    terminalId?: string | null;
    detail?: string | null;
  },
): Promise<{ userId: string; name: string; role: string } | null> {
  try {
    const rows = await rpc<unknown>("verify_manager_pin", {
      p_user_id: userId,
      p_pin: pin,
      p_action: audit?.action ?? null,
      p_rule_key: audit?.ruleKey ?? null,
      p_requested_by: audit?.requestedBy ?? null,
      p_store_id: audit?.storeId ?? null,
      p_terminal_id: audit?.terminalId ?? null,
      p_detail: audit?.detail ?? null,
    });
    const row = (Array.isArray(rows) ? rows[0] : rows) as
      { user_id?: string; full_name?: string; role?: string } | undefined;
    if (!row?.user_id) return null;
    return { userId: row.user_id, name: row.full_name ?? row.user_id, role: row.role ?? "manager" };
  } catch {
    return null;
  }
}

/**
 * Open held tickets for a branch. A failure is reported, never counted as
 * zero — closing a shift must not slip through because the count was lost.
 */
export async function heldOrderCountResult(
  storeId: string,
): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    const n = await rpc<unknown>("held_orders_open_count", { _store_id: storeId || "" });
    return { ok: true, count: Number(n) || 0 };
  } catch (e) {
    return { ok: false, count: 0, error: (e as Error).message.slice(0, 300) };
  }
}

export async function heldOrderCount(storeId: string): Promise<number> {
  return (await heldOrderCountResult(storeId)).count;
}
