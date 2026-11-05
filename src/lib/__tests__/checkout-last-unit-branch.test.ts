import {createRequire} from 'node:module';
import {describe,it,expect} from 'vitest';
const require=createRequire(import.meta.url);
const {AggregateRepository}=require('../../../electron/db/repositories/aggregates.cjs');
const {loadRegistry}=require('../../../electron/db/schema-registry.cjs');
const id='00000000-0000-4000-8000-000000000001';
function fixture(){
 const registry=loadRegistry(),table=registry.tables.find((t:{cloudTable:string})=>t.cloudTable==='products');
 const before={id,owner_store_id:null,name:'Fixture',stock_quantity:'1',stock_by_store:'{"a":1}',selling_price:'1.0000000000000001'};
 let saved={...before,stock_quantity:'0',stock_by_store:'{"a":0}'},queried='';
 class Request{input(){return this;}async query(text:string){queried=text;return{recordset:[text.includes('AND (')?before:saved]};}}
 const repo=new AggregateRepository({sql:()=>({Request})},{registry});
 const op={kind:'update',table:'products',match:{id},values:{stock_quantity:0,stock_by_store:{a:0}}};
 const scope={branchId:'a',enforcePermissions:true,productWriteKind:'sale',financialStockDeltas:new Map([[id,-1]])};
 return {repo,table,before,op,scope,query:()=>queried,change:(patch:object)=>{saved={...saved,...patch};}};
}
describe('transaction-local sale stock preimage',()=>{
 it('captures only strictly recognized financial sales using locked eligible branch SQL',async()=>{
  const f=fixture();expect(await f.repo.captureSaleStock({},f.table,f.op,f.scope,'product')).toBeNull();expect(f.query()).toBe('');
  const captured=await f.repo.captureSaleStock({},f.table,f.op,f.scope,'sale');expect(captured.before).toBe(f.before);expect(f.query()).toContain('WITH(UPDLOCK,HOLDLOCK)');expect(f.query()).toContain('AND (');
 });
 it('accepts actual zero stock after a verified last unit despite expired transient stock proof',async()=>{
  const f=fixture(),captured=await f.repo.captureSaleStock({},f.table,f.op,f.scope,'sale');await expect(f.repo.confirmSaleStock({},f.table,f.op,f.scope,captured,1)).resolves.toBeUndefined();
 });
 it.each([0,2])('requires exactly one affected row even without requireMatch (%s)',async affected=>{
  const f=fixture(),captured=await f.repo.captureSaleStock({},f.table,f.op,f.scope,'sale');await expect(f.repo.confirmSaleStock({},f.table,f.op,f.scope,captured,affected)).rejects.toMatchObject({code:'SYNC_BRANCH_FORBIDDEN',table:'products'});
 });
 it.each([{owner_store_id:'c'},{name:'Other'},{selling_price:'1.0000000000000002'}])('rejects altered catalogue identity without rounding exact SQL strings',async patch=>{
  const f=fixture(),captured=await f.repo.captureSaleStock({},f.table,f.op,f.scope,'sale');f.change(patch);await expect(f.repo.confirmSaleStock({},f.table,f.op,f.scope,captured,1)).rejects.toMatchObject({code:'SYNC_BRANCH_FORBIDDEN'});
 });
 it('rejects changed another-branch stock and wrong actual quantity',async()=>{
  for(const patch of [{stock_by_store:'{"a":0,"c":1}'},{stock_quantity:'7'}]){const f=fixture(),captured=await f.repo.captureSaleStock({},f.table,f.op,f.scope,'sale');f.change(patch);await expect(f.repo.confirmSaleStock({},f.table,f.op,f.scope,captured,1)).rejects.toMatchObject({code:'PERMISSION_DENIED'});}
 });
 it('preserves existing SQL-owned archive lifecycle fields',async()=>{
  const f=fixture(),captured=await f.repo.captureSaleStock({},f.table,f.op,f.scope,'sale');f.change({is_archived:true,archived_at:'2026-11-05T00:00:00Z',row_version:'3',updated_at:'2026-11-05T00:00:00Z'});await expect(f.repo.confirmSaleStock({},f.table,f.op,f.scope,captured,1)).resolves.toBeUndefined();
 });
});

describe('pre-stock existing sale identity guard',()=>{
 function reader(existing=false){const calls:string[]=[];class Request{sale='';input(_name:string,value:string){this.sale=value;return this;}async query(text:string){expect(text).toContain('WITH(UPDLOCK,HOLDLOCK)');calls.push(this.sale);return{recordset:existing?[{id:this.sale}]:[]};}}const repo=new AggregateRepository({sql:()=>({Request})},{});return{repo,calls};}
 it('locks new normalized sale IDs in deterministic order and ignores legitimate original references',async()=>{
  const f=reader(),lower='00000000-0000-4000-8000-000000000002';await f.repo.assertNewSaleIdentities({},[{table:'sales',kind:'upsert',rows:[{id:lower,original_bill_number:'OLD'}]},{table:'sales',kind:'insert',rows:[{id}]},{table:'sales',kind:'update',match:{id:'existing-original'}},{table:'sales',kind:'delete',match:{id:'dedicated-refund-original'}}]);expect(f.calls).toEqual([id,lower]);
 });
 it('holds existing immutable or partial sale headers without exposing their branch',async()=>{
  const f=reader(true);await expect(f.repo.assertNewSaleIdentities({},[{table:'sales',kind:'upsert',rows:[{id}]}])).rejects.toMatchObject({code:'EEXISTING_SALE_RECONCILIATION',table:'sales'});expect(f.calls).toEqual([id]);
 });
 it.each([{ids:[id,id]},{ids:['not-a-valid-sale-id']}])('rejects duplicate or malformed IDs before any SQL (%j)',async ({ids})=>{
  const f=reader();await expect(f.repo.assertNewSaleIdentities({},[{table:'sales',kind:'upsert',rows:ids.map(id=>({id}))}])).rejects.toMatchObject({code:'EIDEMPOTENCY'});expect(f.calls).toEqual([]);
 });
 it('does not run sale insertion guards for dedicated original updates/refund references alone',async()=>{
  const f=reader(true);await f.repo.assertNewSaleIdentities({},[{table:'sales',kind:'update',match:{id}},{table:'sale_refunds',kind:'insert',rows:[{sale_id:id}]}]);expect(f.calls).toEqual([]);
 });
});

describe('supported values-form sale rows',()=>{
 it('checks values-form existing sale IDs before stock and detects mixed-form duplicates',async()=>{
  const calls:string[]=[];class Request{input(_name:string,value:string){calls.push(value);return this;}async query(){return{recordset:[{id}]};}}
  const repo=new AggregateRepository({sql:()=>({Request})},{});
  await expect(repo.assertNewSaleIdentities({},[{kind:'upsert',table:'sales',values:{id}}])).rejects.toMatchObject({code:'EEXISTING_SALE_RECONCILIATION'});expect(calls).toEqual([id]);calls.length=0;
  await expect(repo.assertNewSaleIdentities({},[{kind:'upsert',table:'sales',rows:[{id}]},{kind:'insert',table:'sales',values:{id}}])).rejects.toMatchObject({code:'EIDEMPOTENCY'});expect(calls).toEqual([]);
 });
});
