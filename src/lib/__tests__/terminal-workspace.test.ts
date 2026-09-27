import { describe, expect, it } from "vitest";
import { shouldOpenRegister } from "@/lib/terminal-workspace";

describe("terminal workspace landing", () => {
  it("opens retail cashiers directly into the shared register", () => {
    expect(
      shouldOpenRegister({
        purpose: "retail",
        isAdmin: false,
        isSupervisor: false,
        isCashier: true,
      }),
    ).toBe(true);
  });

  it.each(["warehouse", "inventory", "receiving", "management"] as const)(
    "opens the %s purpose home without granting access",
    (purpose) => {
      expect(
        shouldOpenRegister({ purpose, isAdmin: false, isSupervisor: false, isCashier: true }),
      ).toBe(false);
    },
  );

  it("keeps admin and manager accounts management-first on a retail terminal", () => {
    expect(
      shouldOpenRegister({
        purpose: "retail",
        isAdmin: true,
        isSupervisor: true,
        isCashier: false,
      }),
    ).toBe(false);
    expect(
      shouldOpenRegister({
        purpose: "retail",
        isAdmin: false,
        isSupervisor: true,
        isCashier: false,
      }),
    ).toBe(false);
  });

  it("always resumes protected selling flows and explicit register navigation", () => {
    const base = {
      purpose: "warehouse" as const,
      isAdmin: true,
      isSupervisor: true,
      isCashier: false,
    };
    expect(shouldOpenRegister({ ...base, forcedSelling: true })).toBe(true);
    expect(shouldOpenRegister({ ...base, resumeSale: true })).toBe(true);
    expect(shouldOpenRegister({ ...base, bookingFlow: true })).toBe(true);
  });
});
