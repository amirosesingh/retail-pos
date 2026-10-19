import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
it.each(["stable", "beta"])("%s accepts only its own update channel", async channel => {
  vi.stubEnv("VITE_POS_RELEASE_CHANNEL", channel);
  vi.resetModules();
  const release = await import("../release-channel");
  expect(release.acceptsReleaseVersion("1.4.75-beta.1")).toBe(channel === "beta");
  expect(release.acceptsReleaseVersion("1.4.75")).toBe(channel === "stable");
  expect(release.acceptsReleaseVersion("1.4.75-alpha.1")).toBe(false);
  expect(release.DEFAULT_UPDATE_BASE.endsWith("/beta")).toBe(channel === "beta");
});
