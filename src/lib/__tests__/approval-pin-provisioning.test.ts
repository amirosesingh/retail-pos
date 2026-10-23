import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rest:vi.fn(),rpc:vi.fn() }));
vi.mock("@/core/api/pos-relay.server", () => ({serviceRest:mocks.rest}));
vi.mock("../pos-rules.server", () => ({rpc:mocks.rpc}));
import { setUserAuthorizationPin } from "../authorization.server";
beforeEach(() => {vi.clearAllMocks(); mocks.rpc.mockResolvedValue(true);});
it("sets a PIN for an active user without requiring an approval assignment", async () => {
 mocks.rest.mockResolvedValue(Response.json([{user_id:"staff",is_active:true,role:"staff"}]));
 await setUserAuthorizationPin("staff","123456","owner");
 expect(mocks.rpc).toHaveBeenCalledWith("set_authorization_pin",{p_user_id:"staff",p_pin:"123456",p_updated_by:"owner"});
 expect(mocks.rest).toHaveBeenCalledTimes(1);
});
it("rejects inactive accounts without writing a credential", async () => {
 mocks.rest.mockResolvedValue(Response.json([{user_id:"staff",is_active:false}]));
 await expect(setUserAuthorizationPin("staff","123456","owner")).rejects.toThrow("Activate");
 expect(mocks.rpc).not.toHaveBeenCalled();
});
