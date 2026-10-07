import { afterEach, describe, expect, it, vi } from "vitest";
import * as mode from "@/core/local-db/db-mode";
import * as local from "@/core/local-db/local-db";
import * as query from "@/core/api/db-query";

afterEach(() => vi.restoreAllMocks());

describe("Electron receiving reads", () => {
  it("shows a locally committed draft and its lines without a cloud read", async () => {
    vi.spyOn(mode, "effectiveDatabaseMode").mockReturnValue("local");
    vi.spyOn(local, "localDb").mockReturnValue({ query: vi.fn() } as never);
    const routed = vi.spyOn(query, "routedQuery").mockImplementation(async (table, options) => {
      if (table === "purchase_orders") {
        expect(options?.match).toEqual({ status: "draft" });
        return [{ id: "order-1", store_id: "B1", status: "draft", po_number: "PO-1",
          invoice_entry_date: "2026-10-07T12:00:00Z" }];
      }
      if (table === "purchase_order_items") {
        expect(options?.in).toEqual({ column: "po_id", values: ["order-1"] });
        return [{ id: "line-1", po_id: "order-1", product_name: "Item", quantity_received: 2 }];
      }
      return [];
    });
    const { loadReceivingDrafts } = await import("../../core/api/pos-db");
    const drafts = await loadReceivingDrafts("B1");
    expect(drafts).toMatchObject([{ id: "order-1", status: "draft", lines: [{ id: "line-1", qty: 2 }] }]);
    expect(routed).toHaveBeenCalledTimes(2);
  });
});
