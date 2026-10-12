import { describe, expect, it } from "vitest";
import { saleReceiptPreview } from "../pos-print";
import type { Sale } from "@/core/types/pos-types";
describe("exchange receipt clarity", () => {
  it("shows both bill numbers above totals and separates only exchanged items from replacements", () => {
    const sale = { receiptNo: "NEW-003", exchangeOfReceiptNo: "OLD-014", createdAt: "2026-10-12T11:00:00Z", cashier: "Admin", method: "cash", subtotal: 0, discount: 0, tax: 0, total: 0, paid: 0, change: 0, exchangeCredit: 10, pointsEarned: 0,
      lines: [{ name: "Replacement racket", qty: 1, price: 10, discount: 0 }, { name: "Returned grip", qty: -1, price: 10, discount: 0, credit: true }] } as Sale;
    const html = saleReceiptPreview(sale, null, "sale");
    expect(html).toContain("EXCHANGE RECEIPT");
    expect(html).toContain("Original receipt");
    expect(html.indexOf("OLD-014")).toBeLessThan(html.indexOf("ITEMS RETURNED FOR EXCHANGE"));
    expect(html.indexOf("Returned grip")).toBeLessThan(html.indexOf("REPLACEMENT ITEMS"));
    expect(html.indexOf("REPLACEMENT ITEMS")).toBeLessThan(html.indexOf("Replacement racket"));
    expect(html).not.toContain("Store Credit from Bill");
    expect(html).not.toContain("-1 x");
  });
});
