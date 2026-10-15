import { describe, expect, it } from "vitest";
import { alignVerifiedScopeIds } from "../verified-scope-ids";
const branch = "A1234567-1234-4234-8234-123456789ABC";
const terminal = "B1234567-1234-7234-8234-123456789ABC";
const other = "C1234567-1234-4234-8234-123456789ABC";
describe("legacy UUID-shaped text branch keys", () => {
  it("resolves only same-UUID references to the server's verified branch and terminal", () => {
    const value = { branchId: branch.toLowerCase(), operations: [
      { table: "stock_movements", rows: [{ store_id: branch.toLowerCase(), product_id: other.toLowerCase() }] },
      { table: "settings_scoped", rows: [{ scope: "branch", scope_id: branch.toLowerCase() }, { scope: "terminal", scope_id: terminal.toLowerCase() }] },
    ] };
    const aligned = alignVerifiedScopeIds(value, { storeId: branch, terminalId: terminal });
    expect(aligned.branchId).toBe(branch);
    expect(aligned.operations[0].rows[0]).toEqual({ store_id: branch, product_id: other.toLowerCase() });
    expect(aligned.operations[1].rows).toEqual([{ scope: "branch", scope_id: branch }, { scope: "terminal", scope_id: terminal }]);
    expect(value.branchId).toBe(branch.toLowerCase());
  });
  it("preserves unrelated branches and differently cased human codes for rejection", () => {
    expect(alignVerifiedScopeIds({ branchId: other, store_id: other }, { storeId: branch }))
      .toEqual({ branchId: other, store_id: other });
    expect(alignVerifiedScopeIds({ branchId: "lc1", store_id: "LC2" }, { storeId: "LC1" }))
      .toEqual({ branchId: "lc1", store_id: "LC2" });
  });
  it("resolves serialized delete keys and legacy branch directory records", () => {
    expect(alignVerifiedScopeIds({ table: "settings_scoped", changes: [{ entity_id: JSON.stringify({ scope: "branch", scope_id: branch.toLowerCase(), key: "display" }) }] }, { storeId: branch }).changes[0].entity_id)
      .toBe(JSON.stringify({ scope: "branch", scope_id: branch, key: "display" }));
    expect(alignVerifiedScopeIds({ table: "stores", match: { id: branch.toLowerCase() }, values: { code: branch } }, { storeId: branch }))
      .toEqual({ table: "stores", match: { id: branch }, values: { code: branch } });
  });
});
