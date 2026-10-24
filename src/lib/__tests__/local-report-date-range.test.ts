import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { OperationsRepository } = require("../../../electron/db/repositories/operations.cjs");
function fixture() {
  const inputs: Record<string, unknown> = {};
  const query = vi.fn(async (_sql: string) => ({ recordset: [] }));
  const request = { input(name: string, value: unknown) { inputs[name] = value; return request; }, query };
  const registry = { tables: [{ cloudTable: "sales", sqlServerTable: "sales", scope: "branch", columns: [
    { cloudColumn: "id", sqlServerColumn: "id", primaryKey: true },
    { cloudColumn: "store_id", sqlServerColumn: "store_id" },
    { cloudColumn: "created_at", sqlServerColumn: "created_at" },
  ] }] };
  return { repository: new OperationsRepository({ pool: { request: () => request } }, registry), inputs, query };
}
describe("local SQL report date ranges", () => {
  it("filters in SQL using bound timestamps while retaining branch scope and pagination", async () => {
    const { repository, inputs, query } = fixture();
    await repository.query("branch-a", "sales", { dateRange: { column: "created_at", from: "2026-01-01T00:00:00Z", to: "2026-01-31T23:59:59Z" }, limit: 500 });
    expect(inputs).toMatchObject({ branch: "branch-a", limit: 500, rangeFrom: "2026-01-01T00:00:00.000Z", rangeTo: "2026-01-31T23:59:59.000Z" });
    expect(query.mock.calls[0][0]).toContain("source.[created_at]>=@rangeFrom AND source.[created_at]<=@rangeTo");
    expect(query.mock.calls[0][0]).toContain("@branch");
    expect(query.mock.calls[0][0]).not.toContain("2026-01-01");
  });
  it.each([
    { column: "created_at]; DROP TABLE sales;--", from: "2026-01-01", to: "2026-01-02" },
    { column: "created_at", from: "bad-date", to: "2026-01-02" },
    { column: "created_at", from: "2026-01-03", to: "2026-01-02" },
  ])("rejects unsupported columns or invalid ranges before querying", async dateRange => {
    const { repository, query } = fixture();
    await expect(repository.query("branch-a", "sales", { dateRange })).rejects.toMatchObject({ code: "EQUERY_RANGE" });
    expect(query).not.toHaveBeenCalled();
  });
});
