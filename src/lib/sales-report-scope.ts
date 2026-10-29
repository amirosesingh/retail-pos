import { canonicalBranchId } from "./branch-id";

/** Report selection is a read scope, never authority to enlarge a user's/device's branch scope. */
export function salesReportScope(input: {
  selectedStoreId: string; currentStoreId: string; terminalStoreId?: string | null;
  userStoreId?: string | null; canSwitchStores: boolean; storeIds: readonly string[];
}) {
  const canAggregate = input.canSwitchStores && !input.terminalStoreId && !input.userStoreId;
  const pinned = canonicalBranchId(input.terminalStoreId || input.userStoreId || input.currentStoreId);
  const allowedStoreIds = canAggregate
    ? [...new Set(input.storeIds.filter(Boolean).map(canonicalBranchId))]
    : pinned ? [pinned] : [];
  const requested = canonicalBranchId(input.selectedStoreId);
  const storeId = canAggregate && requested === "all" ? "all"
    : canAggregate && allowedStoreIds.includes(requested) ? requested : pinned;
  const storeIds = storeId === "all" ? allowedStoreIds : storeId ? [storeId] : [];
  return { canAggregate, allowedStoreIds, storeId, storeIds };
}
