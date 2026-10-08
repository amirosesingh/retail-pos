import type { Store } from "@/core/types/pos-types";
import { canonicalBranchId, sameBranchId } from "./branch-id";
import { centralHub } from "./locations";

/** Electron can commit stock only in its paired SQL Server branch. */
export function receivingLocation(
  stores: Store[], currentStore: Store, local: boolean, pairedBranchId: string | null,
): Store {
  if (!local) return centralHub(stores) ?? currentStore;
  const id = canonicalBranchId(pairedBranchId);
  const paired = stores.find((store) => sameBranchId(store.id, id));
  if (paired) return { ...paired, id };
  if (sameBranchId(currentStore.id, id)) return { ...currentStore, id };
  // A stale directory must not redirect stock to an older selected branch.
  return { id, code: "", name: "This terminal's branch", address: "", phone: "" };
}
