import { describe, expect, it } from "vitest";
import { stockDateTimeInput, stockEndOfDay, stockTimeChoices } from "../stock-history-selection";

describe("stock report physical-time selection", () => {
  it("uses the selected business zone rather than the PC clock zone", () => {
    expect(stockDateTimeInput("2026-11-06T00:01:02Z", "Asia/Brunei")).toBe("2026-11-06T08:01:02");
    expect(stockTimeChoices("2026-11-06T08:01:02.0000001", "Asia/Brunei")).toEqual([
      { instant: "2026-11-06T00:01:02.0000001Z", label: "UTC+08:00" },
    ]);
  });
  it("selects the inclusive end of the business day, including a DST transition", () => {
    expect(stockEndOfDay("2026-11-06", "Asia/Brunei")).toEqual({
      start: "2026-11-05T16:00:00.0000000Z", cutoff: "2026-11-06T15:59:59.9999999Z",
    });
    expect(stockEndOfDay("2026-11-01", "America/New_York")).toEqual({
      start: "2026-11-01T04:00:00.0000000Z", cutoff: "2026-11-02T04:59:59.9999999Z",
    });
  });
  it("preserves all seven fractional digits when an explicit exact instant is selected", () => {
    expect(stockTimeChoices("2026-11-06T00:00:00.1234567", "UTC")[0].instant).toBe("2026-11-06T00:00:00.1234567Z");
  });
  it("does not guess either occurrence of a repeated DST hour", () => {
    expect(stockTimeChoices("2026-11-01T01:30", "America/New_York")).toEqual([
      { instant: "2026-11-01T05:30:00.0000000Z", label: "UTC−04:00" },
      { instant: "2026-11-01T06:30:00.0000000Z", label: "UTC−05:00" },
    ]);
  });
  it("handles half-hour DST transitions and nonexistent local times", () => {
    expect(stockTimeChoices("2026-04-05T01:45", "Australia/Lord_Howe")).toHaveLength(2);
    expect(stockTimeChoices("2026-03-08T02:30", "America/New_York")).toEqual([]);
    expect(stockTimeChoices("2011-12-30T12:00", "Pacific/Apia")).toEqual([]);
  });
  it.each(["2026-02-30T12:00", "2026-11-06T25:00", "2026-11-06", "2026-11-06T00:00:00.12345678"])("rejects invalid wall time %s", value => {
    expect(() => stockTimeChoices(value, "Asia/Brunei")).toThrow();
  });
});
