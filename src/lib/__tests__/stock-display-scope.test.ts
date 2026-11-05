import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { Product, Store } from "@/core/types/pos-types";
import { stockDisplayLocations as fullStockDisplayLocations, clusterAvailableStockLocations as stockDisplayLocations } from "../all-shops-stock";
import { applyZeroStockLifecycle } from "../product-lifecycle";
import { createCatalogueVisibility } from "../branch-policy";
import { defaultSettings } from "../pos-seed";
import { OtherSourcesPopover } from "@/platforms/web/components/pos/OtherSourcesPopover";

// Render the complete popup contents for privacy assertions without a browser portal.
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => h("div", null, children),
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => h("div", null, children),
  PopoverContent: ({ children }: { children: React.ReactNode }) => h("section", null, children),
}));

const a = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const b = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const c = "cccccccc-cccc-4ccc-cccc-cccccccccccc";
const store = (id: string, active = true): Store => ({ id, code: id, name: id, address: "", phone: "", groupId: "cluster-one", privateCatalogue: true, active });
const stores = [store(a), store(b)];
const product: Product = { id: "item", name: "Racket", sku: "R1", barcode: "R1", category: "Default", cost: 10, price: 20, taxRate: 0, reorderLevel: 1, ownerStoreId: a, stockByStore: { [a]: 0, [b]: 4, [c]: 987 } };
const render = (locations: Store[], item = product, currentStoreId = a) => renderToStaticMarkup(h(OtherSourcesPopover, { stores: locations, product: item, currentStoreId }));

describe("stock display scope", () => {
  it("does not broaden normal-terminal full stock reports when permitting source availability", () => {
    const scope = { currentStoreId: b, terminalStoreId: a, canSwitchStores: true };
    expect(fullStockDisplayLocations(stores, scope)).toEqual([stores[0]]);
    expect(stockDisplayLocations(stores, scope)).toEqual(stores);
  });
  it.each([false, true])("a registered branch anchors its cluster despite management capability %s", canSwitchStores => {
    const directory = [...stores, { ...store(c), groupId: "foreign" }];
    const permitted = stockDisplayLocations(directory, { currentStoreId: c, terminalStoreId: a, canSwitchStores });
    expect(permitted.map(s => s.id)).toEqual([a, b]);
    expect(render(permitted)).toContain("total 4 pcs");
    expect(render(permitted)).not.toContain("987");
  });

  it("an assigned user stays within its assigned cluster", () => {
    expect(stockDisplayLocations([...stores, { ...store(c), groupId: "foreign" }], { currentStoreId: c, userStoreId: a, canSwitchStores: true })).toEqual(stores);
  });

  it("management sees only its supplied authorized directory, including private-stock branches", () => {
    const permitted = stockDisplayLocations(stores, { currentStoreId: a, canSwitchStores: true });
    expect(permitted).toEqual(stores);
    const html = render(permitted);
    expect(html).toContain("Other sources for Racket: 1, total 4 pcs");
    expect(html).not.toContain("987");
    expect(html).not.toContain(c);
  });

  it.each([
    { currentStoreId: b, terminalStoreId: "missing", canSwitchStores: true },
    { currentStoreId: b, userStoreId: "missing", canSwitchStores: true },
    { currentStoreId: "missing", canSwitchStores: false },
    { currentStoreId: "", canSwitchStores: false },
  ])("fails closed for absent or unknown bound branches: %j", scope => {
    expect(stockDisplayLocations(stores, scope)).toEqual([]);
  });

  it("an unbound non-management view displays only its current cluster", () => {
    expect(stockDisplayLocations(stores, { currentStoreId: b, canSwitchStores: false })).toEqual(stores);
  });

  it("switching an authorized management view updates sources without granting another branch", () => {
    const item = { ...product, stockByStore: { [a]: 2, [b]: 4, [c]: 987 } };
    const permitted = stockDisplayLocations(stores, { currentStoreId: b, canSwitchStores: true });
    expect(render(permitted, item, a)).toContain("Other sources for Racket: 1, total 4 pcs");
    expect(render(permitted, item, b)).toContain("Other sources for Racket: 1, total 2 pcs");
    expect(render(stockDisplayLocations([stores[0]], { currentStoreId: b, canSwitchStores: true }), item, b)).toContain("No available sources");
  });

  it("canonicalizes SQL UUIDs without duplicating locations or stock totals", () => {
    const directory = [store(a.toUpperCase()), store(a), store(b), store(b.toUpperCase())];
    const permitted = stockDisplayLocations(directory, { currentStoreId: a, canSwitchStores: true });
    expect(permitted).toHaveLength(2);
    expect(stockDisplayLocations(directory, { currentStoreId: b, terminalStoreId: a, canSwitchStores: true })).toHaveLength(2);
    const html = render(permitted, { ...product, stockByStore: { [a]: 99, [b]: 2, [b.toUpperCase()]: 3 } });
    expect(html).toContain("Other sources for Racket: 1, total 5 pcs");
    expect(html).not.toContain("total 104");
  });

  it("does not offer inactive or unauthorized stock as another source", () => {
    expect(render([store(a), store(b, false)])).toContain("No available sources");
  });

  it("shows only positive stock in the selected cluster, including permitted warehouses", () => {
    const directory = [store(a), { ...store(b), locationType: "central_warehouse" as const },
      { ...store(c), groupId: "other-cluster" }, store("empty"), store("negative"), store("inactive", false)];
    const item = { ...product, stockByStore: { ...product.stockByStore, empty: 0, negative: -3, inactive: 8 } };
    const html = render(stockDisplayLocations(directory, { currentStoreId: a, canSwitchStores: true }), item);
    expect(html).toContain("Other sources for Racket: 1, total 4 pcs");
    expect(html).toContain(b);
    expect(html).not.toContain(c);
    expect(html).not.toContain("987");
    expect(html).not.toContain("negative");
    expect(html).not.toContain("inactive");
    expect(html).not.toContain("empty");
  });

  it("does not treat zero/negative or ungrouped foreign branches as available sources", () => {
    expect(render(stores, { ...product, stockByStore: { [b]: 0 } })).toContain("No available sources");
    expect(render(stores, { ...product, stockByStore: { [b]: -2 } })).not.toContain("Total Available");
    expect(render([ { ...store(a), groupId: undefined }, { ...store(b), groupId: undefined } ])).toContain("No available sources");
  });

  it("preserves shared cluster products and authoritative archive/checkout inputs", () => {
    const before = JSON.stringify(product);
    const permitted = stockDisplayLocations(stores, { currentStoreId: a, terminalStoreId: a, canSwitchStores: true });
    render(permitted);
    expect(createCatalogueVisibility(defaultSettings, stores)(product, b)).toBe(true);
    expect(applyZeroStockLifecycle(product, true).archived).not.toBe(true);
    expect(JSON.stringify(product)).toBe(before);
    expect(product.stockByStore).toEqual({ [a]: 0, [b]: 4, [c]: 987 });
  });

  it("wires both inventory views to the same policy without changing catalogue/export scope", () => {
    const inventory = readFileSync("src/routes/inventory.tsx", "utf8");
    const shops = readFileSync("src/routes/all-shops.tsx", "utf8");
    expect(inventory).toContain("stores={stockStores.filter(store => catalogueVisible(p, store.id))}");
    expect(shops).toContain("stockDisplayLocations(companyStoreScope(");
    expect(shops).toContain("new Set(stockDisplayLocations(stores,");
    expect(inventory).toContain("<TableHead className=\"min-w-24 text-center\">Other stores</TableHead>");
  });
});
