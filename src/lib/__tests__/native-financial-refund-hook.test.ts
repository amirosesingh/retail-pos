import {createRequire} from 'node:module';
import {describe,it,expect,vi} from 'vitest';
const require=createRequire(import.meta.url);
const {ReceiptRepository}=require('../../../electron/db/repositories/receipts.cjs');
const sale='11111111-1111-4111-8111-111111111111',shift='22222222-2222-4222-8222-222222222222';
function fixture({enabled=false,prior=false,legacy=false,changed=false,parent=true,replayOwner=true,priorReason=null}: {
 enabled?:boolean;prior?:boolean;legacy?:boolean;changed?:boolean;parent?:boolean;replayOwner?:boolean;priorReason?:string|null;
}={}){
 const events:string[]=[];let refunded=false;
 class Transaction{value=false;async begin(){events.push('begin');}async commit(){refunded=this.value;events.push('commit');}async rollback(){events.push('rollback');}}
 class Request{constructor(readonly tx:Transaction){}input(){return this;}async query(sql:string){
  if(sql.startsWith('SELECT operation_type,entity_id,note')){events.push('receipt lock');return{recordset:prior?[{operation_type:'refund',entity_id:sale.toUpperCase(),note:priorReason}]:[]};}
  if(sql.startsWith('SELECT id FROM dbo.sales WHERE id=@sale AND store_id=@branch')){events.push('replay branch');return{recordset:replayOwner?[{id:sale}]:[]};}
  if(sql.startsWith('SELECT id FROM dbo.shifts')){events.push('shift lock');return{recordset:parent?[{id:shift}]:[]};}
  if(sql.startsWith('SELECT TOP(1) id,is_refunded')){events.push('sale lock');return{recordset:[{id:sale,is_refunded:false,...(enabled?{shift_id:changed?'changed':legacy?null:shift}:{})}]};}
  if(sql.startsWith('SELECT id,product_id')){events.push('items');return{recordset:[]};}
  if(sql.startsWith('UPDATE dbo.sales')){events.push('refund write');this.tx.value=true;return{recordset:[]};}
  if(sql.startsWith('INSERT dbo.sync_change_journal')){events.push('journal');return{recordset:[]};}
  if(sql.startsWith('INSERT dbo.local_operation_receipts')){events.push('receipt write');return{recordset:[]};}
  throw new Error(sql);
 }}
 const poolRead=vi.fn(async()=>{events.push('scope observation');return{recordset:[{id:sale,shift_id:legacy?null:shift}]};});
 const pool={request:()=>({input(){return this;},query:poolRead})};
 const token=Object.freeze({opaque:true});
 const author={assertCurrent:vi.fn()};
 const financial={enabled,assertCurrent:vi.fn(()=>author.assertCurrent()),captureMutation:vi.fn(async()=>{events.push('head/capture');return legacy?null:token;}),finalizeMutation:vi.fn(async()=>{events.push('event finalize');})};
 const repo=new ReceiptRepository({pool,sql:()=>({Transaction,Request,ISOLATION_LEVEL:{SERIALIZABLE:4}})},null,{financialOperations:financial});
 const run=()=>repo.refund({saleId:sale,refundId:'stable-refund',branchId:'A'},{terminalId:'terminal',author});
 return{repo,run,events,financial,author,poolRead,refunded:()=>refunded};
}
describe('optional financial refund event seam',()=>{
 it('rejects a shiftless lookup that became a shifted receipt before the actual refund starts',async()=>{const f=fixture({enabled:true});await expect(f.repo.refund({saleId:sale,refundId:'stable-refund',branchId:'A'},{terminalId:'terminal',author:null,expectedShiftId:null})).rejects.toMatchObject({code:'EFINANCIAL_CONTEXT_CHANGED'});expect(f.financial.captureMutation).not.toHaveBeenCalled();expect(f.refunded()).toBe(false);});
 it('default-disabled preserves existing refund SQL and skips every protocol hook',async()=>{const f=fixture();await expect(f.run()).resolves.toMatchObject({ok:true,replayed:false});expect(f.poolRead).not.toHaveBeenCalled();expect(f.financial.captureMutation).not.toHaveBeenCalled();expect(f.financial.finalizeMutation).not.toHaveBeenCalled();expect(f.refunded()).toBe(true);});
 it('locks receipt then shift/head/sale and finalizes only after real refund write',async()=>{const f=fixture({enabled:true});await f.run();expect(f.events).toEqual(['scope observation','begin','receipt lock','shift lock','head/capture','sale lock','items','refund write','journal','event finalize','receipt write','commit']);expect(f.author.assertCurrent).toHaveBeenCalledTimes(3);});
 it('accepted replay verifies the receipt branch independently of current shift history',async()=>{const f=fixture({enabled:true,prior:true});f.poolRead.mockRejectedValue(new Error('current shift history missing'));await expect(f.run()).resolves.toMatchObject({replayed:true});expect(f.financial.captureMutation).not.toHaveBeenCalled();expect(f.financial.finalizeMutation).not.toHaveBeenCalled();expect(f.events).toContain('replay branch');expect(f.events.at(-1)).toBe('commit');});
 it('accepted replay refuses a changed reason or foreign receipt',async()=>{const changed=fixture({prior:true,priorReason:'another request'});await expect(changed.run()).rejects.toMatchObject({code:'EIDEMPOTENCY'});const foreign=fixture({prior:true,replayOwner:false});await expect(foreign.run()).rejects.toMatchObject({code:'ERECEIPT'});expect(foreign.events.at(-1)).toBe('rollback');});
 it('preserves legacy NULL shift only when protocol store confirms legacy',async()=>{const f=fixture({enabled:true,legacy:true});await f.run();expect(f.financial.captureMutation).toHaveBeenCalledOnce();expect(f.financial.finalizeMutation).not.toHaveBeenCalled();expect(f.events).not.toContain('shift lock');expect(f.refunded()).toBe(true);});
 it('scope drift aborts before stock or sale writes',async()=>{const f=fixture({enabled:true,changed:true});await expect(f.run()).rejects.toMatchObject({code:'EFINANCIAL_CONTEXT_CHANGED'});expect(f.events).not.toContain('items');expect(f.events).not.toContain('refund write');expect(f.events.at(-1)).toBe('rollback');});
 it('protected missing parent holds before any mutation',async()=>{const f=fixture({enabled:true,parent:false});await expect(f.run()).rejects.toMatchObject({code:'EFINANCIAL_CONTEXT_CHANGED'});expect(f.events).not.toContain('sale lock');expect(f.events.at(-1)).toBe('rollback');});
 it('capture failure cannot change sale, stock, journal or receipt',async()=>{const f=fixture({enabled:true});f.financial.captureMutation.mockRejectedValue(Object.assign(new Error('missing author'),{code:'EFINANCIAL_AUTHOR_PENDING'}));await expect(f.run()).rejects.toMatchObject({code:'EFINANCIAL_AUTHOR_PENDING'});expect(f.events).not.toContain('sale lock');expect(f.refunded()).toBe(false);});
 it('event finalization failure rolls back the entire refund',async()=>{const f=fixture({enabled:true});f.financial.finalizeMutation.mockRejectedValue(new Error('failed durable event'));await expect(f.run()).rejects.toThrow('failed durable event');expect(f.events).toContain('refund write');expect(f.events).not.toContain('receipt write');expect(f.refunded()).toBe(false);expect(f.events.at(-1)).toBe('rollback');});
 it('changed saving author after capture aborts before refund write',async()=>{const f=fixture({enabled:true});f.author.assertCurrent.mockImplementation(()=>{throw Object.assign(new Error('author changed'),{code:'ESYNC_SHIFT_AUTHOR_CHANGED'});});await expect(f.run()).rejects.toMatchObject({code:'ESYNC_SHIFT_AUTHOR_CHANGED'});expect(f.events).not.toContain('refund write');expect(f.refunded()).toBe(false);});
});
