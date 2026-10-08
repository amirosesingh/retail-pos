import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/core/api/pos-relay.server", () => ({
  hasServiceKey: () => true,
  verifyRelayCaller: async () => ({}),
  runRelayOp: vi.fn(),
  runRelayRead: vi.fn(),
  serviceRest: vi.fn(async () => Response.json({ ok: true })),
}));
vi.mock("@/core/api/relay-policy.server", () => ({
  resolveRelayScope: async () => ({
    kind: "terminal", storeId: "B1", terminalId: "T1", permissions: {},
  }),
}));

describe("purchase order sync recovery", () => {
  it("renders SQL Server invoice dates after Electron IPC without crashing", async () => {
    const { toRendererRow } = await import("../../../electron/sync/row-codec.cjs");
    const raw = {
      invoice_date: new Date("2026-10-08T00:00:00Z"),
      invoice_entry_date: new Date("2026-10-08T12:34:56Z"),
    };
    expect(() => renderToStaticMarkup(createElement("span", null, raw.invoice_date as never)))
      .toThrow("Objects are not valid as a React child");
    const row = toRendererRow({ columns: [
      { cloudColumn: "invoice_date", sqlServerColumn: "invoice_date", cloudType: "date" },
      { cloudColumn: "invoice_entry_date", sqlServerColumn: "invoice_entry_date", cloudType: "timestamp with time zone" },
    ] }, raw);
    expect(row).toEqual({ invoice_date: "2026-10-08", invoice_entry_date: "2026-10-08T12:34:56.000Z" });
    expect(renderToStaticMarkup(createElement("span", null, row.invoice_date)))
      .toBe("<span>2026-10-08</span>");
    expect(raw.invoice_date).toBeInstanceOf(Date);
  });

  it("keeps cloud date strings and null dates unchanged", async () => {
    const { toRendererRow } = await import("../../../electron/sync/row-codec.cjs");
    const row = { invoice_date: "2026-10-08", invoice_entry_date: null };
    expect(toRendererRow({ columns: Object.keys(row).map((name) => ({
      cloudColumn: name, sqlServerColumn: name, cloudType: "date",
    })) }, row)).toEqual(row);
  });

  it("normalizes SQL Server UUIDs without changing text identifiers", async () => {
    const { toCloudRow } = await import("../../../electron/sync/row-codec.cjs");
    const id = "A611A328-2217-4D77-944A-5F6A637D123B";
    const row = { id, po_id: id, product_id: null, store_id: "BRANCH-A", sku: "SKU-A" };
    const result = toCloudRow({ columns: [
      ...["id", "po_id", "product_id"].map((name) => ({
        sqlServerColumn: name, cloudColumn: name, cloudType: "uuid",
      })),
      ...["store_id", "sku"].map((name) => ({
        sqlServerColumn: name, cloudColumn: name, cloudType: "text",
      })),
    ] }, row);
    expect(result).toEqual({ ...row, id: id.toLowerCase(), po_id: id.toLowerCase() });
    expect(row.id).toBe(id);
  });

  it("reads an unowned legacy header for branch repair without permitting another branch", async () => {
    const table = {
      cloudTable: "purchase_orders", sqlServerTable: "purchase_orders", scope: "branch",
      columns: [
        { cloudColumn: "id", sqlServerColumn: "id", primaryKey: true },
        { cloudColumn: "store_id", sqlServerColumn: "store_id" },
      ],
    };
    const query = vi.fn(async (_sql: string) => ({ recordset: [{ id: "order", store_id: null }] }));
    const request = { input: vi.fn(() => request), query };
    const { ChangeReader } = await import("../../../electron/sync/change-reader.cjs");
    const reader = new ChangeReader({ pool: { request: () => request } }, { tables: [table] });
    await expect(reader.rows(table, [{ key: { id: "order" } }], { branchId: "B1" }))
      .resolves.toEqual([{ id: "order", store_id: null }]);
    expect(request.input).toHaveBeenCalledWith("branch", "B1");
    expect(request.input).toHaveBeenCalledWith("k0_0", "order");
    expect(query.mock.calls[0][0]).toContain(
      "(source.[store_id]=@branch OR NULLIF(source.[store_id],N'') IS NULL)",
    );
  });

  it("preserves delete phases through the hosted endpoint", async () => {
    const { serviceRest } = await import("@/core/api/pos-relay.server");
    const { handleSyncRequest } = await import("../sync-endpoint.server");
    const operations = [
      { table: "purchase_order_items", deletePhase: true, rows: [],
        changes: [{ operation: "delete", key: { id: "line" } }] },
      { table: "purchase_orders", deletePhase: false, rows: [{ id: "order", store_id: "B1" }],
        changes: [] },
    ];
    const response = await handleSyncRequest(new Request("https://pos.example/api/sync", {
      method: "POST", body: JSON.stringify({ sqlServerAggregate: {
        batchId: "00000000-0000-4000-8000-000000000001", organizationId: "default",
        branchId: "B1", operations,
      } }),
    }));
    expect(response.status).toBe(200);
    const call = vi.mocked(serviceRest).mock.calls.at(-1)!;
    expect(call[0]).toBe("rpc/pos_sync_push_aggregate");
    expect(JSON.parse(call[1]!.body as string).p_operations).toEqual(operations);
  });
});
