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

  it("does not hide older local drafts after the first page", async () => {
    vi.spyOn(mode, "effectiveDatabaseMode").mockReturnValue("local");
    vi.spyOn(local, "localDb").mockReturnValue({ query: vi.fn() } as never);
    const routed = vi.spyOn(query, "routedQuery").mockImplementation(async (table, options) => {
      if (table !== "purchase_orders") return [];
      const offset = options?.offset ?? 0;
      return Array.from({ length: offset === 0 ? 100 : 1 }, (_, index) => ({
        id: `order-${offset + index}`, store_id: "B1", status: "draft",
        invoice_entry_date: "2026-10-07T12:00:00Z",
      }));
    });
    const { loadReceivingDrafts } = await import("../../core/api/pos-db");
    const drafts = await loadReceivingDrafts("B1");
    expect(drafts).toHaveLength(101);
    expect(routed).toHaveBeenCalledWith("purchase_orders", expect.objectContaining({ offset: 100 }));
  });
});

describe("Electron stock count reads", () => {
  it("keeps old drafts visible beyond the recent posted-record cap", async () => {
    const routed = vi.spyOn(query, "routedQuery").mockImplementation(async (table, options) => {
      if (table !== "stock_count_drafts") return [];
      if (!options?.match?.status) return [{ id: "posted-1", status: "posted", created_at: "2026-10-07" }];
      const offset = options.offset ?? 0;
      return Array.from({ length: offset === 0 ? 200 : 1 }, (_, index) => ({
        id: `draft-${offset + index}`, status: "draft", store_id: "B1", created_at: "2026-10-06",
      }));
    });
    const { db } = await import("../../core/api/pos-db");
    const records = await db.listStockCountRecords({ storeId: "B1" });
    expect(records).toHaveLength(202);
    expect(records.some((row) => row.id === "draft-200")).toBe(true);
    expect(routed).toHaveBeenCalledWith("stock_count_drafts", expect.objectContaining({ offset: 200 }));
  });
});
