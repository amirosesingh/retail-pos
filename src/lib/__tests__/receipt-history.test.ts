import { describe, expect, it } from "vitest";
import { branchReceiptHistory, latestReceiptShift, receiptMatchesShift } from "../receipt-history";
import type { Sale, Shift } from "@/core/types/pos-types";

describe("local and online receipt history", () => {
  const branch = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
  const shift = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
  const sale = { id: "sale-1", storeId: branch.toUpperCase(), shiftId: shift.toUpperCase() } as Sale;
  it("matches SQL Server and online UUID casing without leaking another branch's older results", () => {
    const foreign = { ...sale, id: "other-sale", storeId: "other-branch" };
    expect(branchReceiptHistory([sale], [foreign], branch)).toEqual([sale]);
    expect(branchReceiptHistory([], [sale], "other-branch")).toEqual([]);
  });
  it("chooses the newest loaded shift of the selected branch, including a closed latest shift", () => {
    const old = { id: "old", storeId: branch, openedAt: "2026-10-25T10:00:00Z", closedAt: "2026-10-25T23:00:00Z" } as Shift;
    const latest = { ...old, id: "latest", storeId: branch.toUpperCase(), openedAt: "2026-10-26T10:00:00Z" };
    const other = { ...old, id: "foreign", storeId: "other-branch", openedAt: "2026-10-27T10:00:00Z" };
    expect(latestReceiptShift([latest, other, old], branch)).toBe(latest);
    expect(latestReceiptShift([old, other, latest], branch)).toBe(latest);
    expect(latestReceiptShift([other], branch)).toBeNull();
  });
  it("keeps newest receipts first and lets committed live rows replace stale page copies", () => {
    const old = { ...sale, total: 10, createdAt: "2026-10-25T10:00:00Z" };
    const live = { ...old, total: 12 };
    const latest = { ...sale, id: "sale-2", total: 20, createdAt: "2026-10-26T10:00:00Z" };
    expect(branchReceiptHistory([live, latest], [old], branch)).toEqual([latest, live]);
  });
  it("does not turn a missing shift into every branch receipt and restricts a selected shift correctly", () => {
    expect(receiptMatchesShift(sale, null)).toBe(false);
    expect(receiptMatchesShift(sale, shift)).toBe(true);
    expect(receiptMatchesShift(sale, "other-shift")).toBe(false);
  });
});
