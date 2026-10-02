/**
 * Branch isolation, checked at the edges.
 *
 * These tests prove the app never asks the central database to hand over
 * another branch's records, and that the private-catalogue rule now travels
 * on the product record itself — which is what the database enforces on.
 */
import { describe, expect, it } from "vitest";
import { productVisibleAt } from "@/lib/branch-policy";
import {
  applyScopedProductPrices,
  productToRow,
  rowToProduct,
  rowToStore,
  storeToRow,
} from "@/core/api/pos-db";
import { defaultSettings } from "@/lib/pos-seed";
import type { AppSettings, Product, Store } from "@/core/types/pos-types";

const settings = (branches: AppSettings["integrations"]["branches"]): AppSettings => ({
  ...defaultSettings,
  integrations: { ...defaultSettings.integrations, branches },
});

const privateBranch = settings({
  "branch-a": {
    privateStock: true,
    privateCatalogue: true,
    allowTransfers: true,
    syncInventory: true,
    syncOther: true,
  },
});

const product = (over: Partial<Product> = {}): Product => ({
  id: "p1",
  name: "Racket",
  sku: "R1",
  barcode: "R1",
  category: "",
  price: 100,
  cost: 50,
  stockByStore: {},
  reorderLevel: 0,
  taxRate: 0,
  packs: [],
  barcodes: [],
  variants: [],
  ...over,
});

describe("private catalogue", () => {
  it("hides an item owned by a private branch from every other branch", () => {
    const owned = product({ ownerStoreId: "branch-a" });
    expect(productVisibleAt(privateBranch, owned, "branch-a")).toBe(true);
    expect(productVisibleAt(privateBranch, owned, "branch-b")).toBe(false);
  });

  it("keeps unowned items shared with everyone", () => {
    expect(productVisibleAt(privateBranch, product(), "branch-b")).toBe(true);
    expect(productVisibleAt(privateBranch, product({ ownerStoreId: null }), "branch-b")).toBe(true);
  });

  it("still honours records saved before the owner column existed", () => {
    const legacy = settings(privateBranch.integrations.branches);
    legacy.integrations.productOwners = { p1: "branch-a" };
    expect(productVisibleAt(legacy, "p1", "branch-b")).toBe(false);
    expect(productVisibleAt(legacy, product(), "branch-b")).toBe(false);
  });

  it("shows items of a branch that does not keep a private catalogue", () => {
    const open = settings({
      "branch-a": {
        privateStock: false,
        privateCatalogue: false,
        allowTransfers: true,
        syncInventory: true,
        syncOther: true,
      },
    });
    expect(productVisibleAt(open, product({ ownerStoreId: "branch-a" }), "branch-b")).toBe(true);
  });
});

describe("the owner survives a round trip through the database", () => {
  it("writes and reads the owning branch", () => {
    const row = productToRow(product({ ownerStoreId: "branch-a" }));
    expect(row.owner_store_id).toBe("branch-a");
    expect(rowToProduct({ ...row, selling_price: 100, cost_price: 50 }).ownerStoreId).toBe(
      "branch-a",
    );
  });

  it("leaves a shared item unowned rather than blank", () => {
    expect(productToRow(product()).owner_store_id).toBeNull();
    expect(rowToProduct({ id: "p1", name: "x" }).ownerStoreId).toBeNull();
  });

  it("persists barcode variation cost and selling price inside the product JSON", () => {
    const row = productToRow(
      product({ variants: [{ code: "BLUE-1", label: "Blue", cost: 7.5, price: 12.9 }] }),
    );
    expect(row.barcode_variants).toEqual([
      { code: "BLUE-1", label: "Blue", cost: 7.5, price: 12.9 },
    ]);
    expect(rowToProduct({ ...row, selling_price: 10, cost_price: 5 }).variants).toEqual([
      { code: "BLUE-1", label: "Blue", cost: 7.5, price: 12.9 },
    ]);
  });

  it("carries the branch privacy switch on the branch record", () => {
    const branch: Store = {
      id: "branch-a",
      code: "A",
      name: "Branch A",
      address: "",
      phone: "",
      privateCatalogue: true,
    } as Store;
    const row = storeToRow(branch);
    expect(row.private_catalogue).toBe(true);
    expect(rowToStore(row).privateCatalogue).toBe(true);
    expect(storeToRow({ ...branch, privateCatalogue: false }).private_catalogue).toBe(false);
  });
});

describe("scoped product prices", () => {
  it("uses the most specific applicable price without changing the global product", () => {
    const base = product({ price: 100, ecomPrice: 105 });
    const priced = applyScopedProductPrices(
      [base],
      [
        { scope: "GLOBAL", scope_id: "", key: "product_price:p1", value: { selling_price: 99 } },
        {
          scope: "BRANCH",
          scope_id: "branch-a",
          key: "product_price:p1",
          value: { selling_price: 95 },
        },
        {
          scope: "TERMINAL",
          scope_id: "terminal-a",
          key: "product_price:p1",
          value: { selling_price: 92 },
        },
        {
          scope: "BRANCH",
          scope_id: "branch-b",
          key: "product_price:p1",
          value: { selling_price: 1 },
        },
      ],
      { branchId: "branch-a", terminalId: "terminal-a" },
    );
    expect(priced[0].price).toBe(92);
    expect(base.price).toBe(100);
  });
});
