import { afterEach, expect, it } from "vitest";
import { saleReceiptPreview, setPreviewReceiptCfg } from "../pos-print";
import { defaultReceiptSettings } from "../pos-seed";
import type { Sale } from "@/core/types/pos-types";
const sale: Sale = { id: "preview", storeId: "a", shiftId: "", memberId: null,
  receiptNo: "MB-10000000-0000-4000-8000-000000000001", createdAt: "2026-01-01T10:00:00Z",
  cashier: "Original cashier", method: "cash", subtotal: 20, discount: 2, tax: 1.08,
  total: 19.08, paid: 19.08, change: 0, pointsEarned: 0, lines: [],
};
afterEach(() => setPreviewReceiptCfg(defaultReceiptSettings, { enabled: false, rate: 0, mode: "exclusive" }));
it("prints stored historical tax even when today's tax is off, without today's rate", () => {
  setPreviewReceiptCfg({ ...defaultReceiptSettings, showTax: true }, { enabled: false, rate: 99, mode: "inclusive" });
  const html = saleReceiptPreview(sale, null, "sale");
  expect(html).toContain("Historical sale");
  expect(html).toContain("payment already received");
  expect(html).toContain("Tax (original bill)");
  expect(html).toContain("1.08");
  expect(html).not.toContain("Tax 99%");
  expect(saleReceiptPreview({ ...sale, receiptNo: "STR1-001" }, null, "sale")).not.toContain("Tax (original bill)");
});
