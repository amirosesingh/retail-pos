import {describe,it,expect,vi,beforeEach} from "vitest";
const h=vi.hoisted(()=>({verify:vi.fn()}));
vi.mock("@/core/api/pos-relay.server",()=>({hasServiceKey:()=>true,verifyRelayCaller:h.verify,serviceRest:vi.fn()}));
import {verifySessionServer} from "../session-verify.server";
beforeEach(()=>vi.clearAllMocks());
describe("activation failure session recovery",()=>{
 it("preserves a typed unavailable state during a registry outage",async()=>{
  h.verify.mockRejectedValue(Object.assign(new Error("Registry temporarily unavailable"),{status:503}));
  expect(await verifySessionServer({terminalToken:"terminal",deviceBindingProof:"a".repeat(64)})).toEqual({ok:false,reason:"unavailable"});
 });
 it("refuses an authoritatively revoked registration",async()=>{
  h.verify.mockRejectedValue(Object.assign(new Error("Activation revoked"),{status:401}));
  expect(await verifySessionServer({terminalToken:"terminal"})).toEqual({ok:false,reason:"revoked"});
 });
});
