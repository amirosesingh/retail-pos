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
      code?:
        | "invalid_credentials"
        | "locked"
        | "session_prepare_failed"
        | "activation_denied"
        | "identity_mismatch"
        | "credential_unavailable"
        | "account_inactive"
        | "invalid_input"
        | "central_unavailable";
    };

async function cashierLoginCore(input: {
  username: string;
  pin: string;
  platform?: string | null;
  terminalId?: string | null;
  deviceBindingProof?: string;
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

  const res = await serviceRest("rpc/verify_terminal_pin_result", {
    method: "POST",
    body: JSON.stringify({ p_user_id: username, p_pin: secret }),
  });
  if (!res.ok)
    return {
      ok: false,
      code: "central_unavailable",
      error: "Could not reach the central database",
    };

  const result = await res.json() as { status?: string; account?: { user_id?: string; store_id?: string | null } } | null;
  if (result?.status === "locked")
    return { ok: false, code: "locked", error: "Too many wrong PINs. Please wait before trying again." };
  if (result?.status === "credential_unavailable")
    return { ok: false, code: "credential_unavailable", error: "PIN sign-in is not ready for this account. Ask an administrator to review its sign-in PIN." };
  if (result?.status === "account_inactive")
    return { ok: false, code: "account_inactive", error: "Account deactivated" };
  if (result?.status === "invalid_input")
    return { ok: false, code: "invalid_input", error: "Enter your username and PIN or passcode." };
  if (result?.status !== "invalid" && (result?.status !== "verified" || typeof result.account?.user_id !== "string" || !result.account.user_id))
    return { ok: false, code: "central_unavailable", error: "The central database did not complete the PIN check" };
  if (result.status === "invalid") {
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
  const row = result.account!;

  const profileResponse = await serviceRest(
    `app_users?user_id=eq.${encodeURIComponent(row.user_id!)}&select=id,user_id,full_name,email,store_id,role,role_slug,permissions,is_active,auth_user_id&limit=1`,
  );
  if (!profileResponse.ok)
    return { ok: false, code: "central_unavailable", error: "Could not load this staff account" };
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
  const profile = Array.isArray(profiles) ? profiles[0] : null;
  if (!profile || typeof profile.is_active !== "boolean")
    return { ok: false, code: "central_unavailable", error: "The staff profile could not be loaded completely. Please retry." };
  if (!profile.is_active) return { ok: false, error: "Account deactivated" };
  let terminal:import("./terminal-binding.server").VerifiedTerminalDescriptor|undefined;
  if(input.terminalId){
    try{
      const {readVerifiedTerminal}=await import("./terminal-binding.server");
      terminal=await readVerifiedTerminal(input.terminalId,input.deviceBindingProof,true);
      if(profile.store_id && terminal.branchId && profile.store_id.toLowerCase()!==terminal.branchId.toLowerCase())
        return {ok:false,error:"This account is assigned to a different branch"};
      if(terminal.mode==="management"){
        const {managementDeviceAllowed}=await import("./management-device-access");
        if(!managementDeviceAllowed({role:profile.role,roleSlug:profile.role_slug,permissions:profile.permissions},terminal.platform==="mobile"))
          return {ok:false,error:"This account is not permitted to sign in on this management device"};
      }
    }catch(error){return {ok:false,code:(error as {status?:number}).status===503 ? "central_unavailable" : "activation_denied",error:(error as Error).message};}
  }else if(["electron","android","ios"].includes(input.platform??"")){
    return {ok:false,code:"activation_denied",error:"Complete this device's terminal activation before signing in."};
  }
  const authEmail = profile.email?.trim().toLowerCase() ?? "";
  if (!authEmail || !profile.auth_user_id) {
    return {
      ok: false,
      error: "This staff account needs its login identity repaired by an administrator",
    };
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
  if (!terminal && !ownBranch && claimed) {
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
    store_id: ownBranch ?? terminal?.branchId ?? tillBranch,
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
    terminalId: terminal?.id ?? null,
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
      storeId: cashier.store_id,
      sessionToken: session.token,
    }),
    sessionToken: session.token,
    idleMinutes: session.idleMinutes,
    authTokenHash,
    cashier,
  };
}

/** Share the address throttle with the other public PIN verification paths. */
export async function cashierLoginServer(input: Parameters<typeof cashierLoginCore>[0] & {
  request?: Request;
}): Promise<CashierLoginResult> {
  const { beginPinRequest, finishPinRequest } = await import("./pin-request-throttle.server");
  let attempt: Awaited<ReturnType<typeof beginPinRequest>>;
  try {
    attempt = await beginPinRequest(input.request);
  } catch {
    return { ok: false, code: "central_unavailable", error: "Central PIN protection is unavailable" };
  }
  if (attempt.locked)
    return { ok: false, code: "locked", error: "Too many wrong PINs. Try again later." };
  const result = await cashierLoginCore(input);
  if (result.ok || result.code === "invalid_credentials")
    await finishPinRequest(attempt.key, result.ok);
  return result;
}
