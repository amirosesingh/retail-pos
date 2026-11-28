import { describe, expect, it } from "vitest";
import { checkedStockHistoryMovementPage, stockHistoryMovementRequestSchema, type StockHistoryMovementPage, type StockHistoryMovementRequest } from "../stock-history-movements";

const firstId = "20000000-0000-4000-8000-000000000001", secondId = "20000000-0000-4000-8000-000000000002";
const time = "2026-11-06T00:00:00.1234567Z", priorTime = "2026-11-06T00:00:00.1234566Z";
const request = (): StockHistoryMovementRequest => ({
  branchId: "branch-A", productId: "10000000-0000-4000-8000-000000000001", cutoff: time,
  timeZone: "Asia/Brunei", sourceRevision: "revision-7", periodStart: "2026-11-05T16:00:00.0000000Z",
  closedShiftId: "30000000-0000-4000-8000-000000000001", limit: 2, after: null,
});
const page = (): StockHistoryMovementPage => {
  const { after: _after, limit: _limit, ...scope } = request();
  return {
    ...scope, status: "complete", reasons: [], baselineAt: "2026-11-01T16:00:00.0000000Z",
    rows: [
      { id: firstId, effectiveAt: time, recordedAt: time, kind: "receiving", delta: "9007199254740993" },
      { id: secondId, effectiveAt: time, recordedAt: "2026-11-06T00:00:00.1234568Z", kind: "sale", delta: "-3" },
    ],
    next: { id: secondId, effectiveAt: time },
  };
};

describe("exact stock movement page transport", () => {
  it("keeps original sale time separate from the ordered database acceptance time", () => {
    const sourceRevision = "stock-history-acceptance.v1:verified";
    const originalAt = "2026-11-05T11:00:00.0000000Z";
    const response = { ...page(), sourceRevision, coverage: {
      acceptedLedger: "complete", writers: "unknown", balanceGrade: "verified", timeGrade: "accepted",
    }, rows: [{ ...page().rows[0], originalAt }], next: null };
    const expected = { ...request(), sourceRevision };
    expect(checkedStockHistoryMovementPage(response, expected).rows[0]).toMatchObject({ originalAt, effectiveAt: time, recordedAt: time });
    expect(() => checkedStockHistoryMovementPage({ ...response, rows: page().rows.slice(0,1) }, expected)).toThrow(/report time/);
    expect(() => checkedStockHistoryMovementPage({ ...response, rows: [{ ...response.rows[0], recordedAt: "2026-11-06T00:00:00.1234568Z" }] }, expected)).toThrow(/report time/);
  });
  it("preserves signed integer strings and orders equal 100ns times by movement UUID", () => {
    const response = page();
    expect(checkedStockHistoryMovementPage(response, request())).toEqual(response);
    const continuation = { ...request(), after: { id: firstId, effectiveAt: time } };
    expect(checkedStockHistoryMovementPage({ ...response, rows: [response.rows[1]] }, continuation).rows[0].delta).toBe("-3");
    expect(() => checkedStockHistoryMovementPage(response, continuation)).toThrow(/page order/);
    expect(() => checkedStockHistoryMovementPage({ ...response, rows: [...response.rows].reverse() }, request())).toThrow(/page order/);
  });

  it("canonicalizes a timezone offset without dropping the final 100ns digit", () => {
    const canonical = stockHistoryMovementRequestSchema.parse({ ...request(), cutoff: "2026-11-06T08:00:00.1234567+08:00" });
    expect(canonical.cutoff).toBe(time);
    expect(() => checkedStockHistoryMovementPage(page(), { ...canonical, cutoff: priorTime })).toThrow(/different report/);
    expect(() => stockHistoryMovementRequestSchema.parse({ ...canonical, cutoff: "2026-02-30T00:00:00Z" })).toThrow();
  });

  it.each([
    { branchId: "branch-a" }, { sourceRevision: "next-source" }, { closedShiftId: undefined }, { periodStart: undefined },
    { productId: secondId }, { timeZone: "UTC" },
  ])("rejects a substituted report scope %o", change => {
    expect(() => checkedStockHistoryMovementPage({ ...page(), ...change }, request())).toThrow(/different report/);
  });

  it("requires actual complete coverage before exposing movement rows or a cursor", () => {
    const response = page();
    expect(() => checkedStockHistoryMovementPage({ ...response, status: "incomplete" }, request())).toThrow(/Unverified/);
    expect(() => checkedStockHistoryMovementPage({ ...response, status: "unavailable", rows: [] }, request())).toThrow(/Unverified/);
    expect(checkedStockHistoryMovementPage({ ...response, status: "unavailable", baselineAt: undefined, rows: [], next: null }, request()).rows).toEqual([]);
    expect(() => checkedStockHistoryMovementPage({ ...response,
      coverage: { acceptedLedger: "complete", writers: "pending", balanceGrade: "recorded_provisional", timeGrade: "recorded" },
    }, request())).toThrow(/complete historical coverage/);
  });

  it("rejects before-period, after-cutoff, and invalid recorded times", () => {
    const response = page();
    const row = response.rows[0];
    for (const change of [{ effectiveAt: "2026-11-05T15:59:59.9999999Z" }, { effectiveAt: "2026-11-06T00:00:00.1234568Z" }, { recordedAt: priorTime }]) {
      expect(() => checkedStockHistoryMovementPage({ ...response, rows: [{ ...row, ...change }], next: null }, request())).toThrow(/report time/);
    }
  });

  it("rejects a page beyond the requested bound, malformed signed units, and an invented continuation", () => {
    const response = page();
    expect(() => checkedStockHistoryMovementPage(response, { ...request(), limit: 1 })).toThrow(/requested size/);
    expect(() => checkedStockHistoryMovementPage({ ...response, next: { id: firstId, effectiveAt: time } }, request())).toThrow(/cursor/);
    for (const delta of [0, "0", "-0", "1.5", "1e7"]) {
      expect(() => checkedStockHistoryMovementPage({ ...response, rows: [{ ...response.rows[0], delta }] }, request())).toThrow();
    }
  });
});
