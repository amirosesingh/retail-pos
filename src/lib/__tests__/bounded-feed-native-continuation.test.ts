import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const { CloudClient } = require("../../../electron/sync/cloud-client.cjs");
const { PullWorker } = require("../../../electron/sync/pull-worker.cjs");
const client = () => new CloudClient({configStore:{get:()=>"https://fixture.invalid"},terminalStore:{read:()=>({tokenId:"fixture",deviceBindingProof:"a".repeat(64)})}});
const scoped = {"X-POS-Scoped-History-Transport":"1"};
const headers = {...scoped,"X-POS-Feed-Projection":"1","X-POS-Feed-Continue":"1"};
const change = (cursor:number,tombstone=false) => ({cursor,table_name:"products",entity_id:JSON.stringify({id:String(cursor)}),row_data:{id:String(cursor)},tombstone});
function response(body:unknown, h:Record<string,string>={},status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json",...h}});}
afterEach(()=>vi.unstubAllGlobals());
describe("Main-private bounded feed continuation",()=>{
 it("binds continuation to successful actual normalized arrays, preserving tombstones and requests",async()=>{
  const fetcher=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>response([change(1),change(2,true)],headers));vi.stubGlobal("fetch",fetcher);
  const result=await client().pullBatch({branchId:"branch",cursor:0,limit:100});
  expect(result).toMatchObject({count:2,cursor:2,continuation:true});expect(result.rows).toHaveLength(1);expect(result.tombstones).toHaveLength(1);
  expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string).sqlServerScopedHistory).toEqual({action:"feed",organizationId:"default",branchId:"branch",cursor:0,limit:100});
 });
 it("does not trust body flags, copied arrays or legacy responses",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>response([change(1)])));
  await expect(client().pullBatch({branchId:"b",cursor:0,limit:100})).rejects.toMatchObject({code:"EHISTORY_INDEX_PROTOCOL"});
  const c=client();c.request=async()=>Object.assign([change(1)],{continuation:true});
  expect(await c.pullBatch({branchId:"b",cursor:0,limit:100})).not.toHaveProperty("continuation");
 });
 it.each([
  {"X-POS-Feed-Projection":"2","X-POS-Feed-Continue":"1"},
  {"X-POS-Feed-Projection":"1"}, {"X-POS-Feed-Continue":"1"},
  {"X-POS-Feed-Projection":"1","X-POS-Feed-Continue":"true"},
 ])("rejects malformed declared capability %j",async h=>{
  vi.stubGlobal("fetch",vi.fn(async()=>response([change(1)],{...scoped,...h} as Record<string,string>)));
  await expect(client().pullBatch({branchId:"b",cursor:0,limit:100})).rejects.toMatchObject({code:"EFEED_PROTOCOL"});
 });
 it("rejects empty continuing pages and nonarray envelopes, but accepts final empty pages",async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(response([],headers)).mockResolvedValueOnce(response({rows:[],continuation:true},headers)).mockResolvedValueOnce(response([],{...headers,"X-POS-Feed-Continue":"0"}));vi.stubGlobal("fetch",fetcher);
  const c=client();await expect(c.pullBatch({branchId:"b",cursor:7,limit:100})).rejects.toMatchObject({code:"EFEED_PROTOCOL"});await expect(c.pullBatch({branchId:"b",cursor:7,limit:100})).rejects.toMatchObject({code:"EFEED_PROTOCOL"});expect(await c.pullBatch({branchId:"b",cursor:7,limit:100})).toMatchObject({count:0,cursor:7,continuation:false});
 });
 it("does not fall back when an older Worker does not recognize the new read",async()=>{
  const fetcher=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>response({ok:false,error:"Nothing to do"},{},400));
  vi.stubGlobal("fetch",fetcher);
  const c=client();
  await expect(c.pullBatch({branchId:"b",cursor:0,limit:100})).rejects.toMatchObject({code:"HTTP_400",status:400});
  await expect(c.counts({branchId:"b"})).rejects.toMatchObject({code:"HTTP_400",status:400});
  expect(fetcher).toHaveBeenCalledTimes(2);
  const requests=fetcher.mock.calls.map(([,init])=>JSON.parse(String(init!.body)));
  expect(requests.map(body=>body.sqlServerScopedHistory.action)).toEqual(["feed","counts"]);
  for(const body of requests){
   expect(body).not.toHaveProperty("sqlServerPull");
   expect(body).not.toHaveProperty("sqlServerCounts");
  }
 });
 it("keeps HTTP authorization failure authoritative and ignores feed headers on other operations",async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(response({error:"denied",code:"SYNC_BRANCH_FORBIDDEN"},headers,403)).mockResolvedValueOnce(response({ok:true},headers));vi.stubGlobal("fetch",fetcher);
  const c=client();await expect(c.pullBatch({branchId:"b",cursor:0,limit:100})).rejects.toMatchObject({code:"SYNC_BRANCH_FORBIDDEN",status:403});expect(await c.counts({branchId:"b"})).toEqual({ok:true});
 });
});
function harness(){
 let cursor=0;const saves:number[]=[];const applied:number[]=[];
 class Transaction {async begin(){} async commit(){} async rollback(){}}
 const cloud=client();cloud.applyLocalBatch=vi.fn(async(_t:unknown,_table:unknown,b:{rows:ReturnType<typeof change>[];tombstones:ReturnType<typeof change>[]})=>{applied.push(...[...b.rows,...b.tombstones].map(x=>x.cursor));});
 const checkpoints={get:async()=>({committed_cursor:cursor}),save:vi.fn(async(_b:string,_t:string,_d:string,p:{committed_cursor:number})=>{cursor=p.committed_cursor;saves.push(cursor);})};
 const worker=new PullWorker({cloud,checkpoints,connectionManager:{sql:()=>({Transaction,ISOLATION_LEVEL:{SERIALIZABLE:4}}),pool:{}},registry:{tables:[{cloudTable:"products",dependencyOrder:1}]},reader:{unacknowledged:async()=>[]}});
 return {worker,cloud,checkpoints,saves,applied};
}
describe("bounded feed prefix replay and completion",()=>{
 it("continues short protected prefixes without omissions including tombstones",async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(response([change(1)],headers)).mockResolvedValueOnce(response([change(2,true)],headers)).mockResolvedValueOnce(response([change(3)],{...headers,"X-POS-Feed-Continue":"0"}));vi.stubGlobal("fetch",fetcher);
  const h=harness();expect(await h.worker.run({branchId:"b",skipMembership:true})).toMatchObject({merged:3});expect(h.applied).toEqual([1,2,3]);expect(h.saves).toEqual([1,2,3]);expect(fetcher).toHaveBeenCalledTimes(3);
 });
 it("retains committed prefix on a failed next page and resumes exactly there",async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(response([change(1)],headers)).mockRejectedValueOnce(Error("offline")).mockResolvedValueOnce(response([change(2)],{...headers,"X-POS-Feed-Continue":"0"}));vi.stubGlobal("fetch",fetcher);
  const h=harness();await expect(h.worker.run({branchId:"b",skipMembership:true})).rejects.toThrow("offline");expect(h.saves).toEqual([1]);await h.worker.run({branchId:"b",skipMembership:true});expect(h.applied).toEqual([1,2]);expect(JSON.parse(fetcher.mock.calls[2][1]!.body as string).sqlServerScopedHistory.cursor).toBe(1);
 });
 it.each([{rows:[change(0)]},{rows:[change(1),change(1,true)]},{rows:[change(Number.MAX_SAFE_INTEGER+1)]},{rows:[change(2),change(1),change(3)]}])("refuses invalid final attested cursors without advancing a checkpoint",async ({rows})=>{
  vi.stubGlobal("fetch",vi.fn(async()=>response(rows,{...headers,"X-POS-Feed-Continue":"0"})));const h=harness();await expect(h.worker.run({branchId:"b",skipMembership:true})).rejects.toMatchObject({code:"ESYNC_CURSOR"});expect(h.saves).toEqual([]);expect(h.applied).toEqual([]);
 });
 it("accepts a final empty attested page without checkpoint movement",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>response([],{...headers,"X-POS-Feed-Continue":"0"})));const h=harness();await h.worker.run({branchId:"b",skipMembership:true});expect(h.saves).toEqual([]);expect(h.applied).toEqual([]);
 });
 it("rejects a legacy page without applying it, saving its cursor or retrying an older route",async()=>{
  const fetcher=vi.fn(async()=>response([change(1)]));vi.stubGlobal("fetch",fetcher);const h=harness();
  await expect(h.worker.run({branchId:"b",skipMembership:true})).rejects.toMatchObject({code:"EHISTORY_INDEX_PROTOCOL"});
  expect(fetcher).toHaveBeenCalledTimes(1);expect(h.saves).toEqual([]);expect(h.applied).toEqual([]);
 });
 it.each([{rows:[change(0)]},{rows:[change(1),change(1,true)]},{rows:[change(Number.MAX_SAFE_INTEGER+1)]},{rows:[change(2),change(1),change(3)]}])("refuses unsafe continuing cursors before applying or checkpointing",async ({rows})=>{
  vi.stubGlobal("fetch",vi.fn(async()=>response(rows,headers)));const h=harness();await expect(h.worker.run({branchId:"b",skipMembership:true})).rejects.toMatchObject({code:"ESYNC_CURSOR"});expect(h.saves).toEqual([]);expect(h.applied).toEqual([]);
 });
});
