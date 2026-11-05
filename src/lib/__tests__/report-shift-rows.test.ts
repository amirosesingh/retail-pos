import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Shift } from "@/core/types/pos-types";

const state = vi.hoisted(() => ({
  query: { data: [] as Shift[], isPending: false, isFetching: false, error: null as Error | null },
  auth: { ready: true, user: { staffId: "staff", role: "admin" } as object | null },
  options: null as Record<string, unknown> | null,
  zone: "UTC",
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: (options: Record<string, unknown>) => {
  state.options = options; return state.query;
} }));
vi.mock("../pos-auth", () => ({ useAuth: () => state.auth }));
vi.mock("../page-data-cache", () => ({ PAGE_DATA_CACHE: { staleTime: 300_000 },
  pageDataScope: () => ["session", "local", "project", "staff"] }));
vi.mock("../shift-history-read", () => ({ readCompleteShiftHistory: vi.fn(),
  shiftHistoryNetworkMode: (source: string) => source === "auto" ? "always" : "online" }));
vi.mock("../time-zone", async importOriginal => ({
  ...await importOriginal<typeof import("../time-zone")>(), effectiveTimeZone: () => state.zone,
}));
import { mergeReportShiftRows } from "../report-shift-rows";
import { useReportShifts } from "../use-report-shifts";

const branch = "ABCDEF00-0000-4000-8000-000000000001";
const row = (id: string, openedAt: unknown, storeId = branch, extra = {}) =>
  ({ id, openedAt, storeId, cashier: "Original", ...extra } as Shift);
function draw(seed: Shift[], from = "", to = "", enabled = true, selected = branch, source: "auto" | "cloud" = "auto") {
  let result!: ReturnType<typeof useReportShifts>;
  function Harness() {
    result = useReportShifts(seed, selected, from, to, enabled, source);
    return createElement("span", null, result.shifts.map(shift => shift.id).join(","));
  }
  const html = renderToStaticMarkup(createElement(Harness));
  return { result, html };
}
beforeEach(() => {
  state.query = { data: [], isPending: false, isFetching: false, error: null };
  state.auth = { ready: true, user: { staffId: "staff", role: "admin" } };
  state.zone = "UTC"; state.options = null;
});

describe("report-only shift timestamp normalization", () => {
  it("sorts native Date seeds alongside text without changing the source objects", () => {
    const date = new Date("2026-11-05T10:00:00.123Z");
    const native = row("native", date), earlier = row("earlier", "2026-11-05T09:00:00.000Z");
    const result = mergeReportShiftRows([earlier, native], [], branch, "", "", "UTC");
    expect(result.map(shift => shift.id)).toEqual(["native", "earlier"]);
    expect(result[0].openedAt).toBe("2026-11-05T10:00:00.123Z");
    expect(native.openedAt).toBe(date); expect(result[1]).toBe(earlier);
  });
  it("preserves all seven fractional digits and deterministic ID ordering", () => {
    const early = "2026-11-05T10:00:00.1234561+00:00";
    const late = "2026-11-05T10:00:00.1234567+00:00";
    const result = mergeReportShiftRows([row("a", late), row("z", early), row("b", late)], [], branch, "", "", "UTC");
    expect(result.map(shift => [shift.id, shift.openedAt])).toEqual([["b", late], ["a", late], ["z", early]]);
  });
  it("orders mixed millisecond and SQL 100 ns values by the instant rather than text precision", () => {
    const precise = "2026-11-05T10:00:00.1234567Z";
    const result = mergeReportShiftRows([
      row("date", new Date("2026-11-05T10:00:00.123Z")),
      row("exact", precise), row("next-ms", "2026-11-05T10:00:00.1240000Z"),
    ], [], branch, "", "", "UTC");
    expect(result.map(shift => shift.id)).toEqual(["next-ms", "exact", "date"]);
    expect(result[1].openedAt).toBe(precise);
  });
  it("compares offsets and uses the existing ID tie-break for equal exact instants", () => {
    const utc = "2026-11-05T10:00:00.1234567Z", offset = "2026-11-05T18:00:00.1234567+08:00";
    const result = mergeReportShiftRows([
      row("a", offset), row("b", utc), row("newer", "2026-11-05T09:00:00.1234567-02:00"),
      row("older", "2026-11-05T18:00:00.1234566+08:00"),
    ], [], branch, "", "", "UTC");
    expect(result.map(shift => shift.id)).toEqual(["newer", "b", "a", "older"]);
    expect(result.find(shift => shift.id === "a")?.openedAt).toBe(offset);
  });
  it("replaces a matching snapshot row with its paged row using canonical UUID identity", () => {
    const key = "ABCDEF00-0000-4000-8000-000000000002";
    const result = mergeReportShiftRows([row(key, new Date("2026-11-05T10:00:00Z"))],
      [row(key.toLowerCase(), "2026-11-05T10:00:00.0000001Z", branch.toLowerCase(), { cashier: "Refreshed" })],
      branch, "", "", "UTC");
    expect(result).toHaveLength(1); expect(result[0].cashier).toBe("Refreshed");
    expect(result[0].openedAt).toBe("2026-11-05T10:00:00.0000001Z");
  });
  it("keeps existing branch and business-date filters for both timestamp representations", () => {
    const result = mergeReportShiftRows([
      row("native-inside", new Date("2026-11-04T16:00:00Z")),
      row("native-outside", new Date("2026-11-04T15:59:59Z")),
      row("foreign", "2026-11-05T01:00:00Z", "OTHER"),
      row("next-day", "2026-11-05T16:00:00Z"),
    ], [row("text-inside", "2026-11-05T15:59:59.9999999Z")], branch.toLowerCase(),
    "2026-11-05", "2026-11-05", "Asia/Brunei");
    expect(result.map(shift => shift.id)).toEqual(["text-inside", "native-inside"]);
  });
  it("ignores invalid or unsupported timestamp values without throwing or inventing an instant", () => {
    const result = mergeReportShiftRows([
      row("invalid-date", new Date(Number.NaN)), row("invalid-text", "not-a-date"),
      row("null", null), row("number", 123), row("object", {}),
    ], [row("valid", "2026-11-05T10:00:00Z")], branch, "", "", "UTC");
    expect(result.map(shift => shift.id)).toEqual(["valid"]);
  });
});

