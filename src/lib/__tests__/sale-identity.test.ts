import { describe, expect, it } from "vitest";
import { rowToSale } from "@/core/api/pos-db";
import { sameRecordId, uniqueSales } from "@/lib/sale-identity";
import { paymentsLabel, type Sale } from "@/core/types/pos-types";

const id = "abcde123-4567-4890-abcd-0123456789ab";
describe("SQL and cloud receipt identity", () => {
  it("shows a local refresh and the optimistic sale only once", () => {
    const live = { id, receiptNo: "B1-WIN01-20261009-0001", total: 25 } as Sale;
    const local = { ...live, id: id.toUpperCase() };
    expect(uniqueSales([live, local])).toHaveLength(1);
    expect(uniqueSales([live, local]).reduce((sum, sale) => sum + sale.total, 0)).toBe(25);
  });
  it("matches an uppercase text shift reference to a cloud UUID", () => {
    expect(sameRecordId(id.toUpperCase(), id)).toBe(true);
    expect(sameRecordId("", "")).toBe(false);
    expect(sameRecordId(id, "another-shift")).toBe(false);
  });
  it("normalizes sale and shift identities on read", () => {
    const sale = rowToSale({ id: id.toUpperCase(), shift_id: id.toUpperCase(), bill_number: "B1-1" });
    expect(sale.id).toBe(id);
    expect(sale.shiftId).toBe(id);
  });
  it.each([false, true])("formats synced tenders when the payment array is serialized: %s", (serialized) => {
    const payments = [
      { id: "cash-tender", method: "cash", amount: "19.50" },
      { id: "card-tender", method: "card", amount: 5.25, bankName: "Test Bank", reference: "AB-123" },
    ];
    const sale = rowToSale({ id, payments: serialized ? JSON.stringify(payments) : payments });

    expect(paymentsLabel(sale.payments)).toBe("Cash 19.50 + Card (Test Bank) 5.25");
    expect(sale.payments).toEqual([{ ...payments[0], amount: 19.5 }, payments[1]]);
    expect(payments[0].amount).toBe("19.50");
  });
  it("formats cached decimal text and shows a missing amount separately from zero", () => {
    expect(paymentsLabel([{ method: "cash", amount: "0.00" }, { method: "card", amount: "" }]))
      .toBe("Cash 0.00 + Card —");
  });
  it("does not hide distinct records that share a bill number", () => {
    expect(uniqueSales([{id, receiptNo:"same"}, {id:"different", receiptNo:"same"}] as Sale[])).toHaveLength(2);
  });
});
