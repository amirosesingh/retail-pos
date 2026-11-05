import {createRequire} from 'node:module';
import {describe,it,expect} from 'vitest';
const require=createRequire(import.meta.url),contract=require('../../../electron/db/stock-history-contract.cjs');
const {stockHistoryUploadRow,assertStockHistoryAcknowledgement}=require('../../../electron/sync/stock-history-ack.cjs');
const id='11111111-1111-4111-8111-111111111111',op='22222222-2222-4222-8222-222222222222',effect='33333333-3333-4333-8333-333333333333';
function fixture(){
 const context=contract.normalizeContext({operationId:op,branchId:'a',terminalId:'t',actorId:'cashier',kind:'sale',clockState:'unverified'},'2026-11-06T00:00:00.1234567Z');
 const row={...contract.changes(context,[{id,name:'鞋',stock_by_store:{a:3}}],[{id,name:'鞋',sku:'0001',barcode:null,stock_by_store:{a:1}}])[0]};
 const wire=stockHistoryUploadRow(row,{branchId:'a',terminalId:'t'}),batch={version:1,branchId:'a',terminalId:'t',rows:[wire]};
 const response={ok:true,version:1,branchId:'a',terminalId:'t',receipts:[{id:wire.id,payloadHash:wire.payloadHash,ingestedCursor:'9007199254740993',acceptedAt:'2026-11-06T00:00:01.1234567Z',effectIds:[effect]}]};
 return{row,wire,batch,response};
}
describe('durable stock-history exact acceptance',()=>{
 it('retains immutable original JSON, exact numbers and original recording/effective instants',()=>{
  const f=fixture();expect(f.wire.payloadJson).toBe(f.row.payload_json);expect(JSON.parse(f.wire.payloadJson)[8]).toBe('-2');
  expect(f.wire.payloadJson).toContain('2026-11-06T00:00:00.1234567Z');expect(Object.isFrozen(f.wire)).toBe(true);
  expect(assertStockHistoryAcknowledgement(f.batch,f.response)).toEqual([{id:f.wire.id,payloadHash:f.wire.payloadHash,ingestedCursor:'9007199254740993',acceptedAt:'2026-11-06T00:00:01.1234567Z',effectIds:[effect]}]);
 });
 it.each(['hash','payload','branch','terminal','stored quantity','stored time','source'])('refuses altered original %s',change=>{
  const f=fixture();
  if(change==='hash')f.row.payload_hash='0'.repeat(64);
  if(change==='payload')f.row.payload_json+=' ';
  if(change==='branch')f.row.store_id='b';
  if(change==='terminal')f.row.terminal_id='foreign';
  if(change==='stored quantity')f.row.quantity_delta='-1';
  if(change==='stored time')f.row.effective_at_raw='2026-11-06T00:00:00.1234566Z';
  if(change==='source')f.row.source_kind='other';
  expect(()=>stockHistoryUploadRow(f.row,{branchId:'a',terminalId:'t'})).toThrow();
 });
 it.each(['HTTP only','hash','branch','terminal','missing receipt','extra receipt','effectless','unsafe cursor','invalid time'])('keeps the claim pending for %s acknowledgement',change=>{
  const f=fixture(),r:any=structuredClone(f.response);
  if(change==='HTTP only')delete r.receipts;
  if(change==='hash')r.receipts[0].payloadHash='0'.repeat(64);
  if(change==='branch')r.branchId='b';
  if(change==='terminal')r.terminalId='foreign';
  if(change==='missing receipt')r.receipts=[];
  if(change==='extra receipt')r.receipts.push({...r.receipts[0]});
  if(change==='effectless')r.receipts[0].effectIds=[];
  if(change==='unsafe cursor')r.receipts[0].ingestedCursor=Number('9007199254740993');
  if(change==='invalid time')r.receipts[0].acceptedAt='2026-02-30T00:00:00Z';
  expect(()=>assertStockHistoryAcknowledgement(f.batch,r)).toThrow();
 });
 it('rejects duplicate effect identities and shared ingestion positions across different claims',()=>{
  const f=fixture(),other={...f.wire,id:op},batch={...f.batch,rows:[f.wire,other]};
  const receipt={...f.response.receipts[0],id:op,ingestedCursor:'9007199254740994'};
  expect(()=>assertStockHistoryAcknowledgement(batch,{...f.response,receipts:[f.response.receipts[0],receipt]})).toThrow();
  expect(()=>assertStockHistoryAcknowledgement(batch,{...f.response,receipts:[f.response.receipts[0],{...receipt,effectIds:[id],ingestedCursor:f.response.receipts[0].ingestedCursor}]})).toThrow();
 });
});
