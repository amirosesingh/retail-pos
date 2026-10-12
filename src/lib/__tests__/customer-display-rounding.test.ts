import { afterEach, describe, expect, it, vi } from "vitest";
import { applyRounding, roundingPaymentMethod } from "@/core/pricing/rounding";
import {
  displayRounding,
  publishDisplay,
  readDisplaySnapshot,
  type DisplaySnapshot,
} from "../customer-display";
const config = {
  enabled: true,
  unit: 1,
  direction: "down" as const,
  appliesTo: "cash" as const,
  showOnReceipt: true,
  receiptLabel: "Extra Discount",
};
afterEach(() => vi.unstubAllGlobals());
describe("customer display payable amount", () => {
  it("shows the same rounded-down amount and discount as the cashier", () => {
    expect(displayRounding(applyRounding(71.2, config, "cash"), config)).toEqual({
      total: 71,
      roundingAdjustment: -0.2,
      roundingLabel: "Extra Discount",
      showRounding: true,
    });
  });
  it("leaves card-only and predominantly card split payments unrounded under cash-only settings", () => {
    const method = roundingPaymentMethod("cash", [
      { id: "cash", method: "cash", amount: 20 },
      { id: "card", method: "card", amount: 51.2 },
    ]);
    for (const tender of ["card", method] as const)
      expect(displayRounding(applyRounding(71.2, config, tender), config)).toMatchObject({
        total: 71.2,
        roundingAdjustment: 0,
        showRounding: false,
      });
  });
  it("keeps the final payable total even when the rounding line is hidden", () => {
    expect(
      displayRounding(applyRounding(71.2, config, "cash"), { ...config, showOnReceipt: false }),
    ).toMatchObject({ total: 71, showRounding: false });
  });
  it("does not show an extra discount for round-up", () => {
    const up = { ...config, direction: "up" as const };
    expect(displayRounding(applyRounding(71.2, up, "cash"), up)).toMatchObject({
      total: 72,
      roundingAdjustment: 0.8,
      showRounding: false,
    });
  });
  it("retains the rounded amount and adjustment across the display storage transport", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("BroadcastChannel", undefined);
    vi.stubGlobal("window", {
      localStorage: {
        setItem: (key: string, value: string) => values.set(key, value),
        getItem: (key: string) => values.get(key) ?? null,
      },
    });
    const payload = {
      mode: "cart",
      ...displayRounding(applyRounding(71.2, config, "cash"), config),
    } as DisplaySnapshot;
    publishDisplay(payload);
    expect(readDisplaySnapshot()).toMatchObject({
      total: 71,
      roundingAdjustment: -0.2,
      showRounding: true,
    });
  });
});
