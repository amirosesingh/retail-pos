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
