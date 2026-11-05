import { describe, expect, it } from "vitest";
import { BranchOperationGate } from "../branch-operation-gate";
describe("branch context during money operations", () => {
  it("rejects a stale record before payment and keeps the context until every operation finishes", () => {
    const gate = new BranchOperationGate();
    expect(() => gate.begin("A", "B")).toThrow("another branch");
    const first = gate.begin("A", "A"), second = gate.begin("A", "A");
    expect(() => gate.beginSwitch()).toThrow("payment");
    first(); first();
    expect(() => gate.beginSwitch()).toThrow("payment");
    second();
    const switched = gate.beginSwitch();
    expect(() => gate.begin("B", "B")).toThrow("changing");
    switched();
    expect(() => gate.begin("B", "B")()).not.toThrow();
  });
  it("releases a failed monetary operation and accepts SQL-equivalent UUIDs", async () => {
    const gate = new BranchOperationGate(), id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const release = gate.begin(id.toUpperCase(), id);
    try { await Promise.reject(new Error("database unavailable")); } catch { /* Caller reports the failure. */ } finally { release(); }
    expect(() => gate.beginSwitch()()).not.toThrow();
  });
});
