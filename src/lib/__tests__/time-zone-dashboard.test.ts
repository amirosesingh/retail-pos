import { afterEach, describe, expect, it } from "vitest";
import { posDayKey, posHour, setPosTimeZone } from "@/lib/time-zone";

afterEach(() => setPosTimeZone(""));

describe("dashboard trading-zone buckets", () => {
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
