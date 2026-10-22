import { expect, it, vi } from "vitest";
it("retries only after restoration and prevents repeated recovery loops", async () => {
  vi.resetModules();
  const { claimRestoredConnectionRetry } = await import("../restored-connection-retry");
  expect(claimRestoredConnectionRetry(false)).toBe(false);
  expect(claimRestoredConnectionRetry(true)).toBe(true);
  expect(claimRestoredConnectionRetry(true)).toBe(false);
  expect(claimRestoredConnectionRetry(false)).toBe(false);
});
