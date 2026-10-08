import type { LocationType, Product, Store } from "@/core/types/pos-types";
import { canonicalBranchId, canonicalStockMap } from "./branch-id";

/**
 * Location model helpers.
 *
 * A "location" is any physical place stock can sit: a storefront, a main
 * building, a sub-warehouse (floor / room / annex) nested inside one, or the
 * single central warehouse every inbound delivery lands in first.
 *
 * Nothing here writes: archiving, renaming and routing are all explicit user
 * actions handled by the screens that call these helpers.
 */

export const LOCATION_TYPES: { value: LocationType; label: string; hint: string }[] = [
  { value: "store", label: "Store", hint: "A storefront that sells to customers." },
  {
    value: "main_building",
    label: "Main building",
    hint: "A site that holds floors, rooms or annexes underneath it.",
  },
  {
    value: "sub_warehouse",
    label: "Sub-warehouse",
    hint: "A floor, vault, room or annex inside another location.",
  },
  {
    value: "central_warehouse",
    label: "Central warehouse",
    hint: "The hub every inbound delivery is received into first.",
  },
];

export const locationTypeLabel = (t?: LocationType | null) =>
  LOCATION_TYPES.find((x) => x.value === t)?.label ?? "Store";

/** Archived locations disappear from every picker but keep their history. */
export const isActiveLocation = (s: Store) => s.active !== false;

export const activeLocations = (stores: Store[]) => stores.filter(isActiveLocation);

/**
 * One authoritative row per location id.
 *
 * A reconnect can briefly surface the same shared row from the local snapshot
 * and the just-arrived cloud page.  Keeping the newest occurrence prevents a
 * duplicate React key and, more importantly, prevents an obsolete parent copy
 * from putting a branch back into the visible tree.
 */
export function canonicalLocations(stores: Store[]): Store[] {
  const byId = new Map<string, Store>();
  for (const store of stores) {
    const id = canonicalBranchId(store.id);
    if (!id) continue;
    byId.set(id, {
      ...store,
      id,
      parentId: store.parentId ? canonicalBranchId(store.parentId) : store.parentId,
    });
  }
  return [...byId.values()];
}

/** Sub-locations nested directly under `id`. */
export const childrenOf = (stores: Store[], id: string) =>
  activeLocations(canonicalLocations(stores)).filter((s) => s.parentId === canonicalBranchId(id));

/** Locations with no parent — the roots of the tree. */
export const rootLocations = (stores: Store[]) => {
  const live = activeLocations(stores);
  const ids = new Set(live.map((s) => s.id));
  return live.filter((s) => !s.parentId || !ids.has(s.parentId));
};

/** The whole subtree under `id`, including `id` itself. */
export function descendants(stores: Store[], id: string): Store[] {
  const out: Store[] = [];
  const live = canonicalLocations(stores);
  const visited = new Set<string>();
  const walk = (nodeId: string) => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const self = live.find((store) => store.id === nodeId);
    if (!self) return;
    out.push(self);
    for (const child of childrenOf(live, nodeId)) walk(child.id);
  };
  walk(canonicalBranchId(id));
  return out;
}

/** Depth-first walk of the active tree with nesting depth for indentation. */
export function locationTree(stores: Store[]): { store: Store; depth: number }[] {
  const live = activeLocations(canonicalLocations(stores));
  const visited = new Set<string>();
  const out: { store: Store; depth: number }[] = [];
  const walk = (node: Store, depth: number) => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    out.push({ store: node, depth });
    for (const child of childrenOf(live, node.id)) walk(child, depth + 1);
  };
  for (const root of rootLocations(live)) walk(root, 0);
  // Corrupt legacy data can contain a parent cycle, which has no natural root.
  // Keep each live location reachable once instead of recursing forever or
  // silently losing the whole cycle from the management screen.
  for (const store of live) if (!visited.has(store.id)) walk(store, 0);
  return out;
}

/** The nominated central hub, or the first active location as a fallback. */
export const centralHub = (stores: Store[]) =>
  activeLocations(stores).find((s) => s.isCentral) ??
  activeLocations(stores).find((s) => s.locationType === "central_warehouse") ??
  null;

/**
 * Where stock received at the hub can actually be put away for a branch.
 * A branch with no sub-locations receives into itself.
 */
export function routingTargets(stores: Store[], branchId: string): Store[] {
  const kids = descendants(stores, branchId).filter(
    (s) => s.id !== branchId && s.locationType !== "main_building",
  );
  if (kids.length) return kids;
  const self = stores.find((s) => s.id === branchId);
  return self ? [self] : [];
}

