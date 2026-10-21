import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ scope: vi.fn(), verify: vi.fn(), set: vi.fn(), offline: vi.fn(), log: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => ({ validator: (parse: (v: unknown) => unknown) => ({ handler: (fn: (v: {data: unknown}) => unknown) => (v: {data: unknown}) => fn({data: parse(v.data)}) }) }) }));
vi.mock("@/core/api/pos-relay.server", () => ({verifyRelayCaller: mocks.verify}));
vi.mock("@/core/api/relay-policy.server", () => ({resolveRelayScope: mocks.scope}));
vi.mock("../authorization.server", () => ({setUserAuthorizationPin: mocks.set, setUserOfflineLoginPin:mocks.offline, writeLog: mocks.log}));
import { setStaffAuthorizationPin } from "../authorization.functions";
beforeEach(() => { vi.clearAllMocks(); mocks.verify.mockResolvedValue({authUserId:"actor"}); mocks.log.mockResolvedValue({ok:true}); });
it.each(["manager","supervisor","cashier"])("rejects %s even with staff/settings permission", async role => {
 mocks.scope.mockResolvedValue({roleSlug:role, permissions:{can_manage_staff:true,can_access_pos_settings:true}});
 expect(await setStaffAuthorizationPin({data:{userId:"target",pin:"123456"}})).toMatchObject({ok:false});
 expect(mocks.set).not.toHaveBeenCalled();
});
it("allows an administrator to set another user's PIN and attributes the audit", async () => {
 mocks.scope.mockResolvedValue({roleSlug:"admin",staffUserId:"owner",permissions:{}});
 expect(await setStaffAuthorizationPin({data:{userId:"target",pin:"123456"}})).toMatchObject({ok:true});
 expect(mocks.set).toHaveBeenCalledWith("target","123456","owner");
 expect(mocks.log.mock.calls[0][0]).toMatchObject({authorizedBy:"owner",detail:{target:"target"}});
});

it("routes the separate offline PIN to its own storage",async()=>{
 mocks.scope.mockResolvedValue({role:"admin",roleSlug:"owner",staffUserId:"owner",permissions:{}});
 expect(await setStaffAuthorizationPin({data:{userId:"target",pin:"123456",purpose:"offline_login"}})).toMatchObject({ok:true});
 expect(mocks.offline).toHaveBeenCalledWith("target","123456"); expect(mocks.set).not.toHaveBeenCalled();
});
