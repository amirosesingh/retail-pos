import { describe, expect, it } from "vitest";
import { calculateStockAsOf, stockCutoffAtShiftClose, stockInstant, type StockAsOfInput, type StockMovement } from "../stock-as-of";

const pair = { productId: "product-a", locationId: "branch-a" };
const input = (): StockAsOfInput => ({
  cutoff: "2026-11-05T08:00:00Z", timeZone: "Asia/Brunei", readAt: "2026-11-06T00:00:00Z", sourceRevision: "ledger-40",
  pairs: [pair], baseline: { at: "2026-11-05T00:00:00Z", capturedAt: "2026-11-05T00:00:00Z", rows: [{ ...pair, quantity: "10" }] },
  coverage: { status: "complete", from: "2026-11-05T00:00:00Z", through: "2026-11-06T00:00:00Z" }, movements: [],
});
const movement = (change: Partial<StockMovement> = {}): StockMovement => ({
  ...pair, movementId: "sale-1-item-1", quantityDelta: "-3", effectiveAt: "2026-11-05T06:00:00Z", recordedAt: "2026-11-05T06:00:01Z", ...change,
});

describe("stock quantity at an exact effective-time cutoff", () => {
  it("uses an opening plus committed deltas and ignores movements after the selected time", () => {
    const request = input(); request.movements = [movement(), movement({ movementId: "receive-1", quantityDelta: "5", effectiveAt: "2026-11-05T09:00:00Z", recordedAt: "2026-11-05T09:00:01Z" })];
    expect(calculateStockAsOf(request)).toMatchObject({ status: "complete", includedMovements: 1, rows: [{ ...pair, quantity: "7", negative: false }] });
  });
  it("restates past stock for late offline arrivals by effective time, preserving arrival separately", () => {
    const request = input(); request.movements = [movement({ recordedAt: "2026-11-05T20:00:00Z" })];
    const result = calculateStockAsOf(request);
    expect(result).toMatchObject({ status: "complete", lateMovements: 1, rows: [{ quantity: "7" }], restatable: true, sourceRevision: "ledger-40" });
    expect(request.movements[0]!.recordedAt).toBe("2026-11-05T20:00:00Z");
  });
  it("deduplicates exact replay and rejects changed evidence under the same movement ID", () => {
    const request = input(); request.movements = [movement(), movement()];
    expect(calculateStockAsOf(request)).toMatchObject({ includedMovements: 1, rows: [{ quantity: "7" }] });
    request.movements = [movement(), movement({ quantityDelta: "-4" })];
    expect(() => calculateStockAsOf(request)).toThrowError(expect.objectContaining({ code: "STOCK_HISTORY_MOVEMENT_CONFLICT" }));
  });
  it("preserves distinct warehouse quantities and each transfer leg exactly once", () => {
    const request = input(), second = { ...pair, locationId: "warehouse-a" };
    request.pairs = [pair, second]; request.baseline.rows = [{ ...pair, quantity: "10" }, { ...second, quantity: "0" }];
    request.movements = [movement({ movementId: "transfer-out", quantityDelta: "-2" }), movement({ ...second, movementId: "transfer-in", quantityDelta: "2" })];
    expect(calculateStockAsOf(request).rows).toEqual([{ ...pair, quantity: "8", negative: false }, { ...second, quantity: "2", negative: false }]);
  });
  it("does not count a transfer receipt or return before its actual effective time", () => {
    const request = input(); request.movements = [movement(), movement({ movementId: "return", quantityDelta: "1", effectiveAt: "2026-11-05T08:00:00.0000001Z", recordedAt: "2026-11-05T09:00:00Z" })];
    expect(calculateStockAsOf(request).rows[0]!.quantity).toBe("7");
    request.cutoff = "2026-11-05T08:00:00.0000001Z";
    expect(calculateStockAsOf(request).rows[0]!.quantity).toBe("8");
  });
  it("keeps signed quantities and large exact integers without rounding or hiding negatives", () => {
    const request = input(); request.baseline.rows = [{ ...pair, quantity: "9007199254740993" }]; request.movements = [movement({ quantityDelta: "-9007199254740994" })];
    expect(calculateStockAsOf(request).rows[0]).toMatchObject({ quantity: "-1", negative: true });
  });
  it("includes zero/archived historical products supplied by the authorized historical catalogue", () => {
    const request = input(); request.baseline.rows = [{ ...pair, quantity: "0" }];
    expect(calculateStockAsOf(request).rows).toEqual([{ ...pair, quantity: "0", negative: false }]);
  });
  it.each(["unknown", "incomplete"] as const)("does not invent balances for %s movement coverage", status => {
    const request = input(); request.coverage.status = status;
    expect(calculateStockAsOf(request)).toMatchObject({ status: "incomplete", reasons: ["INCOMPLETE_MOVEMENTS"], rows: [{ quantity: null, negative: null }] });
  });
  it("reports a missing opening, gaps and pre-baseline requests explicitly", () => {
    const request = input(); request.baseline.rows = [];
    expect(calculateStockAsOf(request)).toMatchObject({ status: "incomplete", reasons: ["MISSING_OPENING"], rows: [{ quantity: null }] });
    request.coverage.through = "2026-11-05T07:59:59Z";
    expect(calculateStockAsOf(request).reasons).toContain("COVERAGE_GAP");
    request.cutoff = "2026-11-04T23:59:59Z";
    expect(calculateStockAsOf(request).status).toBe("unsupported");
  });
  it("requires a rebase when a newly arriving pre-baseline movement could already be in the snapshot", () => {
    const request = input(); request.movements = [movement({ effectiveAt: "2026-11-04T22:00:00Z", recordedAt: "2026-11-05T20:00:00Z" })];
    expect(calculateStockAsOf(request)).toMatchObject({ status: "incomplete", reasons: ["BASELINE_PREHISTORY_CHANGED"], rows: [{ quantity: null }] });
  });
  it("does not double count pre-baseline movements already covered when the snapshot was captured", () => {
    const request = input(); request.movements = [movement({ effectiveAt: "2026-11-04T22:00:00Z", recordedAt: "2026-11-04T22:01:00Z" })];
    expect(calculateStockAsOf(request)).toMatchObject({ status: "complete", includedMovements: 0, rows: [{ quantity: "10" }] });
  });
  it("rejects evidence outside the selected product/location scope rather than silently aggregating it", () => {
    const request = input(); request.movements = [movement({ locationId: "other-cluster" })];
    expect(() => calculateStockAsOf(request)).toThrowError(expect.objectContaining({ code: "STOCK_HISTORY_SCOPE_FORBIDDEN" }));
  });
  it.each(["2.5", "NaN", "01", "1e3", "1".repeat(39)])("rejects malformed/unbounded unit counts %s", quantity => {
    const request = input(); request.baseline.rows = [{ ...pair, quantity }];
    expect(() => calculateStockAsOf(request)).toThrow();
  });
  it("rejects duplicate openings, duplicate scope entries, future evidence and invalid coverage", () => {
    let request = input(); request.baseline.rows = [...request.baseline.rows, ...request.baseline.rows]; expect(() => calculateStockAsOf(request)).toThrow();
    request = input(); request.pairs = [pair, pair]; expect(() => calculateStockAsOf(request)).toThrow();
    request = input(); request.movements = [movement({ recordedAt: "2027-01-01T00:00:00Z" })]; expect(() => calculateStockAsOf(request)).toThrow();
    request = input(); request.coverage.from = "2027-01-01T00:00:00Z"; expect(() => calculateStockAsOf(request)).toThrow();
  });
  it("returns unsupported for a future selected time and bounds all input arrays", () => {
    const request = input(); request.cutoff = "2027-01-01T00:00:00Z";
    expect(calculateStockAsOf(request).status).toBe("unsupported");
    request.movements = Array.from({ length: 100_001 }, () => movement());
    expect(() => calculateStockAsOf(request)).toThrowError(expect.objectContaining({ code: "STOCK_HISTORY_OVERSIZED" }));
  });
  it("produces order-independent results for separately identified movements at the same time", () => {
    const request = input(); request.movements = [movement(), movement({ movementId: "second", quantityDelta: "2" })];
    const before = calculateStockAsOf(request); request.movements = [...request.movements].reverse();
    expect(calculateStockAsOf(request)).toEqual(before);
  });
  it.each(["", "-"])("allows near-limit %s balance cancellation regardless of page order", sign => {
    const request = input(), maximum = sign + "9".repeat(38);
    request.baseline.rows = [{ ...pair, quantity: maximum }];
    request.movements = [movement({ movementId: "increase", quantityDelta: "1" }), movement({ movementId: "decrease", quantityDelta: "-1" })];
    const first = calculateStockAsOf(request);
    expect(first).toMatchObject({ status: "complete", includedMovements: 2, rows: [{ quantity: maximum, negative: sign === "-" }] });
    request.movements = [...request.movements].reverse();
    expect(calculateStockAsOf(request)).toEqual(first);
  });
  it.each(["", "-"])("still rejects a final %s balance beyond the 38-digit bound", sign => {
    const request = input(); request.baseline.rows = [{ ...pair, quantity: sign + "9".repeat(38) }];
    request.movements = [movement({ quantityDelta: sign + "1" })];
    expect(() => calculateStockAsOf(request)).toThrowError(expect.objectContaining({ code: "STOCK_HISTORY_OVERSIZED" }));
  });
});

