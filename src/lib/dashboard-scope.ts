import type { Store } from "@/core/types/pos-types";
import { allShopsScope } from "./all-shops-scope";

/** A page may narrow an authorized directory; it never establishes authority. */
export function dashboardPageStores(stores: readonly Store[], currentStoreId: string,
  terminalStoreId: string | null | undefined, userStoreId: string | null | undefined,
  canSwitchStores: boolean, view: "branch" | "company"): Store[] {
  const bound = terminalStoreId || userStoreId;
  return allShopsScope(stores, bound || currentStoreId,
    view === "company" && canSwitchStores && !bound);
}
