import { afterEach, describe, expect, it } from "vitest";
import { saleReceiptPreview, bookingSlipPreview, jobTagPreview, setPreviewReceiptCfg } from "../pos-print";
import { defaultReceiptSettings, defaultSettings } from "../pos-seed";
import { safeSectionFont } from "../receipt-sections";
import { settingsPatchRow } from "@/core/api/pos-db";
import type { Sale, Booking, FontStyleSettings } from "@/core/types/pos-types";
const tax = { enabled: false, rate: 0, mode: "exclusive" as const };
const sale: Sale = { id: "s1", receiptNo: "TEST-001", storeId: "store", shiftId: "shift", memberId: null, createdAt: "2026-10-26T00:00:00Z", cashier: "Cashier", lines: [{ productId: "p1", name: "PRODUCT_SENTINEL", qty: 1, price: 25, discount: 0, taxRate: 0 }], subtotal: 25, discount: 5, tax: 0, total: 20, paid: 20, change: 0, pointsEarned: 0, method: "cash" };
const booking: Booking = { ...sale, ref: "BK-TEST", status: "active", paid: 5, payments: [], dueDate: "2026-11-01", note: "", customerName: "Customer", customerPhone: "", serviceFee: 8, serviceName: "SERVICE_SENTINEL", job: { racketModel: "MODEL_SENTINEL" } };
afterEach(() => setPreviewReceiptCfg(defaultReceiptSettings, tax));
describe("receipt section editing", () => {
  it("styles one block and prints added text after its anchor without changing transaction values", () => {
    setPreviewReceiptCfg({ ...defaultReceiptSettings, documentSections: { sale: { styles: { items: { heading: "MY PRODUCTS", font: { size: 18, family: "arial" } } }, extra: [{ id: "1", after: "items", heading: "Delivery", text: "Reference {{receipt_number}}\nHandle with care", enabled: true }] } } }, tax);
    const html = saleReceiptPreview(sale, null, "sale");
    expect(html).toContain('class="rsec-sale-items"');
    expect(html).toContain("font-size:18px!important");
    expect(html).not.toContain('class="rsec-sale-totals"');
    expect(html.indexOf("PRODUCT_SENTINEL")).toBeLessThan(html.indexOf("Reference TEST-001"));
    expect(html.indexOf("Handle with care")).toBeLessThan(html.indexOf(">TOTAL<"));
    expect(html).toContain("20.00");
    expect(sale.total).toBe(20);
  });
  it("keeps headings, added sections and fonts isolated by document", () => {
    setPreviewReceiptCfg({ ...defaultReceiptSettings, documentSections: { "racket-customer": { styles: { services: { heading: "Workshop fee", font: { size: 16 } }, terms: { heading: "My conditions" } }, extra: [{ id: "x", after: "terms", heading: "EXTRA_SENTINEL", text: "Thank you", enabled: true }] } } }, tax);
    const html = bookingSlipPreview(booking, null, null);
    expect(html).toContain("Workshop fee");
    expect(html).toContain("SERVICE_SENTINEL");
    expect(html).toContain("My conditions");
    expect(html).toContain("EXTRA_SENTINEL");
    expect(jobTagPreview(booking)).not.toContain("EXTRA_SENTINEL");
    expect(saleReceiptPreview(sale, null, "sale")).not.toContain("Workshop fee");
  });
  it("escapes user sections and headings and skips disabled additions", () => {
    setPreviewReceiptCfg({ ...defaultReceiptSettings, documentSections: { sale: { styles: { items: { heading: '<img src=x onerror="alert(1)">' } }, extra: [{ id: "1", after: "footer", text: "<script>bad()</script>", enabled: true }, { id: "2", after: "footer", text: "DISABLED_SENTINEL", enabled: false }] } } }, tax);
    const html = saleReceiptPreview(sale, null, "sale");
    expect(html).toContain("&lt;img");
    expect(html).toContain("&lt;script&gt;bad()");
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain("DISABLED_SENTINEL");
  });
  it("does not revive disabled terms and resolves staff tag fields from that booking", () => {
    setPreviewReceiptCfg({ ...defaultReceiptSettings, bookingSlip: { ...defaultReceiptSettings.bookingSlip, showTerms: false }, documentSections: { "racket-customer": { styles: { terms: { heading: "HIDDEN_TERMS", text: "HIDDEN_NOTE" } } }, "racket-staff": { extra: [{ id: "staff", after: "job", enabled: true, text: "Staff reference {{booking_ref}}" }] } } }, tax);
    const html = bookingSlipPreview(booking, null, null);
    expect(html).not.toContain("HIDDEN_TERMS");
    expect(html).not.toContain("HIDDEN_NOTE");
    saleReceiptPreview(sale, null, "sale");
    expect(jobTagPreview(booking)).toContain("Staff reference BK-TEST");
  });
  it("bounds section font values and rejects arbitrary font CSS", () => {
    const font = safeSectionFont({ size: 100000, spacing: -8, family: 'Arial; color:red' as FontStyleSettings["family"] }, defaultReceiptSettings.fonts.body);
    expect(font.size).toBe(40); expect(font.spacing).toBe(0); expect(font.family).toBe(defaultReceiptSettings.fonts.body.family);
  });
  it("writes section definitions to the existing receipt JSON without rewriting payment or font columns", () => {
    const sections = { booking: { styles: { services: { heading: "Services" } } } };
    const row = settingsPatchRow({ ...defaultSettings, receipt: { ...defaultSettings.receipt, documentSections: sections } }, { receipt: { documentSections: sections } });
    expect(row.receipt_design).toMatchObject({ documentSections: sections });
    expect(Object.keys(row).sort()).toEqual(["id", "receipt_design", "updated_at"].sort());
  });
});
