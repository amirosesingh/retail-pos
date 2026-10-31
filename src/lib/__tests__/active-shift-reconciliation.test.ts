import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Shift } from "@/core/types/pos-types";
import { branchReadApplies, reconcileActiveShiftRows } from "../branch-shift-state";

const branchA = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const branchB = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const id = "cccccccc-cccc-4ccc-cccc-cccccccccccc";
const shift = (patch: Partial<Shift> = {}): Shift => ({
  id, storeId: branchA, cashier: "Cashier", openedAt: "2026-10-30T01:00:00Z",
  openingFloat: 50, countedCash: null, closedAt: null, status: "OPEN", note: "", ...patch,
});

describe("authoritative active-shift reconciliation", () => {
  it("ends the cached trading shift only when its own answered row is closed", () => {
    const cached = shift();
    const closed = shift({ status: "CLOSED", closedAt: "2026-10-30T12:00:00Z", countedCash: 150 });
    expect(reconcileActiveShiftRows(cached, [closed], branchA)).toBeNull();
    expect(cached).toMatchObject({ status: "OPEN", closedAt: null, openingFloat: 50 });
  });

  it("accepts either authoritative CLOSED flag or closed timestamp and canonical SQL UUID casing", () => {
    expect(reconcileActiveShiftRows(shift(), [shift({ id: id.toUpperCase(), storeId: branchA.toUpperCase(), status: "CLOSED" })], branchA)).toBeNull();
    expect(reconcileActiveShiftRows(shift(), [shift({ closedAt: "2026-10-30T12:00:00Z" })], branchA)).toBeNull();
  });

  it("retains an open shift on an empty, unrelated or other-branch response", () => {
    const cached = shift();
    for (const rows of [[], [shift({ id: "different", status: "CLOSED" })], [shift({ storeId: branchB, status: "CLOSED" })]])
      expect(reconcileActiveShiftRows(cached, rows, branchA)).toBe(cached);
  });

  it("updates the same answered open row without adopting a different branch", () => {
    const current = shift({ state: "CASH_COUNT_REQUIRED" });
    expect(reconcileActiveShiftRows(shift(), [current], branchA)).toBe(current);
    expect(reconcileActiveShiftRows(null, [shift({ storeId: branchB })], branchA)).toBeNull();
  });

  it("selects the latest open shift in the branch after the previous shift is explicitly closed", () => {
    const next = shift({ id: "next", openedAt: "2026-10-30T13:00:00Z" });
    const older = shift({ id: "older", openedAt: "2026-10-29T01:00:00Z" });
    const foreign = shift({ id: "foreign", storeId: branchB, openedAt: "2026-10-30T14:00:00Z" });
    expect(reconcileActiveShiftRows(shift(), [shift({ status: "CLOSED" }), older, foreign, next], branchA)).toBe(next);
    expect(reconcileActiveShiftRows(null, [older, foreign, next], branchA)).toBe(next);
  });

  it("does not replace a still-open shift merely because a separate open row changed", () => {
    const cached = shift();
    expect(reconcileActiveShiftRows(cached, [shift({ id: "other", openedAt: "2026-10-30T13:00:00Z" })], branchA)).toBe(cached);
  });

  it("rejects a delayed branch A close after management switches A to B to A", async () => {
    let current = shift();
    let sequence = 1;
    const requested = sequence;
    let complete!: (rows: Shift[]) => void;
    const response = new Promise<Shift[]>(resolve => { complete = resolve; });
    const apply = response.then(rows => {
      if (branchReadApplies(branchA, branchA, requested, sequence))
        current = reconcileActiveShiftRows(current, rows, branchA)!;
    });
    sequence += 2;
    complete([shift({ status: "CLOSED" })]);
    await apply;
    expect(current.status).toBe("OPEN");
  });

  it("keeps a local trading shift when the isolated read rejects rather than synthesizing a closure", async () => {
    const current = shift();
    const read = Promise.reject(new Error("Central database did not answer"));
    await expect(read.then(rows => reconcileActiveShiftRows(current, rows, branchA))).rejects.toThrow("did not answer");
    expect(current.status).toBe("OPEN");
  });

  it("wires answered rows, lifecycle invalidation and snapshot closes into the real provider", () => {
    const source = readFileSync(new URL("../pos-store.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    expect(source).toContain("reconcileActiveShiftRows(previous, rows, branch)");
    expect(source).toContain("const rows = await loadShiftsByIds([cached.id])");
    expect(source).toContain("confirmed = rows.find(row => sameRecordId(row.id, cached.id) && sameBranchId(row.storeId, storeId))");
    expect(source).toContain("identity === shiftReadIdentity.current");
    expect(source).toContain("generation === bootstrapGeneration.current && mutation === shiftMutationSequence.current");
    expect(source).toContain("const changed = new Set(ids);\n        const mutation");
    expect(source.match(/shiftMutationSequence.current\+\+/g)).toHaveLength(3);
  });
});
