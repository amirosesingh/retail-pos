import { describe, expect, it } from "vitest";
import { rowToSale } from "@/core/api/pos-db";
import { sameRecordId, uniqueSales } from "@/lib/sale-identity";
import type { Sale } from "@/core/types/pos-types";

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
  it("does not hide distinct records that share a bill number", () => {
    expect(uniqueSales([{id, receiptNo:"same"}, {id:"different", receiptNo:"same"}] as Sale[])).toHaveLength(2);
  });
});
