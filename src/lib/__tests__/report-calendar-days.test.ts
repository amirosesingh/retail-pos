import { afterEach, expect, it, vi } from "vitest";
import { posDayKey, shiftCalendarDay } from "@/lib/time-zone";

afterEach(() => { vi.unstubAllEnvs(); });

it("keeps the full dashboard calendar range when the viewer is across the date line", () => {
  for (const deviceZone of ["America/New_York", "Pacific/Honolulu", "Pacific/Kiritimati", "Europe/London"]) {
    vi.stubEnv("TZ", deviceZone);
    const today = posDayKey("2026-10-26T15:30:00Z", "Asia/Kuala_Lumpur");
    expect(today).toBe("2026-10-26");
    expect(shiftCalendarDay(today, -13)).toBe("2026-10-13");
    expect(shiftCalendarDay(today, -29)).toBe("2026-09-27");
  }
});

it("steps calendar days across month/year and daylight saving boundaries", () => {
  expect(shiftCalendarDay("2026-01-01", -1)).toBe("2025-12-31");
  expect(shiftCalendarDay("2024-03-01", -1)).toBe("2024-02-29");
  expect(shiftCalendarDay("2026-03-08", 1)).toBe("2026-03-09");
  expect(shiftCalendarDay("2026-11-01", 1)).toBe("2026-11-02");
});
