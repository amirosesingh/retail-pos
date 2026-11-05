import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, unknown>();
vi.mock("../device-secrets", () => ({
  setDeviceSecret: async (name: string, value: unknown) => void store.set(name, value),
  getDeviceSecret: async (name: string) => store.get(name) ?? null,
  clearDeviceSecret: (name: string) => void store.delete(name),
}));

import { readCachedRules, rulesCacheScope, writeCachedRules, clearCachedRules } from "../pos-rules-cache";
import { DEFAULT_POS_RULES } from "../pos-rules";

const entry = {
  terminalId: "T-1",
  branchId: "bandar",
  revision: "abc123",
  syncedAt: 1000,
  rules: { ...DEFAULT_POS_RULES, max_cashier_discount_percent: 42 },
};

describe("last confirmed rules on the device", () => {
  beforeEach(() => {
    store.clear();
    clearCachedRules();
  });

  it("survives a restart for the same terminal and branch", async () => {
    await writeCachedRules(entry);
    const back = await readCachedRules("T-1", "bandar");
    expect(back?.revision).toBe("abc123");
    expect(back?.rules.max_cashier_discount_percent).toBe(42);
  });

  it("is not used after the terminal moves to another branch", async () => {
    await writeCachedRules(entry);
    expect(await readCachedRules("T-1", "kajang")).toBeNull();
  });

  it("is not used by a different terminal", async () => {
    await writeCachedRules(entry);
    expect(await readCachedRules("T-2", "bandar")).toBeNull();
  });

  it("is empty on a fresh install", async () => {
    expect(await readCachedRules("T-1", "bandar")).toBeNull();
  });

  it("keeps verified sharing capability only for the exact terminal/branch/backend/project", async () => {
    const cacheScope = rulesCacheScope("T-1", "bandar", "https://pos.test", "https://project.test");
    await writeCachedRules({ ...entry, cacheScope, shiftSharingAvailable: true });
    expect((await readCachedRules("T-1", "bandar", cacheScope))?.shiftSharingAvailable).toBe(true);
    for (const changed of [
      rulesCacheScope("T-1", "bandar", "https://beta.test", "https://project.test"),
      rulesCacheScope("T-1", "bandar", "https://pos.test", "https://other.test"),
    ]) expect(await readCachedRules("T-1", "bandar", changed)).toBeNull();
    expect(await readCachedRules("T-1", "bandar")).toBeNull();
  });

  it("does not infer capability from old rule values or unscoped cache flags", async () => {
    await writeCachedRules({ ...entry, shiftSharingAvailable: true });
    expect((await readCachedRules("T-1", "bandar"))?.shiftSharingAvailable).toBe(false);
    const scope = rulesCacheScope("T-1", "bandar", "https://pos.test", "https://project.test");
    expect(await readCachedRules("T-1", "bandar", scope)).toBeNull();
    await writeCachedRules({ ...entry, cacheScope: scope });
    expect((await readCachedRules("T-1", "bandar", scope))?.shiftSharingAvailable).toBe(false);
  });

  it("does not establish an identity from malformed or secret-bearing connection URLs", () => {
    for (const url of ["", "not-a-url", "https://user:pass@pos.test", "https://pos.test?key=private", "file:///profile", "http://remote.test"]) {
      expect(rulesCacheScope("T-1", "bandar", url, "https://project.test")).toBe("");
    }
    expect(rulesCacheScope("T-1", "bandar", "https://POS.test/", "https://project.test/")).toBe(
      rulesCacheScope("T-1", "bandar", "https://pos.test", "https://project.test"));
  });
});
