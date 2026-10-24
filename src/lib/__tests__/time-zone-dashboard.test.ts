import { afterEach, describe, expect, it, vi } from "vitest";
import { posDayKey, posHour, setPosTimeZone } from "@/lib/time-zone";

afterEach(() => { setPosTimeZone(""); vi.restoreAllMocks(); });

describe("dashboard trading-zone buckets", () => {
  it("reuses formatters across a large chart without changing zone or daylight-saving results", () => {
    const constructor = vi.spyOn(Intl, "DateTimeFormat");
    setPosTimeZone("Pacific/Auckland");
    for (let index = 0; index < 1000; index++) {
      expect(posDayKey("2026-01-01T12:00:00Z")).toBe("2026-01-02");
      expect(posHour("2026-01-01T12:00:00Z")).toBe(1);
    }
    expect(constructor.mock.calls.length).toBeLessThanOrEqual(2);
    expect(posHour("2026-07-01T12:00:00Z")).toBe(0);
    setPosTimeZone("UTC");
    expect(posDayKey("2026-01-01T12:00:00Z")).toBe("2026-01-01");
    expect(posHour("2026-01-01T12:00:00Z")).toBe(12);
  });
  it("keeps computer-local calendar and clock behavior when no zone is configured", () => {
    const instant = new Date(2026, 5, 12, 23, 45);
    expect(posDayKey(instant)).toBe("2026-06-12");
    expect(posHour(instant)).toBe(23);
  });
  it("uses the configured branch time zone instead of UTC day and hour", () => {
    setPosTimeZone("Asia/Kuala_Lumpur");
    const instant = "2026-01-01T16:15:00.000Z";
    expect(posDayKey(instant)).toBe("2026-01-02");
    expect(posHour(instant)).toBe(0);
  });

  it("returns safe values for invalid timestamps", () => {
    expect(posDayKey("not-a-date")).toBe("");
    expect(posHour("not-a-date")).toBe(0);
  });
});
