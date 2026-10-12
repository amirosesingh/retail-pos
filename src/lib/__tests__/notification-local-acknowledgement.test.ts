import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const { OperationsRepository } = require("../../../electron/db/repositories/operations.cjs");
const repository = new OperationsRepository({}, { tables: [{ sqlServerTable: "activity_events", cloudTable: "activity_events", updateRule: "append_only", columns: ["id", "cleared_by", "title"].map(sqlServerColumn => ({ sqlServerColumn })) }] });
const clear = { kind: "update", table: "activity_events", match: { id: "event-a" }, values: { cleared_by: JSON.stringify(["admin-a"]) }, requireMatch: true };
describe("local notification acknowledgement", () => {
  it("allows a required-match acknowledgement without editing the event", () => {
    expect(repository.validate([clear])).toEqual([clear]);
  });
  it("keeps event content and deletion immutable", () => {
    expect(() => repository.validate([{ ...clear, values: { title: "rewritten" } }])).toThrow("append-only");
    expect(() => repository.validate([{ ...clear, kind: "delete" }])).toThrow("append-only");
    expect(() => repository.validate([{ ...clear, requireMatch: false }])).toThrow("append-only");
  });
  it("refuses malformed or empty acknowledgements", () => {
    for (const cleared_by of ["broken", "[]", '[null]', '[""]']) {
      expect(() => repository.validate([{ ...clear, values: { cleared_by } }])).toThrow("acknowledgement");
    }
  });
  it("refuses a directed notification belonging to another operator", async () => {
    const query = vi.fn().mockResolvedValueOnce({ recordset: [{ id: "verified-a", user_id: "operator-a" }] })
      .mockResolvedValueOnce({ recordset: [{ store_id: "branch-a", event_type: "approval_requested", meta: JSON.stringify({ audience_user_ids: ["operator-b"] }) }] });
    class Request { input() { return this; } query(sql: string) { return query(sql); } }
    const guarded = new OperationsRepository({ sql: () => ({ Request }) }, { tables: [] });
    await expect(guarded.applyOperation({}, clear, { branchId: "branch-a", activityOperator: { subject: "operator-a", role: "admin", mayViewGeneralActivity: true } })).rejects.toThrow("Notification access denied");
    expect(query).toHaveBeenCalledTimes(2);
  });
  it("requires a main-process verified operator before any database write", async () => {
    const guarded = new OperationsRepository({}, { tables: [] });
    await expect(guarded.applyOperation({}, clear, { branchId: "branch-a" })).rejects.toThrow("verified notification operator");
  });
});
