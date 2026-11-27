import { describe, expect, it } from "vitest";
import { stockActivityAtCutoff, type StockActivityRecord } from "@/lib/stock-activity-history";

const time = (value: string) => `2026-11-23T${value}.0000000Z`;
const record = (id: string, occurredAt: string, values: Partial<StockActivityRecord> = {}): StockActivityRecord => ({
  id,
  branchId: "branch-a",
  productId: "product-a",
  kind: "sale",
  reference: null,
  occurredAt,
  before: null,
  after: null,
  delta: null,
  ...values,
});
const scope = { branchId: "branch-a", productId: "product-a", throughCoverage: "all" as const };
const opening = record("opening", time("02:00:00"), { kind: "count", before: 0, after: 7, delta: 7 });
const sale = record("sale", time("03:00:00"), { reference: "B-123", delta: -1, before: 7, after: 6 });

describe("recorded activity around the stock cutoff", () => {
  it("carries the supported balance through quiet periods and shows the later sale independently", () => {
    const prior = stockActivityAtCutoff([sale, opening], { ...scope, cutoff: time("02:45:00"), nearestAfterLoaded: true });
    expect(prior.balance).toEqual({ quantity: 7, supportedAt: opening.occurredAt });
    expect(prior.movements.map(row => [row.id, row.position])).toEqual([["opening", "through-cutoff"], ["sale", "after-cutoff"]]);
    const subsequent = stockActivityAtCutoff([sale, opening], { ...scope, cutoff: time("03:15:00") });
    expect(subsequent.balance).toEqual({ quantity: 6, supportedAt: sale.occurredAt });
    expect(subsequent.movements.every(row => row.position === "through-cutoff")).toBe(true);
  });

  it("uses inclusive exact times without rounding sub-millisecond movements into the cutoff", () => {
    const before = { ...sale, occurredAt: "2026-11-23T11:00:00.0000001+08:00", before: null, after: null };
    const after = record("later", "2026-11-23T03:00:00.0000002Z", { delta: -1 });
    const actual = stockActivityAtCutoff([opening, after, before], { ...scope, cutoff: before.occurredAt });
    expect(actual.balance).toEqual({ quantity: 6, supportedAt: "2026-11-23T03:00:00.0000001Z" });
    expect(actual.movements.at(-1)).toMatchObject({ position: "after-cutoff", id: "later" });
  });

  it("keeps zero anchors and zero changes distinct from a missing change", () => {
    const empty = record("empty", time("02:00:00"), { kind: "count", before: 0, after: 0, delta: 0 });
    const unchanged = record("same", time("03:00:00"), { delta: 0 });
    const missing = record("missing", time("04:00:00"));
    expect(stockActivityAtCutoff([empty, unchanged, missing], { ...scope, cutoff: time("03:30:00") }).balance)
      .toEqual({ quantity: 0, supportedAt: unchanged.occurredAt });
    const incomplete = stockActivityAtCutoff([empty, unchanged, missing], { ...scope, cutoff: time("04:30:00") });
    expect(incomplete.balance).toBeNull();
    expect(incomplete.movements.at(-1)?.delta).toBeNull();
  });

  it("never calculates a quantity from deltas alone or from a future anchor", () => {
    const noAnchor = { ...sale, before: null, after: null };
    expect(stockActivityAtCutoff([noAnchor], { ...scope, cutoff: time("04:00:00") }).balance).toBeNull();
    const futureOnly = stockActivityAtCutoff([sale], { ...scope, cutoff: time("02:45:00"), nearestAfterLoaded: true });
    expect(futureOnly.balance).toBeNull();
    expect(futureOnly.movements).toHaveLength(1);
  });

  it("derives the post-movement quantity from a saved before amount and exact delta", () => {
    const onlyBefore = { ...sale, after: null };
    expect(stockActivityAtCutoff([onlyBefore], { ...scope, cutoff: time("03:00:00") }).balance)
      .toEqual({ quantity: 6, supportedAt: sale.occurredAt });
  });

  it("requires a contiguous newest history suffix with an anchor past the page boundary", () => {
    const cutoff = time("03:15:00");
    const noCoverage = stockActivityAtCutoff([opening, sale], { ...scope, cutoff, throughCoverage: undefined });
    expect(noCoverage.balance).toBeNull();
    expect(noCoverage.movements).toHaveLength(2);
    expect(stockActivityAtCutoff([opening, sale], { ...scope, cutoff, throughCoverage: { after: opening.occurredAt } }).balance)
      .toEqual({ quantity: 6, supportedAt: sale.occurredAt });
    expect(stockActivityAtCutoff([opening, sale], { ...scope, cutoff, throughCoverage: { after: sale.occurredAt } }).balance)
      .toBeNull();
  });

  it("ignores foreign activity and deduplicates a stable receipt line replay", () => {
    const repeated = { ...sale, occurredAt: "2026-11-23T11:00:00+08:00", productName: "An updated label" };
    const rows = [opening, sale, repeated, { ...sale, branchId: "branch-b", delta: 100 }, { ...sale, productId: "product-b", delta: 100 }];
    const result = stockActivityAtCutoff(rows, { ...scope, cutoff: time("03:15:00") });
    expect(result.movements.map(row => row.id)).toEqual(["opening", "sale"]);
    expect(result.balance?.quantity).toBe(6);
  });

  it("does not choose a disputed stable activity or use an ill-formed timestamp", () => {
    const cutoff = time("03:15:00");
    const duplicate = stockActivityAtCutoff([opening, sale, { ...sale, after: 5, delta: -2 }], { ...scope, cutoff });
    expect(duplicate.balance).toBeNull();
    expect(duplicate.movements.map(row => row.id)).toEqual(["opening"]);
    expect(stockActivityAtCutoff([opening, { ...sale, occurredAt: "2026-11-23 03:00:00" }], { ...scope, cutoff }).balance).toBeNull();
  });

  it("requires an unambiguous latest movement, even when tied activity has stable IDs", () => {
    const tied = record("tied", sale.occurredAt, { before: 6, delta: -1, after: 5 });
    const result = stockActivityAtCutoff([opening, sale, tied], { ...scope, cutoff: time("03:15:00") });
    expect(result.movements.map(row => row.id)).toEqual(["opening", "sale", "tied"]);
    expect(result.balance).toBeNull();
  });

  it("holds an inconsistent balance or an observed gap between movements", () => {
    const conflictingSale = { ...sale, before: 9, after: 8 };
    expect(stockActivityAtCutoff([opening, { ...sale, after: 5 }], { ...scope, cutoff: time("03:00:00") }).balance).toBeNull();
    expect(stockActivityAtCutoff([opening, conflictingSale], { ...scope, cutoff: time("03:15:00") }).balance).toBeNull();
    expect(stockActivityAtCutoff([opening, conflictingSale], { ...scope, cutoff: time("02:45:00"), nearestAfterLoaded: true }).balance).toBeNull();
    expect(stockActivityAtCutoff([opening, conflictingSale], { ...scope, cutoff: opening.occurredAt, nearestAfterLoaded: true }).balance)
      .toEqual({ quantity: 7, supportedAt: opening.occurredAt });
  });

  it("withholds unsafe quantity arithmetic instead of rounding a balance", () => {
    const huge = { ...opening, before: null, delta: null, after: Number.MAX_SAFE_INTEGER };
    const next = { ...sale, before: null, after: null, delta: 1 };
    expect(stockActivityAtCutoff([huge, next], { ...scope, cutoff: time("03:00:00") }).balance).toBeNull();
  });
});
