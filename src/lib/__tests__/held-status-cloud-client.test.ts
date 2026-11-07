import {afterEach,describe,expect,it,vi} from 'vitest';
const {CloudClient}=require('../../../electron/sync/cloud-client.cjs');
const id=(n:number)=>'aaaaaaaa-aaaa-4aaa-8aaa-'+String(n).padStart(12,'0'),branch=id(1),terminal=id(2);
const ticket={id:'held-ticket',billNo:'STR1-0001',shiftId:id(3)};
function fixture(mode='operations'){
 const state={config:{tokenId:terminal,deviceUse:mode,locationId:mode==='operations'?branch:null,deviceBindingProof:'a'.repeat(64)}};
 const client=new CloudClient({connectionManager:{pool:{}},configStore:{get:()=> 'https://owned.invalid'},terminalStore:{read:()=>state.config}});
 return{client,state};
}
afterEach(()=>vi.unstubAllGlobals());
describe('bounded held-status transport uses the existing native request lane',()=>{
 it('sends exact registered tickets and retains identity JSON, versions and timestamps as text',async()=>{
  const reply={ok:true,heldStatusVersion:1,organizationId:'default',branchId:branch,terminalId:terminal,records:[{id:ticket.id,status:'completed',proofFrom:'held',rowVersion:'9007199254740993',updatedAt:'2026-11-07T01:02:03.1234567Z',identityJson:'{"total":9007199254740993.1234567}',parent:null}]};
  const fetch=vi.fn(async(_url:string,_init:RequestInit)=>Response.json(reply));vi.stubGlobal('fetch',fetch);
  expect(await fixture().client.heldStatuses({branchId:branch,tickets:[ticket]})).toEqual(reply);
  expect(fetch).toHaveBeenCalledOnce();
  expect(JSON.parse(String(fetch.mock.calls[0]![1].body))).toEqual({sqlServerHeldStatus:{organizationId:'default',branchId:branch,tickets:[ticket]},terminalToken:terminal,deviceBindingProof:'a'.repeat(64)});
 });
 it('keeps absent-held accepted-parent evidence distinct without assigning sale revisions to the ticket',async()=>{
  const record={id:ticket.id,status:'completed',proofFrom:'accepted_parent',rowVersion:null,updatedAt:null,identityJson:null,parent:{kind:'sale',id:id(4),storeId:branch,billNo:ticket.billNo,shiftId:ticket.shiftId}};
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({ok:true,records:[record]})));
  expect((await fixture().client.heldStatuses({branchId:branch,tickets:[ticket]})).records).toEqual([record]);
 });
 it.each([[],Array(101).fill(ticket),[ticket,ticket],[{...ticket,branchId:branch}],[{...ticket,shiftId:'not-a-uuid'}],[{...ticket,id:'x'.repeat(451)}]])('rejects invalid tickets before HTTP',async tickets=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  await expect(fixture().client.heldStatuses({branchId:branch,tickets})).rejects.toMatchObject({code:'EHELD_STATUS_PROTOCOL'});expect(fetch).not.toHaveBeenCalled();
 });
 it.each(['foreign','management'])('cannot infer an Operations branch from %s',async kind=>{
  const fetch=vi.fn();vi.stubGlobal('fetch',fetch);const f=fixture(kind==='management'?'management':'operations');
  await expect(f.client.heldStatuses({branchId:kind==='foreign'?id(8):branch,tickets:[ticket]})).rejects.toMatchObject({code:'SYNC_BRANCH_FORBIDDEN'});expect(fetch).not.toHaveBeenCalled();
 });
 it('rejects an oversized response body before parsing arbitrary content',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(' '.repeat(2*1024*1024+1),{headers:{'content-type':'application/json'}})));
  await expect(fixture().client.heldStatuses({branchId:branch,tickets:[ticket]})).rejects.toThrow('Exact JSON exceeds its bounded input');
 });
 it('refuses a changed native registration while the same HTTP request is outstanding',async()=>{
  const f=fixture();vi.stubGlobal('fetch',vi.fn(async()=>{f.state.config={...f.state.config,locationId:id(9)};return Response.json({ok:true,records:[]});}));
  await expect(f.client.heldStatuses({branchId:branch,tickets:[ticket]})).rejects.toMatchObject({code:'ESYNC_REQUEST_CONTEXT_CHANGED'});
 });
});
