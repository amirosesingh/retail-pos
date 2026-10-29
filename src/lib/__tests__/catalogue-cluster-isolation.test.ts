import { describe, expect, it } from "vitest";
import { branchOwnsNewCatalogue, branchPolicy, createCatalogueVisibility } from "../branch-policy";
import { defaultSettings } from "../pos-seed";
import type { AppSettings, Product, Store, Transfer, TransferStatus } from "@/core/types/pos-types";
const settings = { ...defaultSettings, integrations: { ...defaultSettings.integrations, branches: {}, productOwners: {} } } as AppSettings;
const store = (id: string, groupId?: string, privateCatalogue = false): Store => ({ id, code: id, name: id, address: "", phone: "", groupId, privateCatalogue });
const stores = [store("shoes-a", "shoes", true), store("shoes-b", "shoes", true), store("clothes-a", "clothes", true), store("clothes-b", "clothes", true), store("other", "other", true)];
const product = (overrides: Partial<Product> = {}): Product => ({ id: "item", name: "Shoe", sku: "S1", barcode: "S1", category: "Shoes", cost: 10, price: 20, stockByStore: {}, reorderLevel: 1, taxRate: 0, ...overrides });
const transfer = (status: TransferStatus = "completed", overrides: Partial<Transfer> = {}): Transfer => ({ id: "transfer", ref: "TR-1", kind: "transfer", fromStoreId: "shoes-a", toStoreId: "clothes-a", status, items: [{ productId: "item", qty: 2, verifiedQty: 2 }], postedAt: "2026-10-26T10:00:00Z", note: "", createdBy: "User", createdAt: "2026-10-26T09:00:00Z", updatedAt: "2026-10-26T10:00:00Z", ...overrides });
describe("cluster catalogue isolation", () => {
  it("records provenance for new grouped/private catalogues and preserves ungrouped shared defaults", () => {
    expect(branchOwnsNewCatalogue(settings, "shoes-a", stores)).toBe(true);
    expect(branchOwnsNewCatalogue(settings, "a", [store("a", "group", false)])).toBe(true);
    expect(branchOwnsNewCatalogue(settings, "a", [store("a", undefined, true)])).toBe(true);
    expect(branchOwnsNewCatalogue(settings, "a", [store("a")])).toBe(false);
  });
  it("reads the central branch privacy switch even when the settings copy is missing or false", () => {
    expect(branchPolicy(settings, "shoes-a", stores).privateCatalogue).toBe(true);
    const visible = createCatalogueVisibility(settings, stores);
    expect(visible(product(), "clothes-a")).toBe(false);
  });
  it("shares owned products inside their cluster but not with a distinct catalogue", () => {
    const visible = createCatalogueVisibility(settings, stores);
    const owned = product({ ownerStoreId: "shoes-a" });
    expect(visible(owned, "shoes-a")).toBe(true);
    expect(visible(owned, "shoes-b")).toBe(true);
    expect(visible(owned, "clothes-a")).toBe(false);
    expect(visible(owned, "other")).toBe(false);
  });
  it("keeps distinct known clusters separate even when neither private switch is enabled", () => {
    const visible = createCatalogueVisibility(settings, stores.map(row => ({ ...row, privateCatalogue: false })));
    expect(visible(product({ ownerStoreId: "shoes-a" }), "clothes-a")).toBe(false);
    expect(visible(product(), "clothes-a")).toBe(false);
  });
  it("retains legacy unowned stock only where there is actual cluster stock evidence, not a zero bucket", () => {
    const visible = createCatalogueVisibility(settings, stores);
    const legacy = product({ stockByStore: { "shoes-a": 4, "clothes-a": 0, "clothes-b": 0 } });
    expect(visible(legacy, "shoes-a")).toBe(true);
    expect(visible(legacy, "shoes-b")).toBe(true);
    expect(visible(legacy, "clothes-a")).toBe(false);
    expect(visible(product({ stockByStore: { "shoes-a": 0, "clothes-a": 0 } }), "shoes-a")).toBe(false);
  });
  it("keeps an explicitly posted incoming transfer visible after destination stock reaches zero", () => {
    const visible = createCatalogueVisibility(settings, stores, [transfer()]);
    const owned = product({ ownerStoreId: "shoes-a", stockByStore: { "clothes-a": 0 } });
    expect(visible(owned, "clothes-a")).toBe(true);
    expect(visible(owned, "clothes-b")).toBe(true);
    expect(visible(owned, "other")).toBe(false);
  });
  it("uses compact trusted destinations when cashier cannot read transfer history", () => {
    const visible = createCatalogueVisibility(settings, stores, []);
    const transferred = product({ ownerStoreId: "shoes-a", stockByStore: { "clothes-a": 0 }, catalogueStoreIds: ["clothes-a"] });
    expect(visible(transferred, "clothes-a")).toBe(true);
    expect(visible(transferred, "clothes-b")).toBe(true);
    expect(visible(transferred, "other")).toBe(false);
  });
  it.each(["draft", "awaiting_approval", "approved", "dispatched", "received", "rejected", "cancelled"] as TransferStatus[])("does not expose a foreign catalogue for %s movement", status => {
    expect(createCatalogueVisibility(settings, stores, [transfer(status)])(product({ ownerStoreId: "shoes-a" }), "clothes-a")).toBe(false);
  });
  it("requires actual posted and verified incoming units rather than an arbitrary destination stock value", () => {
    const owned = product({ ownerStoreId: "shoes-a", stockByStore: { "clothes-a": 20 } });
    expect(createCatalogueVisibility(settings, stores)(owned, "clothes-a")).toBe(false);
    expect(createCatalogueVisibility(settings, stores, [transfer("completed", { postedAt: undefined })])(owned, "clothes-a")).toBe(false);
    expect(createCatalogueVisibility(settings, stores, [transfer("completed", { items: [{ productId: "item", qty: 2, verifiedQty: 0 }] })])(owned, "clothes-a")).toBe(false);
  });
  it("matches SQL Server UUID casing for posted product and destination identities", () => {
    const productId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
    const destination = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
    const directory = [...stores, store(destination, "clothes", true)];
    const posted = transfer("completed", { toStoreId: destination.toUpperCase(), items: [{ productId: productId.toUpperCase(), qty: 1, verifiedQty: 1 }] });
    expect(createCatalogueVisibility(settings, directory, [posted])(product({ id: productId, ownerStoreId: "shoes-a" }), destination)).toBe(true);
  });
  it("preserves the original nonprivate shared catalogue where there are no distinct clusters", () => {
    const visible = createCatalogueVisibility(settings, [store("a"), store("b")]);
    expect(visible(product(), "b")).toBe(true);
    expect(visible(product({ ownerStoreId: "a" }), "b")).toBe(true);
  });
  it("does not infer a shared catalogue from missing branch directory records", () => {
    const visible = createCatalogueVisibility(settings, [store("a"), store("b")]);
    expect(visible(product({ ownerStoreId: "missing" }), "b")).toBe(false);
    expect(visible(product(), "missing")).toBe(false);
  });
  it("honours legacy product owner mappings and canonical UUID policy keys", () => {
    const uuid = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
    const legacy = { ...settings, integrations: { ...settings.integrations, productOwners: { item: "shoes-a" }, branches: { [uuid.toUpperCase()]: { privateCatalogue: true, privateStock: false, allowTransfers: true, syncInventory: true, syncOther: true } } } } as AppSettings;
    expect(branchPolicy(legacy, uuid).privateCatalogue).toBe(true);
    expect(createCatalogueVisibility(legacy, stores)("item", "shoes-b")).toBe(true);
    expect(createCatalogueVisibility(legacy, stores)("item", "clothes-a")).toBe(false);
  });
});
