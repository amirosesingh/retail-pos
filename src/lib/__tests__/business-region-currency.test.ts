import { afterEach, describe, expect, it } from "vitest";
import { currencyCode, formatMoney, posCurrency, setPosCurrency } from "../currency";
import { formatDateTime, posDateTimeInput, posDateTimeToIso, posDayKey, posHour, setPosTimeZone } from "../time-zone";
afterEach(() => { setPosCurrency(); setPosTimeZone(""); });
describe("configured business currency and time", () => {
  it("round trips entered booking times through the business zone rather than the device zone", () => {
    setPosTimeZone("Asia/Singapore");
    expect(posDateTimeToIso("2026-10-26T09:30")).toBe("2026-10-26T01:30:00.000Z");
    expect(posDateTimeInput("2026-10-26T01:30:00Z")).toBe("2026-10-26T09:30");
    setPosTimeZone("Africa/Nairobi");
    expect(posDateTimeToIso("2026-10-26T09:30")).toBe("2026-10-26T06:30:00.000Z");
    setPosTimeZone("Europe/London");
    expect(() => posDateTimeToIso("2026-03-29T01:30")).toThrow("does not exist");
    expect(() => posDateTimeToIso("2026-02-30T09:30")).toThrow();
  });
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
