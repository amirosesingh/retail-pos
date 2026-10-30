import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HistoryDateNavigation } from "@/platforms/web/components/pos/HistoryDateNavigation";
import { moveHistoryDateRange } from "../history-date-range";
import { setPosTimeZone } from "../time-zone";

afterEach(() => { setPosTimeZone(""); vi.useRealTimers(); });

describe("receipt and shift history day navigation", () => {
  it("moves both dates together and reverses without changing range length", () => {
    const previous = moveHistoryDateRange("2026-10-01", "2026-10-30", -1);
    expect(previous).toEqual({ from: "2026-09-30", to: "2026-10-29" });
    expect(moveHistoryDateRange(previous.from, previous.to, 1)).toEqual({ from: "2026-10-01", to: "2026-10-30" });
  });
  it("uses the configured store day when starting from All shifts", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-30T18:00:00Z"));
    setPosTimeZone("Asia/Kuala_Lumpur");
    expect(moveHistoryDateRange("", "", -1)).toEqual({ from: "2026-10-30", to: "2026-10-30" });
  });
  it("uses calendar days through DST and leap days, and anchors a one-sided range", () => {
    expect(moveHistoryDateRange("2026-03-08", "2026-03-08", 1)).toEqual({ from: "2026-03-09", to: "2026-03-09" });
    expect(moveHistoryDateRange("2028-03-01", "2028-03-01", -1)).toEqual({ from: "2028-02-29", to: "2028-02-29" });
    expect(moveHistoryDateRange("", "2026-10-30", -1)).toEqual({ from: "2026-10-29", to: "2026-10-29" });
  });
  it("renders compact labelled keyboard/touch controls without a form submit", () => {
    const html = renderToStaticMarkup(createElement(HistoryDateNavigation,
      { from: "2026-10-30", to: "2026-10-30", onChange: () => {} }));
    expect(html).toContain('aria-label="Previous day"');
    expect(html).toContain('aria-label="Next day"');
    expect(html).toContain("Today");
    expect(html.match(/type="button"/g)).toHaveLength(3);
  });
});
