import { describe, expect, it } from "vitest";
import {
  MAX_ACTIVITY_SOURCE_BATCHES,
  activityScanBudgetExhausted,
} from "../activity-pagination";

describe("activity pagination scan budget", () => {
  it("stops sparse audience scans at the independent source budget", () => {
    expect(activityScanBudgetExhausted({
      batchesRead: MAX_ACTIVITY_SOURCE_BATCHES,
      exhausted: false,
      visibleCount: 0,
      target: 25,
    })).toBe(true);
  });

  it("accepts a filled page or an exhausted source", () => {
    expect(activityScanBudgetExhausted({ batchesRead: 10, exhausted: false, visibleCount: 25, target: 25 })).toBe(false);
    expect(activityScanBudgetExhausted({ batchesRead: 1, exhausted: true, visibleCount: 0, target: 25 })).toBe(false);
  });
});
