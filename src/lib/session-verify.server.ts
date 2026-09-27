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
export async function branchExists(storeId: string): Promise<boolean> {
  const res = await serviceRest(`stores?id=eq.${encodeURIComponent(storeId)}&select=id&limit=1`);
  if (!res.ok) return true; // a read failure is a connectivity problem, not a deletion
  const rows = (await res.json()) as unknown[];
  return rows.length > 0;
}

type StaffTokenCheck =
  | { state: "verified"; storeId: string | null }
  | { state: "revoked" | "unavailable" };

/**
 * Validate a browser account on the server so an expected revoked-session
 * answer never appears as a failed `/auth/v1/user` resource in DevTools.
 */
async function verifyStaffAccessToken(accessToken: string): Promise<StaffTokenCheck> {
  const { supabaseConfig } = await import("./external-supabase-config");
  const config = supabaseConfig();
  let response: Response;
  try {
    response = await fetch(`${config.url}/auth/v1/user`, {
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch {
    return { state: "unavailable" };
  }
  if (!response.ok) {
    return response.status >= 500 || response.status === 429
      ? { state: "unavailable" }
      : { state: "revoked" };
  }
  return { state: "verified", storeId: null };
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
    if (storeId && !(await branchExists(storeId)))
      return { ok: false, reason: "branch_missing", kind: "staff", storeId };
    return { ok: true, kind: "staff", storeId };
  }

  let caller: Awaited<ReturnType<typeof verifyRelayCaller>>;
  try {
    caller = await verifyRelayCaller(input);
  } catch {
    return { ok: false, reason: "revoked" };
  }

  const storeId = input.storeId?.trim() || caller.storeId || null;
  if (storeId && !(await branchExists(storeId)))
    return { ok: false, reason: "branch_missing", kind: caller.kind, storeId };

  return { ok: true, kind: caller.kind, storeId };
}