describe("exact date/time and shift closing cutoff", () => {
  it("preserves original shift precision instead of rounding to a minute or millisecond", () => {
    const raw = "2026-11-05T13:10:10.4160001Z";
    expect(stockCutoffAtShiftClose({ storeId: pair.locationId, status: "CLOSED", closedAt: raw }, pair.locationId)).toBe(raw);
    expect(stockInstant(raw) - stockInstant("2026-11-05T13:10:10.4160000Z")).toBe(1n);
  });
  it("normalizes explicit offsets as instants but never guesses an ambiguous wall-clock time", () => {
    expect(stockInstant("2026-11-05T16:00:00+08:00")).toBe(stockInstant("2026-11-05T08:00:00Z"));
    expect(() => stockInstant("2026-11-01T01:30:00")).toThrow();
  });
  it.each(["2026-02-30T01:00:00Z", "2026-11-05T24:00:00Z", "2026-11-05T12:00:00+14:01", "2026-11-05T12:00:00.12345678Z"])("rejects invalid/truncated instant %s", raw => {
    expect(() => stockInstant(raw)).toThrow();
  });
  it("rejects an open shift or another location and invalid display timezone", () => {
    expect(() => stockCutoffAtShiftClose({ storeId: pair.locationId, status: "OPEN", closedAt: null }, pair.locationId)).toThrow();
    expect(() => stockCutoffAtShiftClose({ storeId: "other", status: "CLOSED", closedAt: "2026-11-05T08:00:00Z" }, pair.locationId)).toThrowError(expect.objectContaining({ code: "STOCK_HISTORY_SCOPE_FORBIDDEN" }));
    const request = input(); request.timeZone = "not/a-zone"; expect(() => calculateStockAsOf(request)).toThrow();
  });
});
