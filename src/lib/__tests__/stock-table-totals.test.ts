import { describe, expect, it } from "vitest";
import type { Product } from "@/core/types/pos-types";
import { transferTableTotals } from "@/lib/stock-table-totals";

describe("stock table totals", () => {
  it("omits monetary summaries unless cost visibility is explicitly allowed", () => {
    const products = new Map([["a", {cost: 123} as Product]]);
    expect(transferTableTotals([{productId:"a", qty:5}], products)).toEqual({Items:1, Requested:5, Approved:0, Sent:0, Counted:0});
  });
  it("keeps requested, approved, sent and counted quantities separate", () => {
    const products = new Map([["a", { cost: 4 } as Product], ["b", {cost: 10} as Product]]);
    expect(transferTableTotals([
      {productId:"a", qty:10, approvedQty:8, dispatchedQty:6, verifiedQty:5},
      {productId:"b", qty:3},
    ], products, true)).toEqual({ Items:2, Requested:13, Approved:8, Sent:6, Counted:5, "Requested estimate":70, "Sent estimate":24 });
  });
  it("flags missing prices instead of presenting an incomplete amount as fully priced", () => {
    expect(transferTableTotals([{productId:"unknown", qty:5}], new Map(), true)).toMatchObject({ Requested:5, "Unpriced lines":1 });
  });
});
