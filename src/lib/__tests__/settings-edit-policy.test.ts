import { describe, expect, it } from "vitest";
import { canEditSettingsScope, staffSettingsTarget } from "../settings-edit-policy";

describe("settings ownership", () => {
  it("allows staff only explicitly permitted unlocked branch settings", () => {
    expect(canEditSettingsScope("BRANCH", false, true, false)).toBe(true);
    for (const source of ["GLOBAL", "CLUSTER", "TERMINAL"] as const)
      expect(canEditSettingsScope(source, false, true, false)).toBe(false);
    expect(canEditSettingsScope("BRANCH", false, false, false)).toBe(false);
    expect(canEditSettingsScope("BRANCH", false, true, true)).toBe(false);
  });
  it("creates branch overrides without changing inherited global defaults", () => {
    expect(staffSettingsTarget("tax", true, "branch-1", false)).toBe("BRANCH");
    expect(() => staffSettingsTarget("tax", false, "branch-1", false)).toThrow("permission");
    expect(() => staffSettingsTarget("tax", true, "", false)).toThrow("branch");
    expect(() => staffSettingsTarget("tax", true, "branch-1", true)).toThrow("locked");
    expect(() => staffSettingsTarget("terminalSecurity", true, "branch-1", false)).toThrow("administrator");
  });
  it("lets administrators change global defaults even when branch overrides are locked", () => {
    expect(canEditSettingsScope("GLOBAL", true, false, true)).toBe(true);
    expect(canEditSettingsScope("BRANCH", true, true, true)).toBe(false);
  });
});
