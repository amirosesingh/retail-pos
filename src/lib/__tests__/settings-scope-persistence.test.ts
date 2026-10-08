import { beforeEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  upsert: vi.fn(),
  write: vi.fn(),
  broadcast: vi.fn(),
  bridge: vi.fn(),
  client: vi.fn(),
  live: vi.fn(),
}));
vi.mock("@/core/api/db-router", () => ({
  dbRouter: { query: mocks.query, upsert: mocks.upsert, write: mocks.write },
}));
vi.mock("@/core/local-db/local-db", () => ({ localDb: mocks.bridge }));
vi.mock("@/integrations/supabase/external-client", () => ({
  authenticatedExternalClientSnapshot: mocks.client,
}));
vi.mock("../sync-engine", () => ({ broadcastSettingsChange: mocks.broadcast, runOpLive: mocks.live }));
import { loadBranchSettings, saveSectionOverride } from "../branch-settings";
import { isLocationSetupRoute } from "../app-shell-routes";

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.query.mockResolvedValue([]);
  mocks.upsert.mockResolvedValue(undefined);
  mocks.broadcast.mockResolvedValue(undefined);
  mocks.bridge.mockReturnValue(null);
});

describe("settings scope persistence", () => {
  it.each(["CLUSTER", "BRANCH"] as const)(
    "persists business settings to the exact %s identity",
    async (tier) => {
      await saveSectionOverride(tier, `${tier}-id`, "tax", { tax: { rate: 6 } }, "Admin");
      if (tier === "CLUSTER") {
        expect(mocks.live).toHaveBeenCalledWith("Saving cluster settings", expect.objectContaining({ table: "settings_overrides", rows: [expect.objectContaining({ scope: tier, scope_id: `${tier}-id` })] }));
        expect(mocks.upsert).not.toHaveBeenCalled();
      } else expect(mocks.upsert).toHaveBeenCalledExactlyOnceWith(
        "settings_overrides",
        {
          scope: tier,
          scope_id: `${tier}-id`,
          section: "tax",
          patch: { tax: { rate: 6 } },
          updated_by: "Admin",
        },
        "scope,scope_id,section",
        "Saving a settings override",
      );
      expect(mocks.broadcast).toHaveBeenCalledWith("settings_overrides");
    },
  );
  it("does not send a branch override without a selected branch", async () => {
    await expect(saveSectionOverride("BRANCH", "", "tax", {}, "Admin")).rejects.toThrow("selected");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("rejects business settings at terminal scope", async () => {
    await expect(saveSectionOverride("TERMINAL", "terminal", "tax", {}, "Admin")).rejects.toThrow(
      "cannot be stored",
    );
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("does not announce a successful save after a database refusal", async () => {
    mocks.upsert.mockRejectedValue(new Error("Write refused"));
    await expect(saveSectionOverride("BRANCH", "branch", "tax", {}, "Admin")).rejects.toThrow(
      "Write refused",
    );
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });
  it("reads global locks with verified cloud authority before a new Electron terminal has a branch", async () => {
    mocks.bridge.mockReturnValue({});
    const read = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => ({ data: [{ section: "tax", locked: true }], error: null })),
    };
    const from = vi.fn(() => read);
    mocks.client.mockResolvedValue({ from });
    const result = await loadBranchSettings({ CLUSTER: "", BRANCH: "", TERMINAL: "" }, true);
    expect(result.locks.tax).toBe(true);
    expect(from).toHaveBeenCalledExactlyOnceWith("settings_locks");
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("keeps setup reachable without exposing operational pages before a location exists", () => {
    for (const path of [
      "/settings",
      "/settings/database",
      "/settings/business-identity",
      "/stores",
    ])
      expect(isLocationSetupRoute(path)).toBe(true);
    for (const path of ["/settings-evil", "/sales", "/inventory", "/transfers"])
      expect(isLocationSetupRoute(path)).toBe(false);
  });
});
