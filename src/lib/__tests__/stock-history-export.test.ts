import { describe, expect, it, vi } from "vitest";
import { stockHistoryForExport } from "../stock-history-export";
import type { StockHistoryPage } from "../stock-history-report";
const a = "20000000-0000-4000-8000-000000000001", b = "20000000-0000-4000-8000-000000000002";
const request = { branchId: "branch", cutoff: "2026-11-06T00:00:00.0000001Z", timeZone: "Asia/Brunei", sourceRevision: "source-1" };
const page = (id = a): StockHistoryPage => ({ status: "complete", reasons: [], cutoff: request.cutoff, timeZone: request.timeZone,
  branchId: "branch", baselineAt: "2026-11-05T00:00:00.0000000Z", readAt: "2026-11-06T00:01:00.0000000Z",
  sourceRevision: "source-1", pendingCount: "0", restatable: true, rows: [{ productId: id, locationId: "branch", name: "鞋", sku: "0001",
    barcode: "0000001", quantity: "9007199254740993", negative: false }], next: null });
describe("stock report export admission and consistency", () => {
  it("rechecks export permission on every page and preserves exact quantities and the displayed revision", async () => {
    const load = vi.fn().mockResolvedValueOnce({ ...page(), next: a }).mockResolvedValueOnce(page(b));
    const result = await stockHistoryForExport(request, load);
    expect(result.rows.map(row => row.productId)).toEqual([a,b]);
    expect(result.rows[0].quantity).toBe("9007199254740993");
    expect(load.mock.calls.map(([input]) => [input.export,input.after,input.sourceRevision])).toEqual([[true,null,"source-1"],[true,a,"source-1"]]);
  });
  it.each(["revision", "cutoff", "branch", "duplicate", "incomplete", "permission"])("produces no partial export on %s failure", async change => {
    let second: StockHistoryPage = page(b);
    if (change === "revision") second = { ...second, sourceRevision: "source-2" };
    if (change === "cutoff") second = { ...second, cutoff: "2026-11-06T00:00:00.0000002Z" };
    if (change === "branch") second = { ...second, branchId: "foreign" };
    if (change === "duplicate") second = page();
    if (change === "incomplete") second = { ...second, status: "incomplete", reasons: ["PENDING_UPLOADS"], rows: [] };
    const load = vi.fn().mockResolvedValueOnce({ ...page(), next: a });
    if (change === "permission") load.mockRejectedValueOnce(new Error("Permission revoked")); else load.mockResolvedValueOnce(second);
    await expect(stockHistoryForExport(request, load)).rejects.toThrow();
  });
  it("stops after session/profile handover before publishing a downloaded page", async () => {
    let active = true;
    const load = vi.fn(async () => { active = false; return page(); });
    await expect(stockHistoryForExport(request, load, () => { if (!active) throw Error("Session changed"); })).rejects.toThrow("Session changed");
  });
});
