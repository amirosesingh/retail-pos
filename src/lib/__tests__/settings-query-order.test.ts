import { beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("@/core/api/db-router", () => ({
  dbRouter: { query },
}));

import { loadBranchSettings } from "../branch-settings";

describe("scoped settings reads", () => {
  beforeEach(() => query.mockReset().mockResolvedValue([]));

  it("orders composite-key settings tables by section instead of a missing id column", async () => {
    await loadBranchSettings({ CLUSTER: "361-degree", BRANCH: "branch-1", TERMINAL: "terminal-1" });

    expect(query).toHaveBeenCalledTimes(4);
    for (const [, options] of query.mock.calls) {
      expect(options.orderBy).toEqual({ column: "section", ascending: true });
    }
  });

  it("loads global locks without inventing a branch when business tables are empty", async () => {
    const result = await loadBranchSettings({ CLUSTER: "", BRANCH: "", TERMINAL: "" }, true);
    expect(result).toEqual({ overrides: { CLUSTER: {}, BRANCH: {}, TERMINAL: {} }, locks: {} });
    expect(query).toHaveBeenCalledExactlyOnceWith(
      "settings_locks",
      expect.objectContaining({ columns: "section,locked" }),
    );
  });

  it("does not confirm scope loading when an authoritative read fails", async () => {
    query.mockRejectedValueOnce(new Error("Settings unavailable"));
    await expect(
      loadBranchSettings({ CLUSTER: "", BRANCH: "", TERMINAL: "" }, true),
    ).rejects.toThrow("Settings unavailable");
  });

  it("decodes JSON settings patches returned by SQL Server", async () => {
    query.mockImplementation(async (table: string, options: { match?: { scope?: string } }) => {
      if (table === "settings_overrides" && options.match?.scope === "BRANCH")
        return [{ section: "tax", patch: '{"tax":{"rate":6}}' }];
      return [];
    });
    const settings = await loadBranchSettings({ CLUSTER: "", BRANCH: "branch-1", TERMINAL: "" });
    expect(settings.overrides.BRANCH.tax).toEqual({ tax: { rate: 6 } });
  });
});

it("loads the selected registered terminal as an organizational scope", async () => {
  query.mockReset().mockResolvedValue([]);
  await loadBranchSettings({ CLUSTER: "", BRANCH: "branch-1", TERMINAL: "terminal-1" });
  expect(query).toHaveBeenCalledWith(
    "settings_overrides",
    expect.objectContaining({ match: { scope: "TERMINAL", scope_id: "terminal-1" } }),
  );
});
