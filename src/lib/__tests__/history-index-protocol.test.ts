import { createRequire } from 'node:module';
import { describe,it,expect } from 'vitest';
const {normalizeIndex,normalizeRows,INDEX,ROWS,PROJECTION}=createRequire(import.meta.url)('../../../electron/sync/history-index-protocol.cjs');
const id=(n:number)=>'aaaaaaaa-aaaa-4aaa-8aaa-'+String(n).padStart(12,'0');
const scope={organizationId:'default',branchId:'branch',terminalId:'terminal',keepCommerce:false};
const common={projection:PROJECTION,policy:'branch-history-v1',history_scope:'branch',organization_id:'default',branch_id:'branch',terminal_id:'terminal',keep_commerce:false};
const page=()=>({...common,protocol:INDEX,action:'begin',upper_id:id(3),after_id:null,ids:[id(1),id(2)],next_id:id(2),complete:false,range_count:null});
const row=(n=1)=>({id:id(n),organization_id:'default',entity_type:'products',entity_id:id(20).toUpperCase(),action:'insert',old_value_json:null,new_value_json:'{"amount":9007199254740993,"fraction":0.1234567890123456789}',revision:'9007199254740993',scope_type:'BRANCH',scope_id:'branch' as string|null,changed_by:null,source_application:'fixture',device_id:null,terminal_id:null,server_timestamp:'2026-11-06T01:02:03.1234560Z'});
const batch=()=>({...common,protocol:ROWS,requested_ids:[id(1),id(2)],rows:[row()],remaining_ids:[id(2)]});
type MutablePage=Record<string,unknown>;
type MutableRows={rows:Record<string,unknown>[];remaining_ids:unknown};
describe('Main-only bounded history reconciliation protocol',()=>{
 it('accepts strictly scoped increasing UUID pages without treating counts as payload proof',()=>{const result=normalizeIndex(page(),scope,{action:'begin'});expect(result.ids).toEqual([id(1),id(2)]);expect(Object.isFrozen(result.ids)).toBe(true);});
 it('accepts finish cardinality only as exact decimal text',()=>{const value={...page(),action:'finish',ids:[],next_id:null,complete:true,range_count:'9007199254740993'};expect(normalizeIndex(value,scope,{action:'finish',upperId:id(3)}).range_count).toBe('9007199254740993');});
 it('rejects an oversized cardinality before bigint conversion',()=>{const value={...page(),action:'finish',ids:[],next_id:null,complete:true,range_count:'9'.repeat(100000)};expect(()=>normalizeIndex(value,scope,{action:'finish',upperId:id(3)})).toThrow();});
 it('keeps exact bigint, JSON numeric text, UTC precision and existing UUID normalization',()=>{const result=normalizeRows(batch(),scope,[id(1),id(2)]);expect(result.rows[0]).toMatchObject({revision:'9007199254740993',new_value_json:row().new_value_json,server_timestamp:row().server_timestamp,entity_id:id(20)});});
 for(const [label,mutate] of Object.entries({
  branch:(v:MutablePage):unknown=>v.branch_id='other',terminal:(v:MutablePage):unknown=>v.terminal_id='other',projection:(v:MutablePage):unknown=>v.projection='unknown',privacy:(v:MutablePage):unknown=>v.keep_commerce=true,
  oldPolicy:(v:MutablePage):unknown=>v.policy='old',company:(v:MutablePage):unknown=>v.history_scope='company',legacyProtocol:(v:MutablePage):unknown=>v.protocol='history-index-v1',
  duplicate:(v:MutablePage):unknown=>v.ids=[id(1),id(1)],unordered:(v:MutablePage):unknown=>v.ids=[id(2),id(1)],outside:(v:MutablePage):unknown=>v.ids=[id(4)],cursor:(v:MutablePage):unknown=>v.next_id=id(1),
  emptyContinuation:(v:MutablePage):unknown=>v.ids=[],extra:(v:MutablePage):unknown=>v.author='forged',coercedComplete:(v:MutablePage):unknown=>v.complete=1,
 }))it('rejects '+label+' without accepting progress',()=>{const v=page();mutate(v);expect(()=>normalizeIndex(v,scope,{action:'begin'})).toThrow();});
 for(const [label,mutate] of Object.entries({
  wrongId:(v:MutableRows):unknown=>v.rows[0].id=id(3),roundedRevision:(v:MutableRows):unknown=>v.rows[0].revision=9007199254740992,
  overflow:(v:MutableRows):unknown=>v.rows[0].revision='9223372036854775808',invalidDate:(v:MutableRows):unknown=>v.rows[0].server_timestamp='2026-02-30T00:00:00.0000000Z',
  duplicateJson:(v:MutableRows):unknown=>v.rows[0].new_value_json='{"x":1,"x":2}',malformedJson:(v:MutableRows):unknown=>v.rows[0].new_value_json='{',
  truncated:(v:MutableRows):unknown=>v.remaining_ids=[],extraField:(v:MutableRows):unknown=>v.rows[0].pin='secret',
  foreignBranch:(v:MutableRows):unknown=>v.rows[0].scope_id='other',global:(v:MutableRows):unknown=>v.rows[0].scope_type='GLOBAL',unattributed:(v:MutableRows):unknown=>v.rows[0].scope_id=null,
  foreignOrganization:(v:MutableRows):unknown=>v.rows[0].organization_id='other',trailingScope:(v:MutableRows):unknown=>v.rows[0].scope_type='BRANCH ',
 }))it('rejects row '+label,()=>{const v=batch();mutate(v);expect(()=>normalizeRows(v,scope,[id(1),id(2)])).toThrow();});
 it('rejects over1000 IDs and changed range/scope tokens',()=>{const p=page();p.ids=Array.from({length:1001},(_,n)=>id(n+1));expect(()=>normalizeIndex(p,scope,{action:'begin'})).toThrow();expect(()=>normalizeIndex({...page(),action:'page'},scope,{action:'page',upperId:id(9)})).toThrow();});
 it('adopts only a verified first-response privacy mode and then binds later pages to it',()=>{const expected={...scope,keepCommerce:undefined};expect(normalizeIndex(page(),expected,{action:'begin'}).keep_commerce).toBe(false);expect(()=>normalizeIndex({...page(),action:'page'},expected,{action:'page',upperId:id(3)})).toThrow();});
 it('rejects oversized integer text before expensive bigint conversion',()=>{const b=batch();b.rows[0].revision='9'.repeat(100000);expect(()=>normalizeRows(b,scope,[id(1),id(2)])).toThrow();});
 it('accepts company history only when the caller expects the separately verified company mode',()=>{const b=batch();b.history_scope='company';b.rows[0].scope_type='GLOBAL';b.rows[0].scope_id=null;expect(()=>normalizeRows(b,scope,[id(1),id(2)])).toThrow();expect(normalizeRows(b,{...scope,historyScope:'company'},[id(1),id(2)]).rows[0].scope_type).toBe('GLOBAL');});
});
