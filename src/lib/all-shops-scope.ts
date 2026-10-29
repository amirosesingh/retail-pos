import type { Store } from "@/core/types/pos-types";
import { canonicalBranchId, sameBranchId } from "./branch-id";

/** The directory is already authorized; a fixed assignment still narrows it. */
export function allShopsScope(stores: readonly Store[], branchId: string, unrestrictedManagement: boolean): Store[] {
  return unrestrictedManagement ? [...stores] : stores.filter(store => sameBranchId(store.id,branchId));
}

export function shopClusterKey(store: Store): string {
  const cluster = canonicalBranchId(store.groupId);
  return cluster ? `cluster:${cluster}` : `branch:${canonicalBranchId(store.id)}`;
}

/** Totals selection never expands beyond the already-authorized card list. */
export function allShopsTotalsScope(stores: readonly Store[], selection: string): Store[] {
  return selection === "all" ? [...stores] : stores.filter(store => shopClusterKey(store) === selection);
}
