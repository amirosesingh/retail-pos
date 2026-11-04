import type { Shift } from '@/core/types/pos-types';
import { sameBranchId } from './branch-id';

/** Operating selection only. This never restricts history or management corrections. */
export function operatingShiftAllowed(
  shift: Pick<Shift, 'storeId' | 'terminalId'>,
  branchId: string,
  registeredTerminalId: string | null,
  sharing: boolean,
): boolean {
  if (!sameBranchId(shift.storeId, branchId)) return false;
  if (sharing || !registeredTerminalId) return true;
  return !!shift.terminalId && shift.terminalId.toLowerCase() === registeredTerminalId.toLowerCase();
}
/** Unknown/older rules preserve the existing ON behavior; SQL remains authoritative. */
export const effectiveOperatingShiftSharing = (known: boolean | undefined): boolean => known !== false;

// The existing rules provider publishes its already-fetched effective rule.
// No extra network read, device storage or independent configuration editor.
const policies = new Map<string, boolean>();
const listeners = new Set<() => void>();
export const subscribeShiftSharing = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const readShiftSharing = (branch: string) => policies.get(branch);
export function publishShiftSharing(branch: string, value: boolean | undefined): void {
  if (!branch || policies.get(branch) === value) return;
  if (value === undefined) policies.delete(branch); else policies.set(branch, value);
  for (const listener of listeners) listener();
}
