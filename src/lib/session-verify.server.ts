/**
 * Server side of the boot check: is this device still allowed to work?
 *
 * Two things must hold — the credential is live (a signed cashier session, an
 * activation token that has not been revoked, or a staff account the central
 * database still recognises) AND the branch it belongs to still exists.
 */
import { hasServiceKey, serviceRest, verifyRelayCaller } from "@/core/api/pos-relay.server";

export type VerifyInput = {
  sessionToken?: string;
  cashierToken?: string;
  terminalToken?: string;
  deviceBindingProof?: string;
  accessToken?: string;
  storeId?: string;
};

export type VerifyResult = {
  ok: boolean;
  /** why the session is refused: "revoked" | "branch_missing" | "unknown" */
  reason?: "revoked" | "branch_missing" | "unknown" | "unavailable";
  kind?: "cashier" | "terminal" | "staff";
  storeId?: string | null;
};

/** True when the branch exists in the central database. */
async function readBranchExists(storeId: string): Promise<boolean | null> {
  try {
    const res = await serviceRest(`stores?id=eq.${encodeURIComponent(storeId)}&select=id&limit=1`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const rows = await res.json() as unknown;
    return Array.isArray(rows) ? rows.length > 0 : null;
  } catch { return null; }
}

export async function branchExists(storeId: string): Promise<boolean> {
  // Preserve the sync caller's existing deletion contract: a failed read is
  // never evidence that a branch was deleted. Login checks use the tri-state.
  return (await readBranchExists(storeId)) ?? true;
}

type StaffTokenCheck =
  | { state: "verified"; storeId: string | null }
  | { state: "revoked" | "unavailable" };

/** Account status must be checked before a saved person session is restored. */
async function verifyAccountStatus(identity: { authUserId?: string | null; staffUserId?: string | null }): Promise<StaffTokenCheck> {
  const filter = identity.authUserId
    ? `auth_user_id=eq.${encodeURIComponent(identity.authUserId)}`
    : identity.staffUserId ? `user_id=eq.${encodeURIComponent(identity.staffUserId)}` : null;
  if (!filter) return { state: "unavailable" };
  try {
    const response = await serviceRest(`app_users?${filter}&select=is_active,store_id&limit=1`, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return { state: "unavailable" };
    const [profile] = await response.json() as { is_active: boolean; store_id: string | null }[];
    if (!profile) return { state: "unavailable" };
    if (profile.is_active === false) return { state: "revoked" };
    return profile.is_active === true ? { state: "verified", storeId: profile.store_id } : { state: "unavailable" };
  } catch { return { state: "unavailable" }; }
}

/**
 * Validate a browser account on the server so an expected revoked-session
 * answer never appears as a failed `/auth/v1/user` resource in DevTools.
 */
async function verifyStaffAccessToken(accessToken: string): Promise<StaffTokenCheck> {
  const { supabaseConfig } = await import("./external-supabase-config");
  const config = supabaseConfig();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 8_000);
  let authUserId: string;
  try {
    const response = await fetch(`${config.url}/auth/v1/user`, {
      signal: abort.signal,
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!response.ok) {
      return response.status >= 500 || response.status === 429 || response.status === 408
        ? { state: "unavailable" }
        : { state: "revoked" };
    }
    const user = await response.json() as { id?: string } | null;
    if (!user || typeof user.id !== "string" || !user.id) return { state: "unavailable" };
    authUserId = user.id;
  } catch {
    return { state: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
  return verifyAccountStatus({ authUserId });
}

export async function verifySessionServer(input: VerifyInput): Promise<VerifyResult> {
  if (!hasServiceKey()) return { ok: true, reason: "unavailable" };
  if (!input.sessionToken && !input.cashierToken && !input.terminalToken && !input.accessToken)
    return { ok: false, reason: "unknown" };

  // A supplied person-session is authoritative during boot/resume. A valid
  // terminal registration or refreshable Supabase session must not hide that
  // this person's POS idle window expired while the browser was closed.
  if (input.sessionToken) {
    const { touchSession } = await import("./session-guard.server");
    const checked = await touchSession(input.sessionToken);
    if (!checked.ok) {
      if (checked.reason === "unavailable") return { ok: false, reason: "unavailable" };
      return { ok: false, reason: "revoked" };
    }
  }

  // Browser account validation is intentionally proxied through this endpoint:
  // the response remains a normal typed 200 while a revoked GoTrue session is
  // reported as `reason: "revoked"`. This keeps expected logout races out of
  // the browser console without trusting a locally persisted JWT.
  if (
    input.accessToken &&
    !input.sessionToken &&
    !input.cashierToken &&
    !input.terminalToken
  ) {
    const checked = await verifyStaffAccessToken(input.accessToken);
    if (checked.state !== "verified")
      return {
        ok: false,
        reason: checked.state === "unavailable" ? "unavailable" : "revoked",
      };
    const storeId = input.storeId?.trim() || checked.storeId || null;
    if (storeId) {
      const exists = await readBranchExists(storeId);
      if (exists === null) return { ok: false, reason: "unavailable" };
      if (!exists) return { ok: false, reason: "branch_missing", kind: "staff", storeId };
    }
    return { ok: true, kind: "staff", storeId };
  }

  let caller: Awaited<ReturnType<typeof verifyRelayCaller>>;
  try {
    caller = await verifyRelayCaller(input);
  } catch (error) {
    return { ok: false, reason: (error as {status?:number}).status===503 ? "unavailable" : "revoked" };
  }

  if (caller.kind !== "terminal") {
    const account = await verifyAccountStatus(caller);
    if (account.state !== "verified")
      return { ok: false, reason: account.state === "revoked" ? "revoked" : "unavailable" };
  }

  const storeId = input.storeId?.trim() || caller.storeId || null;
  if (storeId) {
    const exists = await readBranchExists(storeId);
    if (exists === null) return { ok: false, reason: "unavailable" };
    if (!exists) return { ok: false, reason: "branch_missing", kind: caller.kind, storeId };
  }

  return { ok: true, kind: caller.kind, storeId };
}
