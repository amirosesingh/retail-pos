import { afterEach, beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ calls: [] as string[], rpc: vi.fn(), clear: vi.fn(), remove: vi.fn(), flush: vi.fn(), save: vi.fn(), reset: vi.fn(), platform: "ios", branch: "new-branch", failClaim: false }));
vi.mock("@/integrations/supabase/external-client", () => ({
  resetExternalClient: vi.fn(), createTenantClient: () => ({ rpc: f.rpc }),
  supabaseExternal: { rpc: f.rpc, auth: { signOut: async () => { f.calls.push("signout"); } } },
}));
vi.mock("@/core/activation/device-proof", () => ({ deviceProofHash: async () => "proof-hash" }));
vi.mock("@/lib/device-secrets", () => ({ getDeviceSecret: vi.fn(), setDeviceSecret: f.save, clearDeviceSecret: (key: string) => f.calls.push(key) }));
vi.mock("@/lib/secure-cloud-config", () => ({ removeCloudCredentials: f.remove }));
vi.mock("@/lib/backend-config", () => ({ backendUrl: async () => "https://old.example", saveBackendUrl: async () => { f.calls.push("backend"); return { ok: true }; } }));
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

vi.mock("@/core/activation/terminal-platform", () => ({
 terminalRuntimePlatform: () => f.platform, tokenPlatformForRuntime: () => "mobile", canRuntimeClaimToken: () => true,
}));
vi.mock("@/lib/terminal-crypto", () => ({ isEncryptedV1: () => true, decryptActivationV1: async () => ({pairToken:"new-token",supabaseUrl:"https://new.example",supabaseAnonKey:"public-key", platform:"mobile"}) }));
vi.mock("../mobile-registration-identity", () => ({ resetMobileRegistrationIdentity: f.reset }));
vi.mock("@/lib/terminal-session", () => ({ provisionTerminalAccount: vi.fn() }));
import { activateTerminal, writeTerminalConfig, readTerminalConfig } from "../terminal-tokens";
beforeEach(() => {
 f.calls.length=0; f.failClaim=false; f.branch="new-branch";
 f.save.mockReset().mockResolvedValue(undefined); f.reset.mockReset().mockResolvedValue(undefined); f.flush.mockReset().mockResolvedValue(undefined);
 const storage = new Map<string,string>();
 vi.stubGlobal("window", { localStorage: { getItem: (k:string) => storage.get(k), setItem: (k:string,v:string) => storage.set(k,v), removeItem: (k:string) => storage.delete(k) }, dispatchEvent: vi.fn() });
 f.rpc.mockReset().mockImplementation(async (name:string) => {
  if(name==="terminal_token_status") return {data:[{status:"active",location_id:f.branch,location_name:f.branch ? "New branch" : "All branches — management"}],error:null};
  if(name==="terminal_token_claim") return {data:!f.failClaim,error:f.failClaim ? {message:"TERMINAL_TOKEN_REVOKED"} : null};
  return {data:true,error:null};
 });
 writeTerminalConfig({tokenId:"old-token",deviceType:"mobile",deviceUse:"operations",locationId:"old-branch",locationName:"Old",supabaseUrl:"https://old.example",supabaseKey:"public-old",activatedAt:"old"});
});
afterEach(() => vi.unstubAllGlobals());
it.each(["android","ios"])("replaces the branch on %s only after validation and durable storage",async platform => {
 f.platform=platform;
 const result=await activateTerminal("code");
 expect(result.locationId).toBe("new-branch");
 expect(readTerminalConfig()?.tokenId).toBe("new-token");
 expect(f.reset).toHaveBeenCalledOnce(); expect(f.flush).toHaveBeenCalledOnce();
 expect(f.save.mock.invocationCallOrder.at(-1)).toBeLessThan(f.reset.mock.invocationCallOrder[0]);
});
it("switches mobile registration to branchless Management",async () => {
 f.branch="";
 const result=await activateTerminal("code");
 expect(result.deviceUse).toBe("management"); expect(result.locationId).toBe("");
});
it("preserves the existing registration and session when the claim is rejected",async () => {
 f.failClaim=true;
 await expect(activateTerminal("code")).rejects.toThrow("revoked");
 expect(readTerminalConfig()?.tokenId).toBe("old-token"); expect(f.reset).not.toHaveBeenCalled();
});
it("restores the old registration when saving the replacement fails",async () => {
 f.save.mockRejectedValueOnce(new Error("vault unavailable")).mockResolvedValue(undefined);
 await expect(activateTerminal("code")).rejects.toThrow("vault unavailable");
 expect(readTerminalConfig()?.tokenId).toBe("old-token"); expect(f.reset).not.toHaveBeenCalled();
 expect(f.save).toHaveBeenLastCalledWith("terminal.config",expect.objectContaining({tokenId:"old-token"}));
});
