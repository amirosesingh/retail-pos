import type { Store } from "@/core/types/pos-types";
import { canonicalBranchId, sameBranchId } from "./branch-id";

/** A selected branch establishes the company context; an absent group never means all companies. */
export function companyStoreScope(stores: readonly Store[], contextBranchId: string, branchOnly = false): Store[] {
  const branch = stores.find(store => sameBranchId(store.id, contextBranchId));
  if (!branch) return [];
  const group = canonicalBranchId(branch.groupId);
  if (branchOnly || !group) return stores.filter(store => sameBranchId(store.id, branch.id));
  return stores.filter(store => !!store.groupId && canonicalBranchId(store.groupId) === group);
}
