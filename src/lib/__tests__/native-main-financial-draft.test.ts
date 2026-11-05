import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import {describe,it,expect,vi} from 'vitest';
const require=createRequire(resolve('electron/main.cjs'));
const {createShiftFinancialDraftProvider}=require('./db/shift-financial-draft-adapter.cjs');
type Row=Record<string,unknown>;
const shiftId='11111111-1111-4111-8111-111111111111';
function fixture({exact=true,kind='ORIGINAL',replay=false}={}){
 const source={computed:{status:'computed',formula:'canonical-exact-decimal-v2',expected:{cash:'9007199254740993.01',card:'4.00',digital:'3.00'}},openingFloat:'2.00',sourceHash:'a'.repeat(64),summary:{totalSales:'9007199254740998.01',transactions:'3',discounts:'1.00',refunds:'2.00'}};
 const store={enabled:true,readDraft:vi.fn(async()=>source)};
 const provider=exact?createShiftFinancialDraftProvider(store,{enabled:true}):null;
 const parent={id:shiftId,state:kind==='ORIGINAL'?'CASH_COUNT_REQUIRED':'CLOSED',terminal_id:'terminal',opened_at:'2026-11-04T00:00:00Z',opening_float:2};
 const observation={parent};
 const author={assertCurrent:vi.fn()};
 const capture={subject:'real.author',assertCurrent:vi.fn()};
 const journal={observe:vi.fn(async()=>observation),originalReplay:vi.fn(async(_intent:Row)=>replay?{state:'CLOSED'}:false),recountReplay:vi.fn(async(_intent:Row)=>replay),apply:vi.fn(async()=>{})};
 const repository={query:vi.fn(async()=>({rows:[{name:'Branch A'}]})),shiftExpectedTotals:vi.fn(async()=>({expected_cash:12,expected_card:4,expected_digital:3,total_sales:17,transactions:3,discounts:1,refunds:2}))};
 const context={require,shiftFinancialDraftProvider:provider,shiftAuthority:{capture:vi.fn(()=>capture),prepare:vi.fn(async()=>author)},localBranchId:()=> 'A',guard:{uuid:(v:unknown)=>v,text:(v:unknown)=>v},shiftSyncJournal:journal,operationsRepository:repository,shiftMoney:(v:unknown)=>Math.round(Number(v)*100)/100,randomUUID:()=>crypto.randomUUID(),pendingShiftCloseSync:new Set(),publishBusinessChange:vi.fn(),scheduleAutomaticSync:vi.fn()};
 const main=readFileSync('electron/main.cjs','utf8'),start=main.indexOf('async function commitLocalShiftCashCount(raw)'),end=main.indexOf('async function approveLocalShiftVariance(raw)',start);
 const api=runInNewContext(main.slice(start,end)+'\n({original:commitLocalShiftCashCount,recount:commitLocalShiftRecount});',context);
 const raw={shiftId,cash:exact?'9007199254740993.00':12,card:null,digital:exact?'3.00':3,reason:'verified recount',clientKey:'stable-client-key'};
 return{api,raw,journal,repository,store,source,context,run:()=>api[kind==='ORIGINAL'?'original':'recount'](raw)};
}
describe('actual Main optional exact closing workflow',()=>{
 it('uses the verified per-shift runtime and its terminal identity for a new count',async()=>{
  const f=fixture(),scope={terminalId:'verified-registered-till'};
  Object.assign(f.context,{shiftFinancialRuntime:{savedReplay:vi.fn(async()=>null),shiftContext:vi.fn(async()=>({journal:f.journal,draftProvider:f.context.shiftFinancialDraftProvider,scope}))}});
  Object.assign(f.raw,{terminalId:'forged-renderer-terminal'});
  expect(await f.run()).toMatchObject({ok:true,state:'CLOSED'});
  expect((f.journal.apply.mock.calls[0] as unknown as [unknown,unknown,Record<string,unknown>])[2].terminalId).toBe(scope.terminalId);
 });
 it.each(['ORIGINAL','RECOUNT'])('returns validated saved %s before capability reads or current financial observation',async kind=>{
  const f=fixture({kind}),savedReplay=vi.fn(async()=>({ok:true,state:'CLOSED',replayed:true})),shiftContext=vi.fn(async()=>{throw new Error('must not observe a saved action');});
  Object.assign(f.context,{shiftFinancialRuntime:{savedReplay,shiftContext}});
  expect(await f.run()).toMatchObject({ok:true,state:'CLOSED',replayed:true});
  expect(shiftContext).not.toHaveBeenCalled();expect(f.store.readDraft).not.toHaveBeenCalled();expect(f.journal.observe).not.toHaveBeenCalled();
 });
 it.each(['ORIGINAL','RECOUNT'])('builds %s exact complete operations before journal hashing',async kind=>{
  const f=fixture({kind});expect(await f.run()).toMatchObject({ok:true,state:'CLOSED'});expect(f.store.readDraft).toHaveBeenCalledWith({branchId:'A',shiftId});expect(f.repository.shiftExpectedTotals).not.toHaveBeenCalled();
  const call=f.journal.apply.mock.calls[0] as unknown as [string,Array<{table:string;rows?:Row[];values?:Row}>,Row];
  const parent=call[1].find(op=>op.table==='shifts')?.values,recon=call[1].find(op=>op.table==='shift_reconciliations')?.rows?.[0];
  expect(parent).toMatchObject({expected_cash:'9007199254740993.01',counted_cash:'9007199254740993.00',variance_cash:'-0.01',variance_total:'-0.01'});expect(recon).toMatchObject({expected_cash:'9007199254740993.01',variance_card:null});expect(call[2]).toMatchObject({financialSourceHash:'a'.repeat(64)});
  if(kind==='ORIGINAL'){
   const notification=call[1].find(op=>op.table==='shift_notifications')?.rows?.[0];expect(notification).toMatchObject({total_sales:'9007199254740998.01',discounts:'1.00',refunds:'2.00',store_name:'Branch A'});
   const alert=call[1].find(op=>op.table==='shift_variance_alerts')?.rows?.[0];expect(alert?.message).toContain('Expected cash: 9007199254740993.01');expect(alert?.message).toContain('Variance: -0.01');
  }
 });
 it.each(['ORIGINAL','RECOUNT'])('preserves accepted %s replay without reading new financial data',async kind=>{
  const f=fixture({kind,replay:true});expect(await f.run()).toMatchObject({ok:true,replayed:true});expect(f.store.readDraft).not.toHaveBeenCalled();expect(f.journal.apply).not.toHaveBeenCalled();
  const replay=kind==='ORIGINAL'?f.journal.originalReplay:f.journal.recountReplay;expect(replay.mock.calls[0][0]).toMatchObject({clientKey:'stable-client-key',cash:'9007199254740993.00'});
 });
 it('keeps disabled legacy numeric workflow and notification intact',async()=>{
  const f=fixture({exact:false});await f.run();expect(f.store.readDraft).not.toHaveBeenCalled();expect(f.repository.shiftExpectedTotals).toHaveBeenCalledOnce();
  const call=f.journal.apply.mock.calls[0] as unknown as [string,Array<{table:string;values?:Row}>,Row];expect(call[1].find(op=>op.table==='shifts')?.values).toMatchObject({expected_cash:12,counted_cash:12,variance_total:0});expect(call[2]).not.toHaveProperty('financialSourceHash');
 });
 it('fails closed on exact input Number instead of silently passing through floating point',async()=>{const f=fixture();Object.assign(f.raw,{cash:9007199254740992});await expect(f.run()).rejects.toMatchObject({code:'EFINANCIAL_DRAFT_INVALID'});expect(f.store.readDraft).not.toHaveBeenCalled();expect(f.journal.apply).not.toHaveBeenCalled();});
 it('keeps existing safe numeric renderer counts compatible with the exact path',async()=>{const f=fixture();Object.assign(f.raw,{cash:12.29});await f.run();expect(f.journal.originalReplay.mock.calls[0][0]).toMatchObject({cash:'12.29'});const ops=(f.journal.apply.mock.calls[0] as unknown as [string,Array<{table:string;rows?:Row[]}>])[1];expect(ops.find(op=>op.table==='shift_cash_counts')?.rows?.[0]).toMatchObject({counted_cash:'12.29'});});
 it('propagates source failure without legacy fallback or any saved operations',async()=>{const f=fixture();f.store.readDraft.mockRejectedValue(new Error('snapshot unavailable'));await expect(f.run()).rejects.toThrow('snapshot unavailable');expect(f.repository.shiftExpectedTotals).not.toHaveBeenCalled();expect(f.journal.apply).not.toHaveBeenCalled();});
 it('retains verified author permission and current-session checks before reading/saving',async()=>{const f=fixture();f.context.shiftAuthority.capture.mockImplementation(()=>{throw Object.assign(new Error('denied'),{code:'PERMISSION_DENIED'});});await expect(f.run()).rejects.toMatchObject({code:'PERMISSION_DENIED'});expect(f.store.readDraft).not.toHaveBeenCalled();expect(f.journal.apply).not.toHaveBeenCalled();});
});

describe('Main canonical default recount retry key',()=>{
 it('keeps ordinary legacy key spelling with exact decimal input',async()=>{
  const f=fixture({kind:'RECOUNT',replay:true});Object.assign(f.raw,{cash:'12.00',card:'1.50',digital:null,clientKey:undefined});await f.run();expect(f.journal.recountReplay.mock.calls[0][0]).toMatchObject({clientKey:`${shiftId}:recount:12:1.5::verified recount`,cash:'12.00',card:'1.50'});
 });
});
