import { describe, expect, it } from "vitest";
import type { Sale } from "@/core/types/pos-types";
import { dailyPaymentSummary } from "../daily-payment-summary";

const sale = (values: Partial<Sale>) =>
  ({ method: "cash", total: 20, paid: 20, change: 0, ...values }) as Sale;
describe("daily retained payment summary", () => {
  it("separates split tenders and excludes cash change and refunds", () => {
    expect(
      dailyPaymentSummary([
        sale({
          total: 25, change: 5,
          payments: [
            { id: "1", method: "cash", amount: 20 },
            { id: "2", method: "card", amount: 10 },
          ],
        }),
        sale({ method: "card", paid: 7 }),
        sale({ refunded: true, paid: 100 }),
      ]),
    ).toEqual([
      { method: "cash", amount: 15 },
      { method: "card", amount: 17 },
    ]);
  });
  it("only includes methods retaining a positive amount, including custom methods", () => {
    expect(
      dailyPaymentSummary([sale({ total: 0, paid: 5, change: 5 }), sale({ method: "wallet", paid: 3.25 })]),
    ).toEqual([{ method: "wallet", amount: 3.25 }]);
    expect(dailyPaymentSummary([])).toEqual([]);
  });
  it("does not deduct change twice when checkout already recorded retained cash", () => {
    expect(dailyPaymentSummary([sale({ total: 10, paid: 20, change: 10,
      payments: [{ id: "cash", method: "cash", amount: 10 }] })]))
      .toEqual([{ method: "cash", amount: 10 }]);
  });
});
