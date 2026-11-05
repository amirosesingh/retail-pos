import { afterEach, describe, expect, it } from "vitest";
import { qrSvg, saleReceiptPreview, bookingSlipPreview, jobTagPreview, setPreviewReceiptCfg } from "../pos-print";
import { receiptQrError } from "../receipt-qr";
import { defaultReceiptSettings } from "../pos-seed";
import type { Sale, Booking } from "@/core/types/pos-types";

afterEach(() => setPreviewReceiptCfg(defaultReceiptSettings, { enabled: false, rate: 0, mode: "exclusive" }));
describe("receipt QR and text sections", () => {
  it("keeps a four-module white border and does not crash receipt rendering on oversized QR data", () => {
    expect(receiptQrError("https://example.com/receipt")).toBeNull();
    expect(qrSvg("https://example.com/receipt", 96)).toContain('viewBox="-4 -4 ');
    expect(receiptQrError(" ")).toContain("Enter");
    expect(receiptQrError("x".repeat(10000))).toContain("too long");
    expect(qrSvg("x".repeat(10000), 96)).toContain("QR unavailable");
  });
  it("prints multiline notes in the selected sale-body sections without changing the financial values", () => {
    setPreviewReceiptCfg({ ...defaultReceiptSettings, customLines: [
      { id: "1", placement: "before-items", text: "Before products\nSecond note" },
      { id: "2", placement: "before-totals", text: "Before totals" },
      { id: "3", placement: "after-totals", text: "After totals" },
    ] }, { enabled: false, rate: 0, mode: "exclusive" });
    const sale: Sale = { id: "preview", storeId: "s1", shiftId: "preview", memberId: null, receiptNo: "TEST-001", createdAt: "2026-10-26T00:00:00Z", cashier: "Preview", method: "cash", subtotal: 12.5, discount: 0, tax: 0, total: 12.5, paid: 12.5, change: 0, pointsEarned: 0, lines: [{ productId: "p1", name: "Sample product", price: 12.5, qty: 1, discount: 0, taxRate: 0 }] };
    const html = saleReceiptPreview(sale, null, "sale");
    expect(html.indexOf("Before products")).toBeLessThan(html.indexOf("Sample product"));
    expect(html).toContain('Before products</div><div class="c muted">Second note');
    expect(html.indexOf("Sample product")).toBeLessThan(html.indexOf("Before totals"));
    expect(html.indexOf("Before totals")).toBeLessThan(html.indexOf(">TOTAL<"));
    expect(html.indexOf("After totals")).toBeGreaterThan(html.indexOf(">TOTAL<"));
    expect(sale.total).toBe(12.5);
    expect(html).toContain("12.50");
  });
});


describe("document-specific printed fields", () => {
  const booking: Booking = { id: "b1", ref: "BK-TEST-001", storeId: "s1", shiftId: "s1", lines: [{ productId: "p1", name: "Test string", price: 25, qty: 1, discount: 0, taxRate: 0 }], subtotal: 25, discount: 0, tax: 0, total: 25, paid: 5, payments: [], dueDate: "2026-11-01", memberId: null, customerName: "CUSTOMER_SENTINEL", customerPhone: "PHONE_SENTINEL", note: "NOTE_SENTINEL", cashier: "Preview", createdAt: "2026-10-26T00:00:00Z", status: "active" };
  it("hides only the selected normal-booking fields while retaining totals and other document defaults", () => {
    setPreviewReceiptCfg({ ...defaultReceiptSettings, documentLayouts: { booking: { showPhone: false, showNotes: false } } }, { enabled: false, rate: 0, mode: "exclusive" });
    const html = bookingSlipPreview(booking, null, null);
    expect(html).not.toContain("PHONE_SENTINEL");
    expect(html).not.toContain("NOTE_SENTINEL");
    expect(html).toContain("CUSTOMER_SENTINEL");
    expect(html).toContain("BALANCE DUE");
    expect(html).toContain("20.00");
    expect(bookingSlipPreview({ ...booking, job: { racketModel: "MODEL_SENTINEL" } }, null, null)).toContain("PHONE_SENTINEL");
  });
  it("applies staff tag fields independently from the customer racket slip", () => {
    setPreviewReceiptCfg({ ...defaultReceiptSettings, documentLayouts: { "racket-staff": { showRacket: false, showPhone: false } } }, { enabled: false, rate: 0, mode: "exclusive" });
    const job = { ...booking, job: { racketModel: "MODEL_SENTINEL" } };
    expect(jobTagPreview(job)).not.toContain("MODEL_SENTINEL");
    expect(jobTagPreview(job)).not.toContain("PHONE_SENTINEL");
    expect(bookingSlipPreview(job, null, null)).toContain("MODEL_SENTINEL");
  });
});