/** Human path, e.g. "Riverside Tower › 2nd Floor Vault". */
export function locationPath(stores: Store[], id: string): string {
  const parts: string[] = [];
  let node = stores.find((s) => s.id === id);
  let hops = 0;
  while (node && hops < 20) {
    parts.unshift(node.name);
    node = node.parentId ? stores.find((s) => s.id === node?.parentId) : undefined;
    hops += 1;
  }
  return parts.join(" › ");
}

export const stockAtLocation = (p: Product, id: string) =>
  Number(canonicalStockMap(p.stockByStore)[canonicalBranchId(id)] ?? 0) || 0;

/** Units sitting at a location and everything nested under it. */
export const rolledUpStock = (products: Product[], stores: Store[], id: string) => {
  const ids = descendants(stores, id).map((s) => s.id);
  return products.reduce((a, p) => a + ids.reduce((b, x) => b + stockAtLocation(p, x), 0), 0);
};

/**
 * Archiving guard. A location keeps its history forever, so it can only leave
 * the pickers once it is empty and none of its sub-locations are still live.
 */
export function archiveBlockers(
  products: Product[],
  stores: Store[],
  id: string,
): { reason: string; items: { name: string; qty: number }[] } | null {
  const liveChildren = childrenOf(stores, id);
  if (liveChildren.length)
    return {
      reason: `Archive the ${liveChildren.length} sub-location${liveChildren.length > 1 ? "s" : ""} underneath it first.`,
      items: [],
    };
  const items = products
    .map((p) => ({ name: p.name, qty: stockAtLocation(p, id) }))
    .filter((x) => x.qty > 0)
    .sort((a, b) => b.qty - a.qty);
  if (items.length)
    return {
      reason: `${items.length} product${items.length > 1 ? "s" : ""} still hold stock here. Transfer them out first.`,
      items: items.slice(0, 12),
    };
  return null;
}

/* ------------------------------------------------------------------ *
 * Sub-warehouse levels
 * ------------------------------------------------------------------ */

/** The levels (floors / rooms) nested directly under a warehouse. */
export const subWarehouses = (stores: Store[], id: string) =>
  childrenOf(stores, id).filter((s) => s.locationType === "sub_warehouse");

/** The level stock is picked from first. Falls back to the first level. */
export const primarySub = (stores: Store[], id: string) => {
  const subs = subWarehouses(stores, id);
  return subs.find((s) => s.isPrimarySub) ?? subs[0] ?? null;
};

/** Pick order: default primary first, then the remaining levels, then the
 *  warehouse's own bucket (stock booked in before levels existed). */
export function pickOrder(stores: Store[], id: string): Store[] {
  const subs = subWarehouses(stores, id);
  if (!subs.length) return [];
  const primary = primarySub(stores, id);
  const rest = subs.filter((s) => s.id !== primary?.id);
  const self = activeLocations(canonicalLocations(stores)).find((s) => s.id === canonicalBranchId(id));
  return [...(primary ? [primary] : []), ...rest, ...(self ? [self] : [])];
}

export type DeductionPick = { storeId: string; name: string; qty: number };
export type DeductionPlan = { picks: DeductionPick[]; taken: number; shortBy: number };

/**
 * Works out which levels a quantity actually leaves from.
 *
 * One level holding the item → it all comes from there. Both holding it →
 * the default primary empties first and the balance tops up from the next
 * level. Not enough anywhere → `shortBy` is set and nothing should move.
 */
export function planDeduction(
  product: Product,
  stores: Store[],
  warehouseId: string,
  qty: number,
): DeductionPlan {
  if (!Number.isFinite(qty) || qty < 0) throw new Error("Enter a finite, non-negative stock quantity.");
  const want = qty;
  warehouseId = canonicalBranchId(warehouseId);
  const live = activeLocations(canonicalLocations(stores));
  if (!live.some(store => store.id === warehouseId))
    return { picks: [], taken: 0, shortBy: want };
  const order = pickOrder(live, warehouseId);
  if (!order.length) {
    const have = stockAtLocation(product, warehouseId);
    const taken = Math.min(have, want);
    const self = stores.find((s) => s.id === warehouseId);
    return {
      picks:
        taken > 0 ? [{ storeId: warehouseId, name: self?.name ?? "Location", qty: taken }] : [],
      taken,
      shortBy: want - taken,
    };
  }
  const picks: DeductionPick[] = [];
  let left = want;
  for (const level of order) {
    if (left <= 0) break;
    const have = stockAtLocation(product, level.id);
    if (have <= 0) continue;
    const take = Math.min(have, left);
    picks.push({ storeId: level.id, name: level.name, qty: take });
    left -= take;
  }
  return { picks, taken: want - left, shortBy: left };
}

/** Units of one product across a warehouse and every level under it. */
export const availableAt = (product: Product, stores: Store[], id: string) =>
  activeLocations(descendants(stores, id)).reduce((a, s) => a + stockAtLocation(product, s.id), 0);
