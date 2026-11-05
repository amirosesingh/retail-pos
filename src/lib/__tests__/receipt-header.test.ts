import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeReceiptHeaderLayout } from "../receipt-header";
import { saleReceiptPreview, setPreviewReceiptCfg, setPrintStore } from "../pos-print";
import { defaultReceiptSettings } from "../pos-seed";
import type { Sale } from "@/core/types/pos-types";

const sale: Sale = { id: "preview", storeId: "s1", shiftId: "preview", memberId: null, receiptNo: "TEST-001", createdAt: "2026-10-26T00:00:00Z", cashier: "Preview", method: "cash", subtotal: 0, discount: 0, tax: 0, total: 0, paid: 0, change: 0, pointsEarned: 0, lines: [] };
afterEach(() => { setPrintStore(null); setPreviewReceiptCfg(defaultReceiptSettings, { enabled: false, rate: 0, mode: "exclusive" }); vi.unstubAllGlobals(); });

describe("receipt headings", () => {
  it("preserves existing company and store headings for older settings", () => {
    expect(normalizeReceiptHeaderLayout(undefined)).toEqual({ showCompany: true, showCluster: false, showStore: true, showStoreCode: true, clusterPosition: "below-company" });
  });
  it("prints only the selected cluster without adding a store label or company name", () => {
    vi.stubGlobal("window", { localStorage: { getItem: (key: string) => key === "pos.store.groups" ? JSON.stringify([{ id: "g1", name: "Cluster & Co" }]) : null } });
    setPrintStore({ id: "s1", code: "STORE-CODE", name: "Hidden store", groupId: "g1", address: "", phone: "" });
    setPreviewReceiptCfg({ ...defaultReceiptSettings, companyName: "Hidden company", showLogo: false, headerLayout: { showCompany: false, showCluster: true, showStore: false, showStoreCode: false, clusterPosition: "above-company" } }, { enabled: false, rate: 0, mode: "exclusive" });
    const html = saleReceiptPreview(sale, null, "sale");
    expect(html).toContain('class="c receipt-cluster">Cluster &amp; Co</div>');
    expect(html).not.toContain("Hidden company");
    expect(html).not.toContain("Hidden store");
    expect(html).not.toContain("STORE-CODE");
  });
  it.each(["above-company", "below-company", "after-store"] as const)("places the cluster at %s", clusterPosition => {
    vi.stubGlobal("window", { localStorage: { getItem: (key: string) => key === "pos.store.groups" ? JSON.stringify([{ id: "g1", name: "Cluster heading" }]) : null } });
    setPrintStore({ id: "s1", code: "S1", name: "Store heading", groupId: "g1", address: "", phone: "" });
    setPreviewReceiptCfg({ ...defaultReceiptSettings, companyName: "Company heading", showLogo: false, headerLayout: { showCompany: true, showCluster: true, showStore: true, showStoreCode: false, clusterPosition } }, { enabled: false, rate: 0, mode: "exclusive" });
    const html = saleReceiptPreview(sale, null, "sale");
    const cluster = html.indexOf(">Cluster heading<"), company = html.indexOf(">Company heading<"), store = html.indexOf(">Store heading<");
    expect(cluster).toBeGreaterThan(0);
    if (clusterPosition === "above-company") expect(cluster).toBeLessThan(company);
    else if (clusterPosition === "below-company") { expect(cluster).toBeGreaterThan(company); expect(cluster).toBeLessThan(store); }
    else expect(cluster).toBeGreaterThan(store);
    expect(html).not.toContain("Store heading (S1)");
  });
});
