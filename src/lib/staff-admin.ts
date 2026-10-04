/**
 * Staff provisioning, called from the admin screens.
 *
 * The browser never holds the key that can create accounts: every call here
 * goes to the server, which checks that the person asking is a supervisor.
 */
import { listTerminalStaffAccounts, preparePinSignIn } from "@/lib/staff-admin.functions";
import {
  deleteStaffAccount,
  migrateCashiersToAccounts,
  saveStaffAccount,
  setStaffAccountActive,
  updateStaffAccount,
} from "@/lib/staff-admin-client";
import type { StaffRole } from "@/lib/permissions";
import { isExternalEmail } from "@/lib/internal-domains";
import { readTerminalConfig } from "@/core/activation/terminal-tokens";
import { getPosCallerAuth } from "@/lib/pos-caller-auth";

export type StaffAccountInput = {
  displayName: string;
  /** username, or a real email address */
  username: string;
  pin?: string;
  password?: string;
  /** Separate PIN used only when this person approves a governed action. */
  authorizationPin: string;
  branchId?: string | null;
  roleSlug: string;
  baseRole: StaffRole;
  active: boolean;
};

/** A real address is anything with an "@" outside our own hidden domains. */
export const looksLikeEmail = (input: string) => isExternalEmail(input);

/** Built-in levels map onto the three access tiers the database understands. */
export const dbBaseRole = (role: StaffRole): "admin" | "manager" | "staff" =>
  role === "admin" ? "admin" : role === "supervisor" ? "manager" : "staff";

/** Create a staff member, or update the one that already holds this username. */
export async function createStaffMember(input: StaffAccountInput): Promise<void> {
  const identifier = input.username.trim().toLowerCase();
  const emailMode = looksLikeEmail(identifier);
  if (!input.roleSlug) throw new Error("Choose a role for this person");
  if (!/^\d{4,6}$/.test(input.authorizationPin)) {
    throw new Error("Set a 4 to 6 digit authorisation PIN");
  }
  if (emailMode) {
    if ((input.password ?? "").length < 8)
      throw new Error("Set a password of at least 8 characters for an email account");
  } else if ((input.pin ?? "").length < 4 || (input.pin ?? "").length > 32) {
    throw new Error("A till PIN or passcode must be 4 to 32 characters");
  }
  const res = await saveStaffAccount({
    data: {
      ...(await getPosCallerAuth()),
      displayName: input.displayName,
      username: identifier,
      ...(emailMode ? { password: input.password ?? "" } : { pin: input.pin ?? "" }),
      authorizationPin: input.authorizationPin,
      branchId: input.branchId ?? null,
      roleSlug: input.roleSlug,
      baseRole: dbBaseRole(input.baseRole),
      active: input.active,
    },
  });
  if (!res.ok) throw new Error(res.error);
}

/** Turn an account on or off. A blocked person cannot sign in anywhere. */
export async function toggleStaffStatus(username: string, active: boolean): Promise<void> {
  const res = await setStaffAccountActive({
    data: { ...(await getPosCallerAuth()), username, active },
  });
  if (!res.ok) throw new Error(res.error);
}

export async function updateStaffMember(input: {
  username: string;
  displayName: string;
  branchId: string | null;
  roleSlug: string;
  baseRole: StaffRole;
  active: boolean;
  credential?: string;
}): Promise<void> {
  const res = await updateStaffAccount({
    data: {
      ...(await getPosCallerAuth()),
      ...input,
      baseRole: dbBaseRole(input.baseRole),
    },
  });
  if (!res.ok) throw new Error(res.error);
}

export async function permanentlyDeleteStaffMember(username: string): Promise<void> {
  const res = await deleteStaffAccount({
    data: { ...(await getPosCallerAuth()), username },
  });
  if (!res.ok) throw new Error(res.error);
}

/** Copy any remaining old cashier records onto real accounts. */
export async function migrateLegacyCashiers(): Promise<number> {
  const res = await migrateCashiersToAccounts({ data: await getPosCallerAuth() });
  if (!res.ok) throw new Error(res.error);
  return res.migrated;
}

export type TerminalStaff = {
  username: string;
  fullName: string;
  roleSlug: string;
  storeId: string | null;
  pinLength: number;
};

/** Why the sign-in grid has no names on it. */
export type RosterReason =
  | "ok"
  /** this build has no POS server address saved on the device */
  | "no-server"
  /** the address is saved but nothing answered */
  | "unreachable"
  /** the server answered but would not hand over the roster */
  | "not-authorised"
  /** the answer was fine, this branch simply has nobody assigned */
  | "empty";

export type TerminalRoster = { staff: TerminalStaff[]; reason: RosterReason };

/** Staff to show on a till's sign-in grid, plus why the list is empty. */
export async function listTerminalStaff(storeId: string | null): Promise<TerminalRoster> {
  const rows = (value: unknown): TerminalStaff[] => {
    const staff = (value as { staff?: unknown } | null)?.staff;
    return Array.isArray(staff) ? (staff as TerminalStaff[]) : [];
  };
  /** Keep the roster in the till's own database for the next outage. */
  const mirror = async (staff: TerminalStaff[]) => {
    if (!staff.length) return staff;
    try {
      const { cacheStaffRoster } = await import("@/core/local-db/local-staff");
      await cacheStaffRoster(
        staff.map((s) => ({
          id: s.username,
          user_id: s.username,
          full_name: s.fullName,
          store_id: s.storeId,
          role_slug: s.roleSlug,
          pin_length: s.pinLength,
          is_active: true,
        })),
      );
    } catch {
      /* mirroring is best-effort */
    }
    return staff;
  };
  const done = (staff: TerminalStaff[], empty: RosterReason = "empty"): TerminalRoster => ({
    staff,
    reason: staff.length ? "ok" : empty,
  });
  try {
    // Android talks to the hosted POS directly; a server function would be
    // answered by the phone's own static file server. The roster is staff
    // data, so the endpoint only answers a registered terminal.
    const { serverOrigin, serverUnreachableOnDevice, posFetch } = await import("./server-origin");
    if (serverUnreachableOnDevice()) return { staff: [], reason: "no-server" };
    if (serverOrigin()) {
      const terminalToken = readTerminalConfig()?.tokenId ?? "";
      const res = await posFetch("/api/public/terminal-staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, terminalToken }),
      });
      if (res.status === 401 || res.status === 403) return { staff: [], reason: "not-authorised" };
      if (!res.ok) return { staff: [], reason: "unreachable" };
      return done(await mirror(rows(await res.json().catch(() => null))));
    }

    const terminalToken = readTerminalConfig()?.tokenId;
    if (!terminalToken) return { staff: [], reason: "not-authorised" };
    return done(
      await mirror(
        rows(
          await listTerminalStaffAccounts({
            data: { storeId, terminalToken },
          }),
        ),
      ),
    );
  } catch {
    // A till must still be able to sign in by typing a username.
    return { staff: [], reason: "unreachable" };
  }
}

/** Ask the server to make sure this person's account matches the PIN typed in. */
export async function preparePinAccount(
  username: string,
  pin: string,
): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  return preparePinSignIn({ data: { username, pin } });
}
