/**
 * Staff provisioning with the server's own key.
 *
 * Every operator — admin, supervisor, warehouse, cashier or any custom role —
 * gets one real account. Cashiers never see an email address: their username
 * is turned into a hidden internal address and their PIN is the password, so
 * the till holds a normal verified session instead of a home-made token.
 */
import { supabaseConfig } from "./external-supabase-config";
import { serviceRest, serviceKey } from "@/core/api/pos-relay.server";
import {
  verifiedPinLinkProof,
  type GenerateLinkPayload,
} from "./verified-pin-proof";

export const INTERNAL_EMAIL_DOMAIN = "pos-internal.local";

export const internalEmail = (username: string) =>
  `${username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "")}@${INTERNAL_EMAIL_DOMAIN}`;

async function adminFetch(path: string, init: RequestInit = {}) {
  const key = serviceKey();
  const headers: Record<string, string> = {
    apikey: key,
    "Content-Type": "application/json",
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (!key.startsWith("sb_")) headers["Authorization"] = `Bearer ${key}`;
  return fetch(`${supabaseConfig().url}/auth/v1/${path}`, { ...init, headers });
}

/**
 * Create a one-use Auth proof after another server-side credential has already
 * been verified. This never sends email and, unlike changing the Auth
 * password to a till PIN, leaves the operator's normal password untouched.
 */
export async function createVerifiedPinSignInToken(
  email: string,
  expectedAuthUserId: string,
): Promise<string> {
  const response = await adminFetch("admin/generate_link", {
    method: "POST",
    body: JSON.stringify({ type: "magiclink", email: email.trim().toLowerCase() }),
  });
  if (!response.ok) {
    throw new Error("The secure database session could not be prepared");
  }
  const body = (await response.json()) as GenerateLinkPayload;
  // The profile carries both identifiers. Refuse a stale/corrupt email mapping
  // rather than minting a session for a different Auth user with that address.
  return verifiedPinLinkProof(body, expectedAuthUserId);
}

/** Call a database routine with the service key. */
export async function serviceRpc(name: string, body: Record<string, unknown>) {
  const res = await serviceRest(`rpc/${name}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.text()).slice(0, 300) || "The database refused this");
  const text = await res.text();
  return text ? (JSON.parse(text) as unknown) : null;
}

/** The caller must be a supervisor or admin — checked against their own session. */
export async function requireSupervisor(accessToken: string): Promise<void> {
  if (!accessToken) throw new Error("Please sign in again");
  const { url, key } = supabaseConfig();
  const res = await fetch(`${url}/rest/v1/rpc/is_app_supervisor`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (!res.ok) throw new Error("Please sign in again");
  if ((await res.json()) !== true) {
    throw new Error("Only supervisors and admins can manage staff");
  }
}

/** Find an existing auth account for this address. */
async function findUserId(email: string): Promise<string | null> {
  const res = await adminFetch(
    `admin/users?page=1&per_page=1&email=${encodeURIComponent(email)}`,
  );
  if (!res.ok) return null;
  const body = (await res.json()) as { users?: { id: string; email?: string }[] };
  return body.users?.find((u) => u.email?.toLowerCase() === email)?.id ?? null;
}

export type StaffPayload = {
  displayName: string;
  /** what the admin typed: a plain username, or a real email address */
  username: string;
  /** 4-6 digits — required for username (terminal) accounts */
  pin?: string;
  /** password — required for real-email accounts */
  password?: string;
  authorizationPin: string;
  branchId?: string | null;
  roleSlug: string;
  baseRole: "admin" | "manager" | "staff";
  active: boolean;
};

/** A real address is anything with an "@" that is not our own hidden domain. */
export const isRealEmail = (input: string) => {
  const v = input.trim().toLowerCase();
  return v.includes("@") && !v.endsWith(`@${INTERNAL_EMAIL_DOMAIN}`);
};

/**
 * Create (or repair) the account behind a staff member and mirror the profile
 * into public.app_users.
 *
 * A plain username becomes a hidden internal address, is confirmed on the spot
 * and uses the PIN as its password, so the till can sign in immediately.
 * A real email address is kept as typed, uses its own password, and is left
 * unconfirmed so the person receives the usual verification email.
 */
export async function provisionStaffAccount(payload: StaffPayload): Promise<{ userId: string }> {
  const typed = payload.username.trim().toLowerCase();
  if (!typed) throw new Error("Enter a username or an email address");
  if (!payload.roleSlug?.trim()) throw new Error("Choose a role for this person");
  const emailMode = isRealEmail(typed);
  const pin = (payload.pin ?? "").trim();
  const password = payload.password ?? "";
  const authorizationPin = payload.authorizationPin.trim();
  if (!/^\d{4,6}$/.test(authorizationPin)) {
    throw new Error("Set a 4 to 6 digit authorisation PIN");
  }

  let username: string;
  let email: string;
  let secret: string;
  if (emailMode) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(typed)) throw new Error("That email address is not valid");
    if (password.length < 8) throw new Error("A password must be at least 8 characters");
    email = typed;
    secret = password;
    username = (typed.split("@")[0] ?? "").replace(/[^a-z0-9._-]/g, "").slice(0, 40) || "user";
  } else {
    username = typed;
    if (!/^[a-z0-9._-]{2,40}$/.test(username)) {
      throw new Error("A username may only use letters, numbers, dot, dash or underscore");
    }
    if (pin.length < 4 || pin.length > 32) {
      throw new Error("A till PIN or passcode must be 4 to 32 characters");
    }
    email = internalEmail(username);
    secret = pin;
  }

  const metadata = {
    username,
    full_name: payload.displayName.trim() || username,
    role: payload.baseRole === "admin" ? "admin" : payload.baseRole === "manager" ? "supervisor" : "cashier",
    role_slug: payload.roleSlug,
    store_id: payload.branchId ?? null,
    active: payload.active,
  };

  const created = await adminFetch("admin/users", {
    method: "POST",
    body: JSON.stringify({
      email,
      password: secret,
      email_confirm: !emailMode,
      user_metadata: metadata,
    }),
  });

  const userId: string | null = created.ok
    ? ((await created.json()) as { id?: string }).id ?? null
    : await findUserId(email);
  if (!created.ok) {
    if (!userId) {
      throw new Error((await created.text()).slice(0, 200) || "Could not create this account");
    }
    await adminFetch(`admin/users/${userId}`, {
      method: "PUT",
      body: JSON.stringify({
        password: secret,
        ...(emailMode ? {} : { email_confirm: true }),
        user_metadata: metadata,
      }),
    });
  }

  if (!userId) throw new Error("The authentication account was not created");

  await serviceRpc("staff_account_upsert", {
    p_user_id: username,
    p_full_name: payload.displayName.trim() || username,
    p_email: email,
    p_role: payload.baseRole,
    p_role_slug: payload.roleSlug,
    p_store_id: payload.branchId ?? null,
    p_is_active: payload.active,
    p_pin: authorizationPin,
    p_pin_length: authorizationPin.length,
    p_auth_user_id: userId,
    p_permissions: null,
  });
  if (!emailMode) {
    await serviceRpc("staff_account_set_terminal_pin", {
      p_user_id: username,
      p_pin: pin,
    });
  }

  await serviceRest("user_roles?on_conflict=user_id,role", {
    method: "POST",
    prefer: "return=minimal,resolution=merge-duplicates",
    body: JSON.stringify([{ user_id: userId, role: payload.baseRole }]),
  });

  return { userId };
}

/** Turn an account on or off everywhere at once. */
/** Snapshot of an account, kept so the edit history can show before/after. */
export async function readStaffSnapshot(
  username: string,
): Promise<Record<string, unknown> | null> {
  const res = await serviceRest(
    `app_users?user_id=eq.${encodeURIComponent(username.toLowerCase())}&select=user_id,full_name,email,role,role_slug,store_id,is_active&limit=1`,
  );
  if (!res.ok) return null;
  const rows = (await res.json()) as Record<string, unknown>[];
  return rows[0] ?? null;
}

export async function setStaffActive(username: string, active: boolean): Promise<void> {
  const profile = await staffProfile(username);
  const userId = profile?.auth_user_id ?? null;
  if (userId) {
    await adminFetch(`admin/users/${userId}`, {
      method: "PUT",
      body: JSON.stringify({ user_metadata: { active } }),
    });
  }
  await serviceRpc("staff_account_set_active", {
    p_user_id: username.trim().toLowerCase(),
    p_active: active,
  });
}

type StaffProfileRow = {
  user_id: string;
  full_name: string;
  email: string;
  role: "admin" | "manager" | "staff";
  role_slug: string | null;
  store_id: string | null;
  is_active: boolean;
  auth_user_id: string | null;
  permissions: Record<string, boolean>;
  pin_length: number;
};

async function staffProfile(username: string): Promise<StaffProfileRow | null> {
  const query = `app_users?user_id=eq.${encodeURIComponent(username.trim().toLowerCase())}&select=user_id,full_name,email,role,role_slug,store_id,is_active,auth_user_id,permissions,pin_length&limit=1`;
  const res = await serviceRest(query);
  if (!res.ok) throw new Error("The staff profile could not be loaded");
  const rows = (await res.json()) as StaffProfileRow[];
  return rows[0] ?? null;
}

export async function updateStaffProfile(input: {
  username: string;
  displayName: string;
  branchId: string | null;
  roleSlug: string;
  baseRole: "admin" | "manager" | "staff";
  active: boolean;
  credential?: string;
}): Promise<void> {
  const profile = await staffProfile(input.username);
  if (!profile?.auth_user_id) throw new Error("This staff account has no authentication identity");
  const terminalAccount = profile.email.endsWith(`@${INTERNAL_EMAIL_DOMAIN}`);
  const credential = input.credential ?? "";
  if (credential) {
    if (terminalAccount && (credential.length < 4 || credential.length > 32))
      throw new Error("A till PIN or passcode must be 4 to 32 characters");
    if (!terminalAccount && credential.length < 8) throw new Error("A password must be at least 8 characters");
  }

  const authUpdate = await adminFetch(`admin/users/${profile.auth_user_id}`, {
    method: "PUT",
    body: JSON.stringify({
      ...(credential ? { password: credential } : {}),
      user_metadata: {
        username: profile.user_id,
        full_name: input.displayName.trim(),
        role: input.baseRole === "admin" ? "admin" : input.baseRole === "manager" ? "supervisor" : "cashier",
        role_slug: input.roleSlug,
        store_id: input.branchId,
        active: input.active,
      },
    }),
  });
  if (!authUpdate.ok) throw new Error((await authUpdate.text()).slice(0, 240) || "The login account could not be updated");

  await serviceRpc("staff_account_upsert", {
    p_user_id: profile.user_id,
    p_full_name: input.displayName.trim(),
    p_email: profile.email,
    p_role: input.baseRole,
    p_role_slug: input.roleSlug,
    p_store_id: input.branchId,
    p_is_active: input.active,
    p_pin: "",
    p_pin_length: profile.pin_length,
    p_auth_user_id: profile.auth_user_id,
    p_permissions: null,
  });
  if (terminalAccount && credential) {
    await serviceRpc("staff_account_set_terminal_pin", {
      p_user_id: profile.user_id,
      p_pin: credential,
    });
  }
  await serviceRest("user_roles?user_id=eq." + encodeURIComponent(profile.auth_user_id), { method: "DELETE" });
  const roleResult = await serviceRest("user_roles", {
    method: "POST",
    prefer: "return=minimal",
    body: JSON.stringify([{ user_id: profile.auth_user_id, role: input.baseRole }]),
  });
  if (!roleResult.ok) throw new Error("The account role could not be updated");
}

async function callerId(accessToken: string): Promise<string> {
  const { url, key } = supabaseConfig();
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: key, Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error("Please sign in again");
  const body = (await response.json()) as { id?: string };
  if (!body.id) throw new Error("Please sign in again");
  return body.id;
}

export async function permanentlyDeleteStaff(
  username: string,
  caller: { accessToken?: string; staffUserId?: string | null },
): Promise<void> {
  const profile = await staffProfile(username);
  if (!profile?.auth_user_id) throw new Error("The staff account could not be found");
  const callerAuthId = caller.accessToken ? await callerId(caller.accessToken) : null;
  if (
    profile.auth_user_id === callerAuthId ||
    (!!caller.staffUserId && profile.user_id === caller.staffUserId)
  ) {
    throw new Error("CANNOT_DELETE_CURRENT_ACCOUNT");
  }
  await serviceRpc("staff_account_delete_profile", {
    p_user_id: profile.user_id,
    p_auth_user_id: profile.auth_user_id,
  });
  const deleted = await adminFetch(`admin/users/${profile.auth_user_id}`, { method: "DELETE" });
  if (!deleted.ok && deleted.status !== 404) {
    throw new Error((await deleted.text()).slice(0, 240) || "The login identity could not be deleted");
  }
}

type VerifiedPin = { username: string; fullName: string; storeId: string | null };

/** Resolve the staff username behind whatever was typed: username or address. */
async function usernameForIdentifier(identifier: string): Promise<string | null> {
  const value = identifier.trim().toLowerCase();
  if (!value.includes("@")) return null;
  const res = await serviceRest(
    `app_users?email=eq.${encodeURIComponent(value)}&select=user_id&limit=1`,
  );
  if (!res.ok) return null;
  const rows = (await res.json()) as { user_id?: string }[];
  const found = rows[0]?.user_id;
  return found ? String(found) : null;
}

/** Check a PIN against whichever record holds it: the account, or the old cashier row. */
async function verifyPin(username: string, pin: string): Promise<VerifiedPin | null> {
  const account = (await serviceRpc("verify_terminal_pin", {
    p_user_id: username,
    p_pin: pin,
  })) as { user_id?: string; full_name?: string; store_id?: string | null }[] | null;
  const row = Array.isArray(account) ? account[0] : null;
  if (row?.user_id) {
    return {
      username: String(row.user_id),
      fullName: String(row.full_name ?? row.user_id),
      storeId: row.store_id ?? null,
    };
  }
  // Someone typed the whole address (that is what the account list shows), so
  // find the username it belongs to and check the PIN against that.
  const byEmail = await usernameForIdentifier(username);
  if (byEmail && byEmail.toLowerCase() !== username.trim().toLowerCase()) {
    const second = (await serviceRpc("verify_terminal_pin", {
      p_user_id: byEmail,
      p_pin: pin,
    })) as { user_id?: string; full_name?: string; store_id?: string | null }[] | null;
    const hit = Array.isArray(second) ? second[0] : null;
    if (hit?.user_id) {
      return {
        username: String(hit.user_id),
        fullName: String(hit.full_name ?? hit.user_id),
        storeId: hit.store_id ?? null,
      };
    }
  }
  try {
    const legacy = (await serviceRpc("verify_cashier_pin", {
      p_username: username,
      p_pin: pin,
    })) as { username?: string; full_name?: string; store_id?: string | null }[] | null;
    const c = Array.isArray(legacy) ? legacy[0] : null;
    if (c?.username) {
      await serviceRpc("staff_account_adopt_legacy", { p_username: c.username });
      return {
        username: String(c.username),
        fullName: String(c.full_name ?? c.username),
        storeId: c.store_id ?? null,
      };
    }
  } catch {
    /* older databases have no cashier table */
  }
  return null;
}

/**
 * Silent healing path. The PIN is checked against the stored hash; when it
 * matches, a missing terminal-only account is created or repaired. A real
 * email account's ordinary password is never replaced with its approval PIN.
 * Returns the address to sign in with for legacy callers.
 */
export async function ensurePinAccount(
  username: string,
  pin: string,
): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const code = username.trim().toLowerCase();
  if (pin.length < 4 || pin.length > 32) return { ok: false, error: "Enter your PIN" };
  const verified = await verifyPin(code, pin);
  if (!verified) return { ok: false, error: "Invalid username or PIN" };

  // Sign in on the address this account actually holds; the hidden internal
  // address is only a fallback for rows that never had one.
  const stored = await staffProfile(verified.username);
  const email = stored?.email?.trim().toLowerCase() || internalEmail(verified.username);
  const terminalAccount = email.endsWith(`@${INTERNAL_EMAIL_DOMAIN}`);
  const existing = await findUserId(email);
  if (existing) {
    if (terminalAccount) {
      await adminFetch(`admin/users/${existing}`, {
        method: "PUT",
        body: JSON.stringify({ password: pin, email_confirm: true }),
      });
    }
    await serviceRpc("staff_account_upsert", {
      p_user_id: verified.username,
      p_full_name: verified.fullName,
      p_email: email,
      p_role: stored?.role ?? "staff",
      p_role_slug: stored?.role_slug ?? null,
      p_store_id: verified.storeId,
      p_is_active: stored?.is_active ?? true,
      p_pin: "",
      p_pin_length: pin.length,
      p_auth_user_id: existing,
      p_permissions: stored?.permissions ?? null,
    });
    return { ok: true, email };
  }

  if (!terminalAccount) {
    return { ok: false, error: "This email account needs its login identity repaired by an administrator" };
  }

  await provisionStaffAccount({
    displayName: verified.fullName,
    username: verified.username,
    pin,
    authorizationPin: pin,
    branchId: verified.storeId,
    roleSlug: "cashier",
    baseRole: "staff",
    active: true,
  });
  return { ok: true, email };
}

/** Bulk catch-up: copy every remaining cashier row across. */
export async function migrateLegacyCashiers(): Promise<{ migrated: number }> {
  const rows = (await serviceRpc("legacy_cashiers_for_migration", {})) as
    | { username?: string }[]
    | null;
  let migrated = 0;
  for (const row of rows ?? []) {
    if (!row.username) continue;
    await serviceRpc("staff_account_adopt_legacy", { p_username: row.username });
    migrated += 1;
  }
  return { migrated };
}

/** Active staff this till may offer on its sign-in grid. */
export async function listTerminalStaff(storeId: string | null) {
  const rows = (await serviceRpc("terminal_staff_list", { p_store_id: storeId })) as
    | Record<string, unknown>[]
    | null;
  return (rows ?? []).map((r) => ({
    username: String(r["user_id"] ?? ""),
    fullName: String(r["full_name"] ?? r["user_id"] ?? ""),
    roleSlug: String(r["role_slug"] ?? "cashier"),
    storeId: (r["store_id"] as string | null) ?? null,
    // PIN length is deliberately not published: it is the search space for a
    // guessing run. The keypad accepts up to its own maximum instead.
    pinLength: 0,
  }));
}
