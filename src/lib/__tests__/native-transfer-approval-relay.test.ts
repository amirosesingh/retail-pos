import { beforeEach, describe, expect, it, vi } from "vitest";
const fetchMock = vi.fn();
vi.stubGlobal("fetch",fetchMock);
vi.mock("@/lib/external-supabase-config",()=>({supabaseConfig:()=>({url:"https://example.test",key:"k"}),runtimeEnvValue:()=>"service-key"}));
import { runRelayRpc } from "@/core/api/pos-relay.server";
import type { RelayScope } from "@/core/api/relay-policy.server";
const scope:RelayScope={kind:"cashier",label:"Till",storeId:"A",role:"staff",roleSlug:"cashier",permissions:{can_approve_transfer:true},isSupervisor:false,staffUserId:"verified",actorName:"Verified"};
const op={kind:"rpc" as const,table:"stock_transfers",fn:"stock_transfer_approve",args:{p_transfer_id:"t",p_staff_user_id:"forged",p_bound_store_id:"B",p_approved_by:"Administrator",p_lines:[{product_id:"p",qty:2}]}};
const json=(body:unknown)=>new Response(JSON.stringify(body),{status:200,headers:{"content-type":"application/json"}});
beforeEach(()=>fetchMock.mockReset());
describe("native transfer approval relay",()=>{
 it("passes only verified staff and server-proven branch to the service-only RPC",async()=>{
  fetchMock.mockResolvedValueOnce(json([{from_store_id:"A"}])).mockResolvedValueOnce(json(null));
  expect(await runRelayRpc(op,scope)).toEqual({ok:true});
  const [url,init]=fetchMock.mock.calls[1];
  expect(url).toContain("rpc/stock_transfer_approve_for_staff");
  expect(JSON.parse(init.body)).toEqual({p_transfer_id:"t",p_staff_user_id:"verified",p_bound_store_id:"A",p_lines:op.args.p_lines});
 });
 it("refuses a branch mismatch without calling the approval RPC",async()=>{
  fetchMock.mockResolvedValueOnce(json([{from_store_id:"B"}]));
  expect((await runRelayRpc(op,scope)).code).toBe("STORE_FORBIDDEN");
  expect(fetchMock).toHaveBeenCalledTimes(1);
 });
 it("refuses terminal-only and stale staff sessions",async()=>{
  for(const invalid of [{...scope,kind:"terminal" as const},{...scope,stale:true},{...scope,staffUserId:null}]){
   fetchMock.mockReset().mockResolvedValueOnce(json([{from_store_id:"A"}]));
   expect((await runRelayRpc(op,invalid)).code).toBe("PERMISSION_DENIED");
   expect(fetchMock).toHaveBeenCalledTimes(1);
  }
 });
});
