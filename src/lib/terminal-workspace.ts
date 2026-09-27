import type { TerminalPurpose } from "@/core/types/pos-types";

export type WorkspaceEntryInput = {
  purpose?: TerminalPurpose;
  isAdmin: boolean;
  isSupervisor: boolean;
  isCashier: boolean;
  forcedSelling?: boolean;
  resumeSale?: boolean;
  bookingFlow?: boolean;
};

/**
 * Decide only the landing experience. This deliberately does not decide access:
 * every destination still enforces the signed-in user's permission matrix.
 */
export function shouldOpenRegister(input: WorkspaceEntryInput): boolean {
  if (input.forcedSelling || input.resumeSale || input.bookingFlow) return true;
  if (input.isAdmin || input.isSupervisor) return false;
  return (input.purpose ?? "retail") === "retail" && input.isCashier;
}

const PURPOSE_NAV_ORDER: Record<TerminalPurpose | "management-user", string[]> = {
  retail: ["register", "bookings", "people", "inventory", "reports", "company"],
  warehouse: ["inventory", "company", "reports", "people", "register", "bookings"],
  inventory: ["inventory", "reports", "company", "people", "register", "bookings"],
  receiving: ["inventory", "company", "reports", "register", "people", "bookings"],
  management: ["company", "reports", "people", "inventory", "register", "bookings"],
  "management-user": ["company", "reports", "people", "inventory", "register", "bookings"],
};

/** Reorder the same permitted destinations without creating another sidebar. */
export function orderWorkspaceGroups<T extends { id: string }>(
  groups: T[],
  purpose: TerminalPurpose | undefined,
  managementUser: boolean,
): T[] {
  const order = PURPOSE_NAV_ORDER[managementUser ? "management-user" : (purpose ?? "retail")];
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...groups].sort(
    (a, b) =>
      (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );
}
