import { beforeEach, expect, it, vi } from "vitest";
const f=vi.hoisted(() => ({ signOut:vi.fn(), credentials:vi.fn(), operator:vi.fn(), secret:vi.fn(), branch:vi.fn(), approval:vi.fn(), remove:vi.fn() }));
vi.mock("@/integrations/supabase/external-client",()=>({supabaseExternal:{auth:{signOut:f.signOut}}}));
vi.mock("@/lib/pos-credentials",()=>({clearStoredCredentials:f.credentials}));
vi.mock("@/lib/operator-auth-identity",()=>({clearOperatorIdentity:f.operator}));
vi.mock("@/lib/device-secrets",()=>({clearDeviceSecret:f.secret}));
vi.mock("@/lib/active-branch",()=>({clearTerminalBranchBinding:f.branch}));
vi.mock("@/platform-config/approval-token-client",()=>({clearApprovalToken:f.approval}));
import { resetMobileRegistrationIdentity } from "../mobile-registration-identity";
beforeEach(()=>{vi.clearAllMocks(); f.signOut.mockResolvedValue({error:null}); vi.stubGlobal("window",{sessionStorage:{removeItem:f.remove}});});
it("ends the old tenant session and removes operator, cashier, machine and token credentials",async()=>{
 await resetMobileRegistrationIdentity(true);
 expect(f.signOut).toHaveBeenCalledWith({scope:"local"});
 expect(f.credentials).toHaveBeenCalledOnce(); expect(f.operator).toHaveBeenCalledOnce();
 expect(f.secret).toHaveBeenCalledWith("terminal-account"); expect(f.approval).toHaveBeenCalledWith(true);
 expect(f.remove).toHaveBeenCalledWith("pos-terminal-user-v1"); expect(f.branch).toHaveBeenCalledOnce();
});
it("fresh activation does not access an unconfigured Auth client",async()=>{
 await resetMobileRegistrationIdentity(false);
 expect(f.signOut).not.toHaveBeenCalled(); expect(f.credentials).toHaveBeenCalledOnce();
});
it("does not silently proceed when the old Auth session cannot be removed",async()=>{
 f.signOut.mockResolvedValue({error:new Error("storage error")});
 await expect(resetMobileRegistrationIdentity(true)).rejects.toThrow("storage error");
 expect(f.branch).not.toHaveBeenCalled();
});
