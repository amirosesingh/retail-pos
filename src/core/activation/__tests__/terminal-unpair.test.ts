import { afterEach, beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ calls: [] as string[], rpc: vi.fn(), clear: vi.fn(), remove: vi.fn(), flush: vi.fn() }));
vi.mock("@/integrations/supabase/external-client", () => ({
  resetExternalClient: vi.fn(), createTenantClient: vi.fn(),
  supabaseExternal: { rpc: f.rpc, auth: { signOut: async () => { f.calls.push("signout"); } } },
}));
vi.mock("@/core/activation/device-proof", () => ({ deviceProofHash: async () => "proof-hash" }));
vi.mock("@/lib/device-secrets", () => ({ getDeviceSecret: vi.fn(), setDeviceSecret: vi.fn(), clearDeviceSecret: (key: string) => f.calls.push(key) }));
vi.mock("@/lib/secure-cloud-config", () => ({ removeCloudCredentials: f.remove }));
vi.mock("@/lib/backend-config", () => ({ saveBackendUrl: async () => { f.calls.push("backend"); return { ok: true }; } }));
vi.mock("@/platform-config/approval-token-client", () => ({ clearApprovalToken: async () => { f.calls.push("approval"); } }));
vi.mock("@/lib/connection-profile", () => ({ flushConnectionProfile: f.flush }));
vi.mock("@/core/activation/connection-health", () => ({ resetHealthCache: vi.fn() }));
vi.mock("@/core/api/sync-relay", () => ({ canRelay: () => false, relayOp: vi.fn() }));
vi.mock("@/core/activation/terminal-activation-log", () => ({ recordActivationAttempt: vi.fn() }));
vi.mock("@/lib/management-device", () => ({ setManagementDevice: vi.fn() }));
vi.mock("@/lib/external-supabase-config", () => ({
  clearTerminalSupabaseOverride: () => false, clearTerminalMembershipSupabaseOverride: () => false,
  setTerminalSupabaseOverride: vi.fn(), setTerminalMembershipSupabaseOverride: vi.fn(),
  publicSupabaseConfig: vi.fn(), supabaseConfig: vi.fn(),
}));
import { unpairTerminal, stampHeartbeat } from "../terminal-tokens";
beforeEach(() => {
  f.calls.length = 0;
  f.rpc.mockReset().mockResolvedValue({ error: null });
  f.clear.mockReset().mockImplementation(async () => { f.calls.push("mirror"); return { ok: true }; });
  f.remove.mockReset().mockImplementation(async () => { f.calls.push("cloud"); return { ok: true }; });
  f.flush.mockReset().mockImplementation(async () => { f.calls.push("flush"); });
  vi.stubGlobal("window", { pos: { clearTerminalConfig: f.clear, writeTerminalConfig: vi.fn() }, localStorage: { removeItem: vi.fn() }, dispatchEvent: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());
it("ends Auth before removing connection settings and waits for durable native cleanup", async () => {
  await unpairTerminal();
  expect(f.calls.indexOf("signout")).toBeLessThan(f.calls.indexOf("cloud"));
  expect(f.calls.indexOf("mirror")).toBeLessThan(f.calls.indexOf("flush"));
  expect(f.calls.at(-1)).toBe("flush");
  expect(f.calls).toContain("terminal-account");
});
it("reports an unsuccessful credential removal rather than claiming a complete reset", async () => {
  f.remove.mockResolvedValue({ ok: false, error: "Vault unavailable" });
  await expect(unpairTerminal()).rejects.toThrow("Vault unavailable");
  expect(f.flush).not.toHaveBeenCalled();
});
it("waits for Electron's identity deletion and reports its failure", async () => {
  f.clear.mockResolvedValue({ ok: false });
  await expect(unpairTerminal()).rejects.toThrow("Could not clear the saved terminal registration");
  expect(f.flush).not.toHaveBeenCalled();
});

it("sends the real version and distinguishes successful synchronization from presence", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  await stampHeartbeat(id, { version: "1.4.77-beta.2", synced: true });
  expect(f.rpc).toHaveBeenLastCalledWith("terminal_token_heartbeat", expect.objectContaining({ p_token_id: id, p_version: "1.4.77-beta.2", p_synced: true, p_proof_hash: "proof-hash" }));
  await stampHeartbeat(id);
  expect(f.rpc).toHaveBeenLastCalledWith("terminal_token_heartbeat", expect.objectContaining({ p_synced: false, p_version: expect.any(String) }));
});
