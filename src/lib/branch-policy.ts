/**
 * Per-branch isolation and sync switches.
 *
 * Some branches (a standalone shop, a warehouse) keep their own inventory and
 * may be cut off from the group entirely. The switches live in the shared
 * integration settings so every terminal of that branch agrees on them.
 */
import { defaultBranchPolicy, type AppSettings, type BranchPolicy, type Product, type Store, type Transfer } from "@/core/types/pos-types";
import { canonicalBranchId, canonicalStockMap, sameBranchId } from "./branch-id";

export type BranchPolicyKey = keyof BranchPolicy;

export const BRANCH_POLICY_COPY: Record<
  BranchPolicyKey,
  { label: string; hint: string; onWarning: string; offWarning: string }
> = {
  privateStock: {
    label: "Private stock",
    hint: "Keep this branch's stock levels out of other branches and group totals.",
    onWarning:
      "Other branches will no longer see this branch's stock, and it will drop out of group inventory totals.",
    offWarning: "This branch's stock will be visible to every other branch again.",
  },
  privateCatalogue: {
    label: "Private catalogue",
    hint: "Keep legacy shared catalogues private. Branches in the same cluster and completed incoming transfers remain available.",
    onWarning: "Unassigned legacy products without stock or transfer evidence will be hidden. This does not separate branches in the same cluster.",
    offWarning: "Allow the legacy shared catalogue where no separate cluster is assigned. Other clusters remain separate until products are transferred.",
  },
  allowTransfers: {
    label: "Allow stock transfers",
    hint: "Stock may be sent to and requested from other branches.",
    onWarning: "This branch will appear again as a transfer source and destination.",
    offWarning: "No stock will be able to move in or out of this branch.",
  },
  syncInventory: {
    label: "Sync inventory",
    hint: "Push product and stock changes to the central server.",
    onWarning: "Queued product and stock changes will be pushed to the central server.",
    offWarning:
      "Product and stock changes will be held on this terminal until you switch sync back on. Nothing is lost.",
  },
  syncOther: {
    label: "Sync sales, shifts & members",
    hint: "Push bills, shifts, members and audit trail to the central server.",
    onWarning: "Queued bills, shifts and members will be pushed to the central server.",
    offWarning:
      "Bills, shifts, members and audit rows will be held on this terminal until you switch sync back on. Nothing is lost.",
  },
};

/** Effective policy for one branch — anything unset falls back to shared. */
export function branchPolicy(settings: AppSettings, storeId: string, stores: readonly Store[] = []): BranchPolicy {
  const saved = Object.entries(settings.integrations.branches ?? {}).find(([id]) => sameBranchId(id, storeId))?.[1];
  const store = stores.find(entry => sameBranchId(entry.id, storeId));
  const policy = { ...defaultBranchPolicy, ...(saved ?? {}) };
  // Either persisted source can enforce privacy while older installations finish
  // synchronizing. A stale unchecked copy must not publish another catalogue.
  return { ...policy, privateCatalogue: policy.privateCatalogue || store?.privateCatalogue === true };
}

/** Stamp only new records; legacy ownership is never inferred or rewritten. */
export function branchOwnsNewCatalogue(settings: AppSettings, storeId: string, stores: readonly Store[]): boolean {
  return !!stores.find(store => sameBranchId(store.id, storeId))?.groupId?.trim() || branchPolicy(settings, storeId, stores).privateCatalogue;
}

/** Store ids that hide their stock from everyone else. */
export function privateStockStores(settings: AppSettings): Set<string> {
  const map = settings.integrations.branches ?? {};
  return new Set(Object.entries(map).filter(([, p]) => p?.privateStock).map(([id]) => id));
}

type CatalogueProduct = string | Pick<Product, "id"> & Partial<Pick<Product, "ownerStoreId" | "stockByStore" | "catalogueStoreIds">>;

/**
 * Build once per settings/directory/transfer change, not once per product row.
 * A cluster is a catalogue boundary. Transfer visibility comes from posted
 * destination records, never a draft request or a pre-created zero stock key.
 */
