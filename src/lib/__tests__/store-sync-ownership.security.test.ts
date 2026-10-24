import { describe, expect, it } from "vitest";
import { assertStoreSyncScope } from "../store-sync-scope.server";
describe("terminal stores synchronization scope", () => {
  it("allows the terminal's own store and ignores shared non-store table scope", () => {
    expect(() => assertStoreSyncScope("A", [
      { table: "stores", rows: [{ id: "A", name: "Shop" }], changes: [] },
      { table: "products", rows: [{ id: "shared-product" }], changes: [] },
    ])).not.toThrow();
  });
  it("denies foreign or missing store IDs in rows", () => {
    for (const row of [{ id: "B" }, {}, { id: "" }])
      expect(() => assertStoreSyncScope("A", [{ table: "stores", rows: [row], changes: [] }])).toThrow("FORBIDDEN");
  });
  it.each([
    { operation: "DELETE", key: { id: "B" } },
    { operation: "D", entityId: '{"id":"B"}' },
    { operation: "delete", entity_id: '{"id":"B"}' },
    { operation: "D", entityId: "malformed" },
  ])("denies foreign deletions in every supported key encoding", change => {
    expect(() => assertStoreSyncScope("A", [{ table: "stores", rows: [], changes: [change] }])).toThrow("FORBIDDEN");
  });
  it.each([
    { operation: "DELETE", key: { id: "A" } },
    { operation: "D", entityId: '{"id":"A"}' },
    { operation: "delete", entity_id: '{"id":"A"}' },
  ])("preserves own-store deletions in supported encodings", change => {
    expect(() => assertStoreSyncScope("A", [{ table: "stores", rows: [], changes: [change] }])).not.toThrow();
  });
});
