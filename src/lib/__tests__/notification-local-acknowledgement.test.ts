import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
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
});
