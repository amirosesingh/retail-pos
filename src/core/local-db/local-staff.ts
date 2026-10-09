/**
 * Offline sign-in backed by the till's local SQL database.
 *
 * The desktop shell mirrors the staff roster into its local database and keeps
 * a PBKDF2 verifier for anyone who has signed in online on this machine. When
 * the central database cannot be reached, sign-in is answered from there.
 *
 * On the web build the bridge is absent and every call is a no-op, so the
 * existing browser-storage cache remains the fallback.
 */
import { localDb, type LocalStaffRow } from "@/core/local-db/local-db";

export type LocalStaffLogin = {
  id: string;
  username: string;
  full_name: string;
  store_id: string | null;
  permissions: Record<string, boolean>;
  roleSlug: string;
};

export const hasLocalStaffStore = (): boolean =>
  typeof window !== "undefined" && typeof window.pos?.verifyStaffPin === "function";

/** Everyone this till can sign in offline, for the name picker. */
export async function localStaffRoster(storeId: string | null): Promise<LocalStaffRow[]> {
  try {
    const res = await localDb()?.staffRoster?.(storeId);
    return res?.ok ? res.rows : [];
  } catch {
    return [];
  }
}

/** Mirror the roster the server just returned, so it is there when it is not. */
export async function cacheStaffRoster(rows: Record<string, unknown>[]): Promise<void> {
  if (!rows.length) return;
  try {
    await localDb()?.cacheStaffRoster?.(rows);
  } catch {
    /* the till still works without an offline roster */
  }
}

/** Remember this PIN (as a verifier) after a successful online sign-in. */
export async function rememberLocalPin(username: string, pin: string): Promise<void> {
  try {
    await localDb()?.rememberStaffPin?.(username, pin);
  } catch {
    /* best effort */
  }
}

export type LocalPinResult =
  | { ok: true; staff: LocalStaffLogin }
  | { ok: false; reason: string; error: string };

/** Check a PIN against the local database. */
export async function verifyLocalPin(username: string, pin: string, signIn = false): Promise<LocalPinResult> {
  const bridge = localDb();
  if (!bridge?.verifyStaffPin)
    return { ok: false, reason: "unavailable", error: "No local database on this device" };
  try {
    const verify = signIn ? bridge.signInStaffPin : bridge.verifyStaffPin;
    if (!verify) return { ok: false, reason: "unavailable", error: "Update the desktop application to sign in locally." };
    const res = await verify(username, pin);
    if (res?.ok && res.staff)
      return {
        ok: true,
        staff: {
          id: res.staff.id,
          username: res.staff.username,
          full_name: res.staff.full_name,
          store_id: res.staff.store_id,
          permissions: res.staff.permissions ?? {},
          roleSlug: res.staff.role_slug ?? "staff",
        },
      };
    return {
      ok: false,
      reason: res?.reason ?? "unknown",
      error: res?.error ?? "Invalid username or PIN",
    };
  } catch (error) {
    return { ok: false, reason: "error", error: (error as Error).message };
  }
}

/** Check the independent manager-approval PIN against the local mirror. */
export async function verifyLocalApprovalPin(username: string, pin: string): Promise<LocalPinResult> {
  const bridge = localDb();
  if (!bridge?.verifyApprovalPin)
    return { ok: false, reason: "unavailable", error: "No local approval verifier on this device" };
  try {
    const res = await bridge.verifyApprovalPin(username, pin);
    if (res?.ok && res.staff) {
      return {
        ok: true,
        staff: {
          id: res.staff.id,
          username: res.staff.username,
          full_name: res.staff.full_name,
          store_id: res.staff.store_id,
          permissions: res.staff.permissions ?? {},
          roleSlug: res.staff.role_slug ?? "staff",
        },
      };
    }
    return { ok: false, reason: res?.reason ?? "unknown", error: res?.error ?? "Invalid approval PIN" };
  } catch (error) {
    return { ok: false, reason: "error", error: (error as Error).message };
  }
}
