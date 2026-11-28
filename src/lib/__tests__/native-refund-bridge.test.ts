import {beforeEach,describe,it,expect,vi} from "vitest";
const fixture=vi.hoisted(()=>({bridge:null as Record<string,unknown>|null,state:vi.fn(),save:vi.fn()}));
vi.mock("@/core/local-db/local-db",()=>({localDb:()=>fixture.bridge}));
vi.mock("@/core/activation/terminal-tokens",()=>({readTerminalConfig:()=>({tokenId:"sealed-terminal"})}));
import {authorizeNativeRefund} from "@/core/local-db/local-staff";
const input={saleId:"11111111-1111-4111-8111-111111111111",branchId:"A",requestedAmount:12.30};
describe("native refund canonical storage routing",()=>{
 beforeEach(()=>{vi.resetAllMocks();fixture.state.mockResolvedValue({enabled:true,configured:true,connected:true,tradingReady:true,state:"ready"});fixture.save.mockResolvedValue({ok:true,grantToken:"opaque"});fixture.bridge={database:{getState:fixture.state},authorizeRefund:fixture.save};});
 it("uses the ready local writer and sealed registration",async()=>{
  await expect(authorizeNativeRefund(input)).resolves.toMatchObject({ok:true});expect(fixture.save).toHaveBeenCalledExactlyOnceWith({...input,registeredTerminalId:"sealed-terminal"});
 });
 it("keeps the existing central route when SQL is positively disabled",async()=>{
  fixture.state.mockResolvedValue({enabled:false,connected:false});await expect(authorizeNativeRefund(input)).resolves.toMatchObject({ok:false,code:"EONLINE_REQUIRED"});expect(fixture.save).not.toHaveBeenCalled();
 });
 it("does not reinterpret unreadable or incomplete SQL as an online authorization",async()=>{
  fixture.state.mockRejectedValueOnce(Error("unreadable"));await expect(authorizeNativeRefund(input)).resolves.toMatchObject({ok:false,code:"ELOCAL_STATE_UNVERIFIED"});expect(fixture.save).not.toHaveBeenCalled();
 });
 it("preserves a real Main denial without alternate verification",async()=>{
  fixture.save.mockResolvedValue({ok:false,code:"EAPPROVAL_DENIED",error:"denied"});await expect(authorizeNativeRefund(input)).resolves.toEqual({ok:false,code:"EAPPROVAL_DENIED",error:"denied"});expect(fixture.save).toHaveBeenCalledOnce();
 });
});
