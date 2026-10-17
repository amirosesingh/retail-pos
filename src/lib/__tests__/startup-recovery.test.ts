import { describe, expect, it } from "vitest";
import { needsSetupRecovery } from "../startup-recovery";
import type { ConfigReadiness } from "../platform-config-ready";
const profile = (state: ConfigReadiness["state"]): ConfigReadiness => ({ state, ready: state === "ready", have: { supabaseUrl: true, supabaseKey: true, backendUrl: true } });

describe("offline setup recovery visibility", () => {
  it("does not show emergency access for configured registered phones or unreadable storage", () => {
    for (const state of ["ready", "failed", "hydrating"] as const)
      expect(needsSetupRecovery(profile(state), "registered")).toBe(false);
    expect(needsSetupRecovery(null, null)).toBe(false);
  });
  it("keeps recovery available for missing connection fields or registration", () => {
    for (const state of ["missing", "incomplete"] as const)
      expect(needsSetupRecovery(profile(state), "registered")).toBe(true);
    expect(needsSetupRecovery(profile("ready"), "not-registered")).toBe(true);
  });
  it("allows repair after an explicit configuration rejection even on a registered terminal", () => {
    for (const state of ["ready", "failed", "hydrating"] as const)
      expect(needsSetupRecovery(profile(state), "registered", true)).toBe(true);
  });
});
