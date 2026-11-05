import {createRequire} from 'node:module';
import {describe,it,expect,vi} from 'vitest';
const require=createRequire(import.meta.url);
const {ShiftFinancialDraftAdapter}=require('../../../electron/db/shift-financial-draft-adapter.cjs');
const input=()=>({capture:{financialRequired:true,status:'ready',expected:{cash:'12.01',card:'4.00',digital:'3.00'}},counted:{cash:'12.00',card:null,digital:'3.00'},openingFloat:'2.00',summary:{branchName:'A',actor:'person',totalSales:'17.01',transactions:'3',discounts:'1.00',refunds:'2.00'}});
describe('optional exact closing draft adapter',()=>{
 it('is default off and does not inspect an input or invoke exact work',async()=>{
  const adapter=new ShiftFinancialDraftAdapter(),legacy=vi.fn(async()=>({unchanged:true})),exact=vi.fn();
  expect(adapter.prepare(new Proxy({},{get(){throw new Error('must not inspect');}}))).toBeNull();
  expect(await adapter.run({legacy,exact})).toEqual({unchanged:true});expect(legacy).toHaveBeenCalledOnce();expect(exact).not.toHaveBeenCalled();
 });
 it('prepares exact fields and complete explicit summary from the captured transaction basis',async()=>{
  const adapter=new ShiftFinancialDraftAdapter({enabled:true}),legacy=vi.fn(),capture=input(),before=JSON.stringify(capture);
  const exact=vi.fn(async(a:typeof adapter)=>a.prepare(capture));
  const result=await adapter.run({legacy,exact});expect(legacy).not.toHaveBeenCalled();
  expect(result.draft).toMatchObject({expected_cash:'12.01',counted_cash:'12.00',variance_cash:'-0.01',variance_card:null,variance_total:'-0.01',variance_status:'SHORT',net_cash_sales:'10.01'});
  expect(result.summary).toMatchObject({total_sales:'17.01',discounts:'1.00',refunds:'2.00',transactions:'3'});expect(JSON.stringify(capture)).toBe(before);expect(Object.isFrozen(result)).toBe(true);
 });
 it('can save a valid pending-origin draft without pretending the upload is ready',()=>{
  const adapter=new ShiftFinancialDraftAdapter({enabled:true}),f=input();f.capture.status='pending';const result=adapter.prepare(f);expect(result.draft.expected_cash).toBe('12.01');expect(result).not.toHaveProperty('proof');expect(result).not.toHaveProperty('serverBasisId');
 });
 it('allows recount without a notification summary, but never fabricates one',()=>{
  const adapter=new ShiftFinancialDraftAdapter({enabled:true}),f=input();delete (f as Partial<typeof f>).summary;expect(adapter.prepare(f)).not.toHaveProperty('summary');
 });
 it.each([{status:'unsupported'},{financialRequired:false},{expected:null}])('fails closed for unusable capture %j',patch=>{const f=input();Object.assign(f.capture,patch);expect(()=>new ShiftFinancialDraftAdapter({enabled:true}).prepare(f)).toThrow();});
 it('does not permit a caller summary to replace calculated draft values',()=>{const f=input();Object.assign(f.summary,{draft:{expected_cash:'0.00'}});expect(()=>new ShiftFinancialDraftAdapter({enabled:true}).prepare(f)).toThrow();});
 it('propagates transaction errors without legacy fallback',async()=>{const adapter=new ShiftFinancialDraftAdapter({enabled:true}),legacy=vi.fn(),error=new Error('rollback');await expect(adapter.run({legacy,exact:async()=>{throw error;}})).rejects.toBe(error);expect(legacy).not.toHaveBeenCalled();});
});
