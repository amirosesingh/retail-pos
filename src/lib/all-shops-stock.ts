import type { Store } from "@/core/types/pos-types";
import { canonicalBranchId, sameBranchId } from "./branch-id";
import { companyStoreScope } from "./company-store-scope";

export type StockDisplayScope = {
  currentStoreId: string;
  terminalStoreId?: string | null;
  userStoreId?: string | null;
  canSwitchStores: boolean;
};

/**
 * Presentation scope only: the supplied directory must already be authorized.
 * Terminal/account binding wins over management access and the selected view.
 * Never redact the authoritative product map used by checkout and lifecycle here.
 */
export function stockDisplayLocations(stores: readonly Store[], scope: StockDisplayScope, availabilityOnly = false): Store[] {
  const bound = canonicalBranchId(scope.terminalStoreId) || canonicalBranchId(scope.userStoreId);
  const branch = bound || canonicalBranchId(scope.currentStoreId);
  const management = !bound && scope.canSwitchStores;
  const candidates = management ? stores : availabilityOnly ? companyStoreScope(stores, branch) : stores.filter(store => sameBranchId(store.id, branch));
  const seen = new Set<string>();
  return candidates.filter(store => {
    const id = canonicalBranchId(store.id);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** Read-only source availability; callers must exclude nonpositive quantities. */
export function clusterAvailableStockLocations(stores: readonly Store[], scope: StockDisplayScope): Store[] {
  return stockDisplayLocations(stores, scope, true);
}
