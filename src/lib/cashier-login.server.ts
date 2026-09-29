/**
 * Server side of the cashier PIN sign-in.
 *
 * The till posts `{ username, pin }`; the PIN is checked against the central
 * database with the internal service key (never present in the browser) and,
 * on success, a device session is opened and its raw token returned once.
 */
import { signCashierSession } from "./pos-session.server";
import { serviceRest } from "@/core/api/pos-relay.server";
import { startSession } from "./session-guard.server";
import { writeSystemAudit } from "./system-audit.server";

export type CashierLoginResult =
  | {
      ok: true;
      cashierToken: string;
      sessionToken: string;
      idleMinutes: number;
      /** One-use Auth proof, minted only after the PIN was verified. */
      authTokenHash: string;
      cashier: {
        id: string;
        username: string;
        full_name: string;
        store_id: string | null;
        /** Authoritative public.app_users role; never infer this from the PIN client. */
        role: "admin" | "manager" | "staff";
        /** Optional custom role label, used for display and policy resolution. */
        role_slug: string | null;
        permissions: Record<string, boolean>;
      };
    }
  | {
      ok: false;
      error: string;
      code?: "invalid_credentials" | "session_prepare_failed" | "identity_mismatch";
    };

export async function cashierLoginServer(input: {
  username: string;
  pin: string;
  platform?: string | null;
  terminalId?: string | null;
  /** Branch this till is set to; used when the account works at all branches. */
  branchId?: string | null;
}): Promise<CashierLoginResult> {
  const username = input.username.trim().toLowerCase();
  if (!username) return { ok: false, error: "Enter your username" };
  // Accounts are provisioned with a 4-32 character credential, so the login
  // must accept the same range — a longer or alphanumeric passcode is valid.
  const secret = input.pin;
  if (secret.length < 4 || secret.length > 32) {
    return { ok: false, error: "Enter your PIN or passcode" };
  }

  const res = await serviceRest("rpc/verify_terminal_pin", {
    method: "POST",
    body: JSON.stringify({ p_user_id: username, p_pin: secret }),
  });
  if (!res.ok) return { ok: false, error: "Could not reach the central database" };

  const rows = (await res.json()) as
    | {
        user_id: string;
        full_name: string;
        store_id: string | null;
      }[]
    | null;
  let row = Array.isArray(rows) ? rows[0] : null;
  // The account list shows the hidden address, so accept it as well as the
  // bare username: resolve it to the username and check the PIN again.
  if (!row && username.includes("@")) {
    const lookup = await serviceRest(
      `app_users?email=eq.${encodeURIComponent(username)}&select=user_id&limit=1`,
    );
    const found = lookup.ok
      ? ((await lookup.json()) as { user_id?: string }[])[0]?.user_id
      : null;
    if (found) {
      const retry = await serviceRest("rpc/verify_terminal_pin", {
        method: "POST",
        body: JSON.stringify({ p_user_id: found, p_pin: secret }),
      });
      if (retry.ok) {
        const again = (await retry.json()) as
          | { user_id: string; full_name: string; store_id: string | null }[]
          | null;
        row = Array.isArray(again) ? (again[0] ?? null) : null;
      }
    }
  }
  if (!row) {
    // A failed sign-in is recorded too — repeated failures are the signal.
    await writeSystemAudit({
      actorId: username,
      actorName: username,
      actorRole: "unknown",
      actionType: "auth.sign_in_failed",
      entityAffected: "app_users",
      entityId: username,
      terminalId: input.terminalId ?? null,
      note: "Invalid username or PIN",
    });
    return { ok: false, code: "invalid_credentials", error: "Invalid username or PIN" };
  }

  const profileResponse = await serviceRest(
    `app_users?user_id=eq.${encodeURIComponent(row.user_id)}&select=id,user_id,full_name,email,store_id,role,role_slug,permissions,is_active,auth_user_id&limit=1`,
  );
  if (!profileResponse.ok) return { ok: false, error: "Could not load this staff account" };
  const profiles = (await profileResponse.json()) as {
    id: string;
    user_id: string;
    full_name: string;
    email: string | null;
    store_id: string | null;
    role: "admin" | "manager" | "staff";
    role_slug: string | null;
    permissions: Record<string, boolean> | null;
    is_active: boolean;
    auth_user_id: string | null;
  }[];
  const profile = profiles[0];
  if (!profile?.is_active) return { ok: false, error: "Account deactivated" };
  const authEmail = profile.email?.trim().toLowerCase() ?? "";
  if (!authEmail || !profile.auth_user_id) {
    return { ok: false, error: "This staff account needs its login identity repaired by an administrator" };
  }
  // A PIN is not necessarily this person's email-account password. Mint a
  // one-use proof instead of changing or guessing that password.
  const { createVerifiedPinSignInToken } = await import("./staff-admin.server");
  let authTokenHash: string;
  try {
    authTokenHash = await createVerifiedPinSignInToken(authEmail, profile.auth_user_id);
  } catch (error) {
    const mismatch = (error as Error).message.includes("does not match");
    return {
      ok: false,
      code: mismatch ? "identity_mismatch" : "session_prepare_failed",
      error: mismatch
        ? "This staff account needs its login identity repaired by an administrator"
        : "The secure database session could not be prepared",
    };
  }

  // An account with no branch of its own works at every branch: the till's
  // own branch decides. It is only trusted once it names a real store.
  const ownBranch = profile.store_id ?? row.store_id ?? null;
  let tillBranch: string | null = null;
  const claimed = (input.branchId ?? "").trim();
  if (!ownBranch && claimed) {
    const storeRes = await serviceRest(
      `stores?id=eq.${encodeURIComponent(claimed)}&select=id&limit=1`,
    );
    if (storeRes.ok) {
      const found = (await storeRes.json()) as { id: string }[];
      tillBranch = found[0]?.id ?? null;
    }
  }

  const cashier = {
    id: profile.id,
    username: profile.user_id,
    full_name: profile.full_name || profile.user_id,
    store_id: ownBranch ?? tillBranch,
    role: profile.role,
    role_slug: profile.role_slug ?? null,
    permissions: profile.permissions ?? {},
  };

  const session = await startSession({
    kind: "cashier",
    label: cashier.full_name,
    staffUserId: cashier.username,
    cashierId: cashier.id,
    branchId: cashier.store_id,
    terminalId: input.terminalId ?? null,
    platform: input.platform ?? null,
  });

  await writeSystemAudit({
    actorId: cashier.username,
    actorName: cashier.full_name,
    actorRole: cashier.role_slug ?? cashier.role,
    actionType: "auth.sign_in",
    entityAffected: "app_users",
    entityId: cashier.username,
    terminalId: input.terminalId ?? null,
    storeId: cashier.store_id,
    note: input.platform ?? null,
  });

  return {
    ok: true,
    cashierToken: signCashierSession({
      id: cashier.id,
      username: cashier.username,
      storeId: cashier.store_id ?? "",
    }),
    sessionToken: session.token,
    idleMinutes: session.idleMinutes,
    authTokenHash,
    cashier,
  };
}