describe("actual report-shifts hook rendering", () => {
  it("renders mixed native/cloud timestamps, duplicate refreshes and scoped filters without the crash", () => {
    const key = "ABCDEF00-0000-4000-8000-000000000002";
    state.query.data = [row(key.toLowerCase(), "2026-11-05T10:00:00.1234567Z", branch, { cashier: "Loaded" }),
      row("paged-native", new Date("2026-11-05T11:00:00Z"))];
    const { result, html } = draw([
      row(key, new Date("2026-11-05T10:00:00Z")), row("seed-native", new Date("2026-11-05T09:00:00Z")),
      row("foreign", "2026-11-05T12:00:00Z", "OTHER"), row("old", "2026-11-04T12:00:00Z"),
      row("bad", new Date(Number.NaN)),
    ], "2026-11-05", "2026-11-05");
    expect(result.shifts.map(shift => shift.id)).toEqual(["paged-native", key.toLowerCase(), "seed-native"]);
    expect(result.shifts[1].cashier).toBe("Loaded");
    expect(html).toContain("paged-native"); expect(html).not.toContain("foreign");
    expect(state.options).toMatchObject({ enabled: true, networkMode: "always", retry: false });
  });
  it("keeps signed-out, unready, disabled and reversed-range reports empty", () => {
    const seed = [row("native", new Date("2026-11-05T10:00:00Z"))];
    state.auth.user = null; expect(draw(seed).result.shifts).toEqual([]);
    state.auth.user = {}; state.auth.ready = false; expect(draw(seed).result.shifts).toEqual([]);
    state.auth.ready = true; expect(draw(seed, "", "", false).result.shifts).toEqual([]);
    expect(draw(seed, "2026-11-06", "2026-11-05").result.shifts).toEqual([]);
    expect(draw(seed, "", "", true, "").result.shifts).toEqual([]);
  });
  it("keeps query progress, errors and explicit cloud-source behavior unchanged", () => {
    state.query.isPending = true; state.query.isFetching = true; state.query.error = new Error("Permission denied");
    const { result } = draw([row("native", new Date("2026-11-05T10:00:00Z"))], "", "", true, branch, "cloud");
    expect(result).toMatchObject({ loading: true, refreshing: false, error: "Permission denied" });
    expect(state.options).toMatchObject({ networkMode: "online", meta: { liveRefresh: { allowOffline: false } } });
  });
});
