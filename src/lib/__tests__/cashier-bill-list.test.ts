import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { Sale } from "@/core/types/pos-types";
vi.mock("@/lib/pos-store", () => ({ money: (n: number) => `$${n.toFixed(2)}` }));
vi.mock("@/platforms/web/components/pos/ReportReceiptLink", () => ({ ReportReceiptLink: ({ sale }: { sale: Sale }) => h("button", null, sale.receiptNo) }));
import { CashierBillList } from "@/platforms/web/components/pos/CashierBillList";
it("renders only the first page of a large cashier list, with individual bill totals", () => {
  const sales = Array.from({ length: 125 }, (_, i) => ({ id: String(i), receiptNo: `BILL-${i}`, cashier: "Cashier A", createdAt: "2026-10-20T10:00:00Z", subtotal: 100, discount: 20, total: 80 })) as Sale[];
  sales.push({ ...sales[0], id: "other", cashier: "Cashier B", receiptNo: "PRIVATE-OTHER" });
  const html = renderToStaticMarkup(h(CashierBillList, { sales, cashier: "Cashier A" }));
  expect((html.match(/BILL-/g) ?? []).length).toBe(10);
  expect(html).not.toContain("PRIVATE-OTHER");
  expect(html).toContain("125");
  expect(html).toContain("$100.00");
  expect(html).toContain("$20.00");
  expect(html).toContain("$80.00");
  expect(html).toContain("Search bill number");
});
it("explains an empty cashier bill list", () => {
  expect(renderToStaticMarkup(h(CashierBillList, { sales: [], cashier: "Cashier A" }))).toContain("No bills recorded for this cashier today.");
});
