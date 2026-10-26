import { describe, expect, it } from "vitest";
import { branchReceiptHistory, receiptMatchesShift } from "../receipt-history";
import type { Sale } from "@/core/types/pos-types";

describe("local and online receipt history", () => {
  const branch = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
  const shift = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
  const sale = { id: "sale-1", storeId: branch.toUpperCase(), shiftId: shift.toUpperCase() } as Sale;
  it("matches SQL Server and online UUID casing without leaking another branch's older results", () => {
    const foreign = { ...sale, id: "other-sale", storeId: "other-branch" };
    expect(branchReceiptHistory([sale], [foreign], branch)).toEqual([sale]);
    expect(branchReceiptHistory([], [sale], "other-branch")).toEqual([]);
  });
  it("shows branch history when no shift is open and restricts an active shift correctly", () => {
    expect(receiptMatchesShift(sale, null)).toBe(true);
    expect(receiptMatchesShift(sale, shift)).toBe(true);
    expect(receiptMatchesShift(sale, "other-shift")).toBe(false);
  });
});
