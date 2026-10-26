import { afterEach, describe, expect, it } from "vitest";
import { currencyCode, formatMoney, posCurrency, setPosCurrency } from "../currency";
import { formatDateTime, posDayKey, posHour, setPosTimeZone } from "../time-zone";
afterEach(() => { setPosCurrency(); setPosTimeZone(""); });
describe("configured business currency and time", () => {
  it("keeps the existing default and formats saved currency without converting values", () => {
    expect(formatMoney(12.5)).toBe("$12.50");
    setPosCurrency("BND");
    expect(posCurrency()).toBe("BND");
    expect(formatMoney(12.5)).toContain("12.50");
    expect(formatMoney(12.5)).toContain("BND");
    expect(currencyCode("invalid")).toBe("USD");
  });
  it("previews an explicit selected zone while keeping report buckets in the saved business zone", () => {
    setPosTimeZone("Asia/Singapore");
    const instant = "2026-01-01T18:00:00Z";
    expect(formatDateTime(instant, { timeZone: "Africa/Nairobi" })).toContain("01-01-2026 21:00:00");
    expect(formatDateTime(instant)).toContain("02-01-2026 02:00:00");
    expect(posDayKey(instant)).toBe("2026-01-02");
    expect(posHour(instant)).toBe(2);
  });
});
