import { describe, expect, it } from "vitest";
import { movementActivityWithinRange, stockMovementRange, verifiedMovementBreakdown, verifiedMovementSummary, verifiedMovementTimeline } from "../stock-movement-report";
import type { StockActivityPage } from "../stock-activity-query";
import type { StockHistoryMovementPage } from "../stock-history-movements";
import type { StockHistoryPage } from "../stock-history-report";

const timeZone = "Asia/Brunei", branchId = "branch-a";
const productId = "4cbe2fb4-2247-4d69-aa80-33d8eb087364";
const from = "2026-11-21", now = new Date("2026-11-23T02:30:00.000Z");
const day = stockMovementRange({ from, to: from }, branchId, timeZone, now);

describe("inventory movement report dates and evidence", () => {
  it("resolves exact business dates and uses a verified period only for one date", () => {
    expect(day).toEqual({ opening: "2026-11-20T16:00:00.0000000Z", cutoff: "2026-11-21T15:59:59.9999999Z",
      aggregateRequest: { branchId, timeZone, periodStart: "2026-11-20T16:00:00.0000000Z", cutoff: "2026-11-21T15:59:59.9999999Z" } });
    expect(stockMovementRange({ from, to: "2026-11-23" }, branchId, timeZone, now)).toEqual({ opening: day.opening,
      cutoff: "2026-11-23T02:30:00.0000000Z", aggregateRequest: null });
    expect(() => stockMovementRange({ from, to: "2026-11-24" }, branchId, timeZone, now)).toThrow("already started");
    expect(() => stockMovementRange({ from: "2026-11-22", to: from }, branchId, timeZone, now)).toThrow("valid start and end date");
  });

  it("preserves the exclusive activity paging stop without dropping records on the opening boundary", () => {
    const record = { id: productId, productId, branchId, kind: "stock", reference: null, delta: 1, before: 1, after: 2 };
    const prior = "2026-11-20T15:59:59.9999999Z";
    const activity: StockActivityPage = { branchId, cutoff: day.cutoff, side: "through-cutoff", rows: [
      { ...record, occurredAt: day.opening }, { ...record, occurredAt: prior },
    ], next: { id: productId, occurredAt: prior } };
    expect(movementActivityWithinRange(activity, day)).toEqual({ rows: [activity.rows[0]], hasEarlierPage: false });
    expect(movementActivityWithinRange({ ...activity, next: { id: productId, occurredAt: day.opening } }, day).hasEarlierPage).toBe(true);
  });

  it("exposes branch totals only on one complete verified page and preserves exact integer arithmetic", () => {
    const page: StockHistoryPage = { branchId, timeZone, cutoff: day.cutoff, status: "complete", reasons: [], next: null,
      period: { start: day.opening, endExclusive: "2026-11-21T16:00:00.0000000Z", through: day.cutoff, fullDay: true },
      rows: [{ productId, locationId: branchId, name: "Item", sku: null, barcode: null, quantity: "10000000000000000", negative: false,
        openingQuantity: "1", inQuantity: "10000000000000000", outQuantity: "1" }] };
    expect(verifiedMovementSummary(page, null)).toEqual({ incoming: 10000000000000000n, outgoing: 1n });
    expect(verifiedMovementSummary({ ...page, status: "incomplete" }, null)).toBeNull();
    expect(verifiedMovementSummary({ ...page, next: productId }, null)).toBeNull();
    expect(verifiedMovementSummary(page, productId)).toBeNull();
  });

  it("coalesces same-time movements and never charts an incomplete last group or an unreconciled balance", () => {
    const time = "2026-11-21T04:00:00.0000000Z";
    const movement: StockHistoryMovementPage = { branchId, timeZone, productId, cutoff: day.cutoff, periodStart: day.opening,
      sourceRevision: "verified", status: "complete", reasons: [], next: null, rows: [
        { id: productId, effectiveAt: time, recordedAt: time, kind: "sale", delta: "-1" },
        { id: "ef03b975-fe64-4b9e-ae29-43625711ac4b", effectiveAt: time, recordedAt: time, kind: "sale", delta: "-1" },
      ] };
    expect(verifiedMovementTimeline("2", "0", movement)).toEqual([
      { label: day.opening, quantity: 2 }, { label: time, quantity: 0 }, { label: day.cutoff, quantity: 0 },
    ]);
    expect(verifiedMovementTimeline("2", "1", movement)).toBeNull();
    expect(verifiedMovementTimeline("2", "0", { ...movement, next: { id: productId, effectiveAt: time } })).toBeNull();
    const product = { productId, locationId: branchId, name: "Item", sku: null, barcode: null, quantity: "0", negative: false,
      openingQuantity: "2", inQuantity: "0", outQuantity: "2" };
    expect(verifiedMovementBreakdown(product, movement)).toEqual([{ kind: "sale", incoming: 0n, outgoing: 2n }]);
    expect(verifiedMovementBreakdown({ ...product, outQuantity: "1" }, movement)).toBeNull();
    expect(verifiedMovementBreakdown(product, { ...movement, next: { id: productId, effectiveAt: time } })).toBeNull();
  });
});
