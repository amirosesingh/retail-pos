import {createRequire} from "node:module";
import {afterEach,beforeEach,describe,it,expect,vi} from "vitest";
const {createTransferCentralHandoff}=createRequire(import.meta.url)("../../../electron/transfer-central-handoff.cjs");
const mocks=vi.hoisted(()=>({bridge:null as Record<string,unknown>|null,relay:vi.fn(),prepare:vi.fn(),state:vi.fn()}));
vi.mock("@/platform-config/platform",()=>({isTerminalApp:()=>true}));
vi.mock("@/core/local-db/local-db",()=>({localDb:()=>mocks.bridge}));
vi.mock("@/core/api/sync-relay",()=>({relayOp:mocks.relay,relayTransferRequestApprovalState:vi.fn()}));
vi.mock("@/core/api/pos-db",()=>({commitOps:vi.fn(),stableChildId:vi.fn()}));
vi.mock("@/core/api/db-query",()=>({routedQuery:vi.fn()}));
vi.mock("@/integrations/supabase/external-client",()=>({supabaseExternal:{rpc:vi.fn()},authenticatedExternalClientSnapshot:vi.fn()}));
import {approveTransferInDb,receiveTransferInDb,verifyTransferInDb} from "../stock-transfers";
const id="11111111-1111-4111-8111-111111111111";
function fixture(){
 let epoch=1;const row={id,from_store_id:"A",to_store_id:"B",row_version:2};
 const read=vi.fn(async()=>({...row})),upload=vi.fn(async()=>({ok:true,pending:0,failed:0})),capture=vi.fn((permission:string)=>{const expected=epoch;return{branchId:"A",permission,assertCurrent:()=>{if(expected!==epoch)throw Error("context changed");}};});
 return{row,read,upload,capture,change:()=>epoch++,run:createTransferCentralHandoff({captureScope:capture,readTransfer:read,uploadPending:upload})};
}
describe("existing native upload barrier before central transfer authority",()=>{
 it("verifies a sender's upload receipts before approving or dispatching",async()=>{
  const f=fixture();expect(await f.run({transferId:id,stage:"approve"})).toEqual({ok:true,transferId:id,stage:"approve"});expect(f.capture).toHaveBeenCalledWith("can_approve_transfer");expect(f.upload).toHaveBeenCalledWith("A");expect(f.read).toHaveBeenCalledTimes(2);
 });
 it.each(["receive","verify"])("requires the receiving branch for %s",async stage=>{
  const f=fixture();await expect(f.run({transferId:id,stage})).rejects.toMatchObject({code:"STORE_FORBIDDEN"});expect(f.upload).not.toHaveBeenCalled();
  f.row.to_store_id="A";await expect(f.run({transferId:id,stage})).resolves.toMatchObject({ok:true});expect(f.capture).toHaveBeenLastCalledWith("can_receive_transfer");
 });
 it.each([{ok:true,pending:1,failed:0},{ok:true,pending:0,failed:1},{ok:false,pending:0,failed:0},{ok:true}])("never treats incomplete upload evidence as a handoff: %j",async result=>{
  const f=fixture();f.upload.mockResolvedValueOnce(result as never);await expect(f.run({transferId:id,stage:"dispatch"})).rejects.toMatchObject({code:"TRANSFER_UPLOAD_PENDING"});
 });
 it("rejects a changed current identity or transfer while awaiting synchronization",async()=>{
  const f=fixture();f.upload.mockImplementationOnce(async()=>{f.change();return{ok:true,pending:0,failed:0};});await expect(f.run({transferId:id,stage:"dispatch"})).rejects.toThrow("context changed");
  const changed=fixture();changed.upload.mockImplementationOnce(async()=>{changed.row.row_version++;return{ok:true,pending:0,failed:0};});await expect(changed.run({transferId:id,stage:"dispatch"})).rejects.toMatchObject({code:"TRANSFER_UPLOAD_PENDING"});
 });
});
describe("transfer client routes",()=>{
 beforeEach(()=>{vi.resetAllMocks();mocks.state.mockResolvedValue({enabled:true,configured:true,connected:true,tradingReady:true,state:"ready"});mocks.bridge={database:{getState:mocks.state},prepareCentralTransfer:mocks.prepare};mocks.prepare.mockImplementation(async({transferId,stage})=>({ok:true,transferId,stage}));mocks.relay.mockResolvedValue({ok:true});});
 afterEach(()=>vi.unstubAllGlobals());
 it.each(["approve","receive","verify"])("runs the verified native handoff before submitting %s centrally",async stage=>{
  const result=stage==="approve"?await approveTransferInDb(id,"staff"):stage==="receive"?await receiveTransferInDb(id,"staff"):await verifyTransferInDb(id,"staff",[]);
  expect(result.success).toBe(true);expect(mocks.prepare).toHaveBeenCalledExactlyOnceWith({transferId:id,stage});expect(mocks.prepare.mock.invocationCallOrder[0]).toBeLessThan(mocks.relay.mock.invocationCallOrder[0]);
 });
 it("uses the central route when local SQL is explicitly disabled",async()=>{
  mocks.state.mockResolvedValue({enabled:false,connected:false});await expect(receiveTransferInDb(id,"staff")).resolves.toMatchObject({success:true});expect(mocks.prepare).not.toHaveBeenCalled();expect(mocks.relay).toHaveBeenCalledOnce();
 });
 it("does not call either writer when local readiness is unknown",async()=>{
  mocks.state.mockRejectedValue(Error("SQL unreadable"));await expect(receiveTransferInDb(id,"staff")).resolves.toMatchObject({success:false});expect(mocks.prepare).not.toHaveBeenCalled();expect(mocks.relay).not.toHaveBeenCalled();
 });
 it("makes the online-only final stage explicit while keeping the local draft",async()=>{
  vi.stubGlobal("navigator",{onLine:false});const result=await receiveTransferInDb(id,"staff");expect(result.success).toBe(false);expect(result.error).toContain("connection to head office");expect(mocks.prepare).not.toHaveBeenCalled();expect(mocks.relay).not.toHaveBeenCalled();
 });
 it("preserves an upload refusal without submitting a central mutation",async()=>{
  mocks.prepare.mockResolvedValue({ok:false,code:"TRANSFER_UPLOAD_PENDING",error:"Keep the saved draft"});await expect(receiveTransferInDb(id,"staff")).resolves.toMatchObject({success:false});expect(mocks.relay).not.toHaveBeenCalled();
 });
});
