import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";
const require=createRequire(import.meta.url);
const {CloudClient}=require("../../../electron/sync/cloud-client.cjs");
vi.mock("../external-supabase-config",()=>({runtimeEnvValue:()=>"test-service",supabaseConfig:()=>({url:"https://cloud.test",key:"test-public"})}));
vi.mock("../commerce-sync-readiness.server",()=>({commerceSyncIsolationReady:async()=>true}));
import {handleSyncRequest} from "../sync-endpoint.server";
const id="00000000-0000-4000-8000-000000000001";
const branch="00000000-0000-4000-8000-00000000000a";
const other="00000000-0000-4000-8000-00000000000b";
const proof="a".repeat(64);
let registryStatus=200;
let active=true;
let requestBody:Record<string,unknown>;
const rpc=vi.fn();
beforeEach(()=>{
 registryStatus=200;active=true;rpc.mockClear();
 vi.stubGlobal("fetch",vi.fn(async(url:string,options?:RequestInit)=>{
  if(url.startsWith("https://pos.test/")) {
   requestBody=JSON.parse(String(options?.body));
   return handleSyncRequest(new Request(url,options));
  }
  if(url.includes("/terminal_tokens?"))return Response.json([{id,platform:"pc",status:active?"used":"revoked",location_id:branch,is_claimed:true,claim_proof:proof}],{status:registryStatus});
  if(url.includes("/stores?"))return Response.json([{id:branch}]);
  if(url.includes("/rpc/")){rpc(url,JSON.parse(String(options?.body)));return Response.json([]);}
  throw new Error(`Unexpected isolated request: ${url}`);
 }));
});
function client(bindingProof:string|undefined=proof) {
 return new CloudClient({configStore:{get:()=>"https://pos.test"},terminalStore:{read:()=>({tokenId:id,deviceUse:"operations",locationId:branch,deviceBindingProof:bindingProof,deviceClaimProof:"must-not-leave-operations"})}});
}
describe("real Operations CloudClient through sync authorization",()=>{
 it.each(["bootstrap","pull","push"])("preserves sealed proof and branch in ordinary %s",async action=>{
  const cloud=client();
  if(action==="bootstrap")await cloud.bootstrapPage({table:"products",branchId:branch,historyDays:90,limit:10});
  else if(action==="pull")await cloud.pullBatch({branchId:branch,cursor:0,limit:10});
  else await cloud.pushBatch({batchId:"00000000-0000-4000-8000-000000000002",branchId:branch,table:"sales",rows:[],changes:[]});
  expect(requestBody).toMatchObject({terminalToken:id,deviceBindingProof:proof});
  expect(requestBody).not.toHaveProperty("deviceClaimProof");
  expect(rpc).toHaveBeenCalledWith(expect.any(String),expect.objectContaining({p_branch_id:branch,p_terminal_id:id}));
 });
 it("denies a foreign branch before a synchronization RPC",async()=>{
  await expect(client().bootstrapPage({table:"sales",branchId:other,historyDays:90,limit:10})).rejects.toMatchObject({status:403,code:"STORE_FORBIDDEN"});
  expect(rpc).not.toHaveBeenCalled();
 });
 it("denies missing/wrong proof and revoked activation",async()=>{
  await expect(client("").pullBatch({branchId:branch,cursor:0,limit:10})).rejects.toMatchObject({status:400});
  await expect(client("b".repeat(64)).pullBatch({branchId:branch,cursor:0,limit:10})).rejects.toMatchObject({status:401});
  active=false;await expect(client().pullBatch({branchId:branch,cursor:0,limit:10})).rejects.toMatchObject({status:401});
  expect(rpc).not.toHaveBeenCalled();
 });
 it("reports temporary registry outage without session revocation",async()=>{
  registryStatus=503;
  await expect(client().pullBatch({branchId:branch,cursor:0,limit:10})).rejects.toMatchObject({status:503,code:"SERVICE_UNAVAILABLE"});
  expect(rpc).not.toHaveBeenCalled();
 });
});
