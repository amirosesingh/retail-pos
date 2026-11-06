import {createRequire} from 'node:module';
import {describe,it,expect,vi} from 'vitest';
import {stockSourceManifestJson} from '../../../electron/shared/stock-source-manifest.mjs';
import {verifyStockSourceMembership} from '../../../electron/shared/stock-source-cohort.mjs';
const require=createRequire(import.meta.url);
const {persistSourceCohort}=require('../../../electron/db/stock-history-cohort.cjs');
const id='11111111-1111-4111-8111-111111111111',product='22222222-2222-4222-8222-222222222222',actor='33333333-3333-4333-8333-333333333333',db='44444444-4444-4444-8444-444444444444';
function fixture(){
 const source=stockSourceManifestJson({version:1,operationId:id,action:'ADJUST',document:{type:'stock_adjustments',id:product},
  authorId:actor,terminalId:'t',branchId:'a',productId:product,delta:'-1',effectiveAt:'2026-11-06T00:00:00.0000001Z',
  recordedAt:'2026-11-06T00:00:00.0000001Z',sourceRefs:[['stock_adjustments',product,'-1']]});
 const writes:Record<string,unknown>[]=[];
 const store={request:()=>{const values:Record<string,unknown>={};return{input(name:string,value:unknown){values[name]=value;return this;},
  async query(sql:string){if(sql.includes('INSERT dbo.stock_history_source_cohorts'))writes.push(values);return{recordset:[]};}};}};
 const input={rows:[{store_id:'a',terminal_id:'t',operation_id:id,actor_id:actor,recorded_at_raw:'2026-11-06T00:00:00.0000001Z'}],
  manifests:[source],author:{action:'ADJUST',signSourceCohort:undefined as undefined|((input:unknown)=>unknown)},databaseKey:db+':fixture',assertCurrent:vi.fn()};
 return{store,input,writes,source};
}
describe('original unsigned stock source retention',()=>{
 it.each(['absent','ESYNC_SHIFT_AUTHOR_ENROLLMENT_PENDING','ESYNC_SHIFT_AUTHOR_KEY_MISSING','ESYNC_SHIFT_AUTHOR_KEY_UNAVAILABLE',
  'ESYNC_SHIFT_AUTHOR_VAULT_UNAVAILABLE','ESTOCK_AUTHOR_PERMISSION_REVOKED'])('retains original full cohort without inventing proof: %s',async code=>{
   const f=fixture();if(code!=='absent')f.input.author.signSourceCohort=()=>{throw Object.assign(new Error('Unavailable original author'),{code});};
   const saved=await persistSourceCohort(f.store,{},f.input);expect(f.writes).toHaveLength(1);
   const row=f.writes[0]!;expect(row.cohort_proof).toBeNull();expect(row.cohort_actor).toBe(actor);expect(row.cohort_sequence).toBe('1');
   const member=JSON.parse(row.cohort_members as string)[0];
   expect(await verifyStockSourceMembership(member,{root:saved.root,count:saved.count})).toEqual(JSON.parse(f.source));
   expect(member.manifestJson).toBe(f.source);expect(f.input.assertCurrent).toHaveBeenCalled();
  });
 it.each([null,{},false])('a malformed signer response is not downgraded into an unsigned acceptance (%j)',async result=>{
  const f=fixture();f.input.author.signSourceCohort=()=>result;
  await expect(persistSourceCohort(f.store,{},f.input)).rejects.toMatchObject({code:'ESTOCK_AUTHOR_INVALID'});expect(f.writes).toEqual([]);
 });
 it('does not swallow context errors or arbitrary signer failures',async()=>{
  for(const code of ['ESTOCK_HISTORY_CONTEXT_CHANGED','EUNKNOWN']){
   const f=fixture();f.input.author.signSourceCohort=()=>{throw Object.assign(new Error('Different runtime failure'),{code});};
   await expect(persistSourceCohort(f.store,{},f.input)).rejects.toMatchObject({code});expect(f.writes).toEqual([]);
  }
 });
 it('rechecks scope after the signer fails rather than retaining under a changed session',async()=>{
  const f=fixture();f.input.author.signSourceCohort=()=>{f.input.assertCurrent.mockImplementation(()=>{throw Object.assign(new Error('Changed'),{code:'ESTOCK_HISTORY_CONTEXT_CHANGED'});});
   throw Object.assign(new Error('Key missing'),{code:'ESYNC_SHIFT_AUTHOR_KEY_MISSING'});};
  await expect(persistSourceCohort(f.store,{},f.input)).rejects.toMatchObject({code:'ESTOCK_HISTORY_CONTEXT_CHANGED'});expect(f.writes).toEqual([]);
 });
});
