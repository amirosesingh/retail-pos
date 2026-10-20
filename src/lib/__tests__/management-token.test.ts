import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ insert: vi.fn(), upsert: vi.fn(), encrypt: vi.fn() }));
vi.mock("@/integrations/supabase/external-client", () => ({
  supabaseExternal: { from: () => ({ insert: mocks.insert, upsert: mocks.upsert }) },
  createTenantClient: vi.fn(), resetExternalClient: vi.fn(),
}));
vi.mock("@/lib/terminal-crypto", () => ({ ACTIVATION_TTL_MS: 900000, encryptActivationV1: mocks.encrypt }));
vi.mock("@/lib/external-supabase-config", () => ({
  supabaseConfig: () => ({ url: "https://tenant.example", key: "public-key" }),
  publicSupabaseConfig: () => null,
}));
vi.mock("@/core/api/sync-relay", () => ({ canRelay: () => false, relayOp: vi.fn() }));
vi.mock("@/lib/server-origin", () => ({ serverOrigin: () => "https://beta.example", posFetch: vi.fn() }));
import { issueTerminalToken } from "@/core/activation/terminal-tokens";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.insert.mockResolvedValue({ error: null });
  mocks.upsert.mockResolvedValue({ error: null });
  mocks.encrypt.mockResolvedValue("encrypted-code");
});
it("issues branchless management registration only for mobile", async () => {
  const result = await issueTerminalToken({ location: null, management: true, locationName: "Management — user branch access", deviceName: "Supervisor phone", platform: "mobile" });
  expect(result.token.locationId).toBeNull();
  expect(result.token.platform).toBe("mobile");
  expect(mocks.upsert).not.toHaveBeenCalled();
  expect(mocks.insert.mock.calls[0][0][0]).toMatchObject({ location_id: null, platform: "mobile", is_claimed: false });
});
it("refuses a Windows registration without a branch before any database write", async () => {
  await expect(issueTerminalToken({ location: null, locationName: "", deviceName: "PC", platform: "pc" })).rejects.toThrow("require a branch");
  expect(mocks.insert).not.toHaveBeenCalled();
});
it("preserves normal branch-based mobile registration", async () => {
  const result = await issueTerminalToken({ location: { id: "branch-a", code: "A", name: "Shop A" }, locationName: "Shop A", deviceName: "Shop phone", platform: "mobile" });
  expect(result.token.locationId).toBe("branch-a");
  expect(mocks.upsert).toHaveBeenCalledOnce();
});

it("issues an explicitly requested branchless management PC", async () => {
  const result = await issueTerminalToken({ location: null, management: true, locationName: "Management", deviceName: "Office PC", platform: "pc" });
  expect(result.token).toMatchObject({ locationId: null, platform: "pc" });
});
