import type { AppSettings, Store } from "@/core/types/pos-types";
import { privateStockStores } from "./branch-policy";
import { canonicalBranchId, sameBranchId } from "./branch-id";

/** Branch identities/sales stay visible; only another branch's private stock is excluded. */
export function groupStockLocations(stores: Store[], settings: AppSettings, currentStoreId: string) {
  const privateIds = new Set([...privateStockStores(settings)].map(canonicalBranchId));
  return stores.filter(store => !privateIds.has(canonicalBranchId(store.id)) || sameBranchId(store.id, currentStoreId));
}
