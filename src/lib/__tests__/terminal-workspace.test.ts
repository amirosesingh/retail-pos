import { describe, expect, it } from "vitest";
import { shouldOpenRegister } from "@/lib/terminal-workspace";

describe("terminal workspace landing", () => {
  it("opens retail cashiers in the workspace until Sell now is explicit", () => {
    expect(
      shouldOpenRegister({
        isAdmin: false,
        isSupervisor: false,
        isCashier: true,
      }),
    ).toBe(false);
  });

  it("keeps Selling on the retail overview until the cart is explicitly opened", () => {
    expect(
      shouldOpenRegister({
        isAdmin: true,
        isSupervisor: true,
        isCashier: false,
      }),
    ).toBe(false);
    expect(
      shouldOpenRegister({
        isAdmin: false,
        isSupervisor: true,
        isCashier: false,
      }),
    ).toBe(false);
  });

  it("always resumes protected selling flows and explicit register navigation", () => {
    const base = {
      isAdmin: true,
      isSupervisor: true,
      isCashier: false,
    };
    expect(shouldOpenRegister({ ...base, forcedSelling: true })).toBe(true);
    expect(shouldOpenRegister({ ...base, resumeSale: true })).toBe(true);
    expect(shouldOpenRegister({ ...base, bookingFlow: true })).toBe(true);
  });
});