export function createCatalogueVisibility(
  settings: AppSettings,
  stores: readonly Store[],
  transfers: readonly Transfer[] = [],
): (product: CatalogueProduct, storeId: string) => boolean {
  const byId = new Map(stores.map(store => [canonicalBranchId(store.id), store]));
  const groups = new Set(stores.map(store => canonicalBranchId(store.groupId)).filter((group): group is string => !!group));
  const policies = new Map(stores.map(store => [canonicalBranchId(store.id), branchPolicy(settings, store.id, stores)]));
  const policy = (id: string) => policies.get(id) ?? branchPolicy(settings, id);
  const group = (id: string) => canonicalBranchId(byId.get(id)?.groupId);
  const legacyOwners = new Map(Object.entries(settings.integrations.productOwners ?? {}).map(([id, owner]) => [canonicalBranchId(id), owner]));
  const sameCatalogue = (left: string, right: string) => {
    if (sameBranchId(left, right)) return true;
    const leftGroup = group(left), rightGroup = group(right);
    return !!leftGroup && !!rightGroup && leftGroup === rightGroup;
  };
  const receivedByProduct = new Map<string, Set<string>>();
  for (const transfer of transfers) {
    if (!transfer.postedAt || !["completed", "completed_with_discrepancy"].includes(transfer.status)) continue;
    const destination = canonicalBranchId(transfer.toStoreId);
    if (!destination) continue;
    for (const item of transfer.items) {
      const received = item.verifiedQty ?? item.receivedQty ?? 0;
      if (!Number.isFinite(received) || received <= 0) continue;
      const productId = canonicalBranchId(item.productId);
      const destinations = receivedByProduct.get(productId) ?? new Set<string>();
      destinations.add(destination);
      receivedByProduct.set(productId, destinations);
    }
  }
  return (product, storeId) => {
    const target = canonicalBranchId(storeId);
    if (!target || (stores.length > 0 && !byId.has(target))) return false;
    const id = typeof product === "string" ? product : product.id;
    const owner = canonicalBranchId((typeof product === "string" ? null : product.ownerStoreId) || legacyOwners.get(canonicalBranchId(id)));
    if (owner && sameCatalogue(owner, target)) return true;
    if (typeof product !== "string" && product.catalogueStoreIds?.some(destination => sameCatalogue(canonicalBranchId(destination), target))) return true;
    const received = receivedByProduct.get(canonicalBranchId(id));
    if (received && [...received].some(destination => sameCatalogue(destination, target))) return true;
    if (owner) {
      // Known distinct clusters stay separate even when both private switches
      // are off. Missing cluster ownership cannot silently join a known group.
      if ((stores.length > 0 && !byId.has(owner)) || group(owner) || group(target)) return false;
      return !policy(owner).privateCatalogue && !policy(target).privateCatalogue;
    }
    // Legacy global rows need real branch activity as evidence. Every imported
    // item can have every branch's zero bucket, so presence alone proves nothing.
    if (typeof product !== "string") {
      const hasLocalStock = Object.entries(canonicalStockMap(product.stockByStore)).some(
        ([branch, quantity]) => quantity !== 0 && sameCatalogue(branch, target),
      );
      if (hasLocalStock) return true;
    }
    // Preserve the original shared catalogue for a single non-private catalogue.
    // Ambiguous old zero-stock rows in private/multi-cluster data need owner
    // review; do not guess ownership or rewrite stock to make them visible.
    return groups.size <= 1 && !policy(target).privateCatalogue;
  };
}

/** Compatibility entry point for callers without a loaded directory. */
export function productVisibleAt(
  settings: AppSettings,
  product: CatalogueProduct,
  storeId: string,
  stores: readonly Store[] = [],
  transfers: readonly Transfer[] = [],
): boolean {
  return createCatalogueVisibility(settings, stores, transfers)(product, storeId);
}

/** Tables whose writes are governed by the inventory sync switch. */
const INVENTORY_TABLES = new Set(["products", "purchase_orders", "purchase_order_items", "stores"]);

/** Should a queued write for this table leave the branch right now? */
export function syncAllowed(policy: BranchPolicy, table: string): boolean {
  return INVENTORY_TABLES.has(table) ? policy.syncInventory : policy.syncOther;
}
