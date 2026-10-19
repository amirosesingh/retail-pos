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

it("orders beta updates numerically and stable after prereleases", async () => {
  const { compareVersions } = await import("../update-manifest");
  expect(compareVersions("1.4.75-beta.10", "1.4.75-beta.9")).toBe(1);
  expect(compareVersions("1.4.75", "1.4.75-beta.10")).toBe(1);
  expect(compareVersions("1.4.75-beta.1", "1.4.75")).toBe(-1);
  expect(compareVersions("1.4.9", "1.4.10")).toBe(-1);
  expect(compareVersions("1.4.75+build.1", "1.4.75+build.2")).toBe(0);
});
