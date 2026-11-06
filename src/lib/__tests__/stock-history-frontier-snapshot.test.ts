import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {afterEach,describe,expect,it,vi} from 'vitest';
const require=createRequire(import.meta.url);
const {readStockHistoryFrontierSnapshot:read}=require('../../../electron/db/stock-history-frontier-snapshot.cjs');
const shape=require('../../../electron/db/stock-history-schema.json'),objects=require('../../../electron/db/stock-history-schema-objects.json');
const database='11111111-1111-4111-8111-111111111111',oldDatabase='22222222-2222-4222-8222-222222222222';
const id=(n:number)=>`33333333-3333-4333-8333-${String(n).padStart(12,'0')}`;
const hash=(text:string)=>createHash('sha256').update(text,'utf8').digest('hex');
type Row=Record<string,unknown>;
function fixture(){
 const proof='{"fixture":"店📦"}',sources:Row[]=[{id:id(1),operation_id:id(2),store_id:'a',terminal_id:'t',database_guid:database,
  source_sequence:'1',source_root:'a'.repeat(64),predecessor_root:null,payload_hash:'b'.repeat(64),proof_bytes:String(Buffer.byteLength(proof,'utf16le')),
  unsigned:0,accepted_batch_id:null,accepted_transaction_id:null,accepted_at:null}];
 const movements:Row[]=[{id:id(3),operation_id:id(2),product_id:id(4),store_id:'a',terminal_id:'t',source_kind:'stock',payload_hash:'c'.repeat(64),
  proof_bytes:String(Buffer.byteLength(proof,'utf16le')),unsigned:0,ingested_cursor:null,upload_aggregate_id:id(5)}];
 const journal:Row[]=[{change_id:'9007199254740993',entity_type:'sales',entity_id:JSON.stringify({id:id(6)}),operation:'insert',branch_id:'a',entity_version:'9007199254740994',aggregate_id:id(6),failed:0}];
 const heads:Row[]=[{store_id:'a',coverage_state:'complete',baseline_id:id(7),coverage_generation:'9007199254740993',baseline_state:'verified',baseline_hash:'d'.repeat(64)}];
 const state={transaction:'0',options:'0',capability:'ready',databaseId:database,observedAt:'2026-11-06T00:00:00.1234567Z',current:true,lease:true,
  failAt:'',failCode:'ETIMEOUT',failNumber:0,rollbackFails:false,afterQuery:(_text:string)=>{}};
 const commands:string[]=[],parents:unknown[]=[],timeouts:number[]=[];let acquires=0,releases=0,closes=0;
 const connection={hasError:false,close:(callback:()=>void)=>{closes++;callback();}};
 const pool={config:{requestTimeout:30000},connected:true,acquire:(_owner:unknown,callback:(error:unknown,connection:unknown,config:unknown)=>void)=>{acquires++;callback(null,connection,pool.config);},release:(value:unknown)=>{expect(value).toBe(connection);releases++;}};
 class Request{
  parameters:Record<string,unknown>={};
  constructor(parent:unknown,options:{requestTimeout?:number}={}){parents.push(parent);timeouts.push(options.requestTimeout!);}
  input(name:string,_type:unknown,value:unknown){this.parameters[name]=value;return this;}
  async query(text:string){
   commands.push(text);if(text.includes('ROLLBACK')&&state.rollbackFails)throw new Error('Synthetic rollback failure');
   if(state.failAt&&text.includes(state.failAt))throw Object.assign(new Error('Synthetic SQL failure'),{code:state.failCode,number:state.failNumber||undefined});
   let recordset:Row[]=[];
   if(text.includes('stock-frontier:session'))recordset=[{transaction_count:state.transaction,session_options:state.options}];
   else if(text.includes('stock-frontier:begin'))state.transaction='1';
   else if(text.includes('COMMIT')||text.includes('ROLLBACK'))state.transaction='0';
   else if(text.includes('database_guid')&&!text.includes('stock-frontier:sources'))recordset=[{database_guid:state.databaseId,schema_generation:'31:fixture'}];
   else if(text.includes('c.max_length [length]'))recordset=state.capability==='absent'?[]:state.capability==='partial'?shape.columns.filter((row:Row)=>row.table!=='stock_history_openings'):state.capability==='unknown'?shape.columns.slice(1):shape.columns;
   else if(text.includes('WITH objects AS'))recordset=objects;
   else if(text.includes('stock-frontier:head'))recordset=heads;
   else if(text.includes('stock-frontier:sources'))recordset=sources;
   else if(text.includes('stock-frontier:movements'))recordset=movements;
   else if(text.includes('stock-frontier:journal'))recordset=journal;
   else if(text.includes('stock-frontier:source-hashes'))recordset=sources.map(row=>({id:row.id,proof_hash:row.unsigned?null:hash(proof)}));
   else if(text.includes('stock-frontier:movement-hashes'))recordset=movements.map(row=>({id:row.id,proof_hash:row.unsigned?null:hash(proof)}));
   else if(text.includes('stock-frontier:clock'))recordset=[{observed_at:state.observedAt}];
   else throw new Error('Unexpected SQL in fixture');
   state.afterQuery(text);return{recordset:structuredClone(recordset)};
  }
 }
 const manager={pool,sql:()=>({Request,NVarChar:(size:number)=>({name:'nvarchar',size})})};
 const assertCurrent=()=>{if(!state.current)throw Object.assign(new Error('Context changed'),{code:'CONTEXT_CHANGED'});};
 const assertLease=()=>{if(!state.lease)throw Object.assign(new Error('Lease changed'),{code:'LEASE_CHANGED'});};
 return{manager,state,sources,movements,journal,heads,commands,parents,timeouts,connection,proof,
  run:(change={})=>read({manager,branchId:'a',terminalId:'t',assertCurrent,assertLease,...change}),counts:()=>({acquires,releases,closes})};
}
afterEach(()=>vi.useRealTimers());
describe('private bounded read-only native stock frontier snapshot',()=>{
 it('returns only frozen private evidence and exact SQL100ns, never raw proofs or complete coverage',async()=>{
  const f=fixture(),result=await f.run();expect(result).toMatchObject({available:true,databaseId:database,branchId:'a',terminalId:'t',
   sourceSequence:'1',sourceRoot:'a'.repeat(64),observedAt:f.state.observedAt,pending:{business:'1',metadata:'2',unsigned:'0',unknown:'0'},coverageProven:false});
  expect(Object.isFrozen(result)).toBe(true);expect(Object.isFrozen(result.pending)).toBe(true);expect(Object.isFrozen(result.blockers)).toBe(true);
  expect(JSON.stringify(result)).not.toContain(f.proof);expect(JSON.stringify(result)).not.toContain('sales');expect(result).not.toHaveProperty('proof');
  expect(f.parents.every(parent=>parent===f.parents[0])).toBe(true);expect(f.timeouts.every(value=>value===1000)).toBe(true);
  expect(f.counts()).toEqual({acquires:1,releases:1,closes:0});expect(f.state.transaction).toBe('0');
  expect(f.commands.join('\n')).not.toMatch(/\b(?:SET|INSERT|UPDATE|DELETE|ALTER|CREATE|MERGE|DBCC)\b/i);
 });
 it('binds exact >2^53 sequence/journal numbers and changes evidence digests by one unit',async()=>{
  const f=fixture();f.sources[0]!.source_sequence='9007199254740993';const first=await f.run();
  expect(first.sourceSequence).toBe('9007199254740993');expect(first.blockers).toContain('BROKEN_SOURCE_PREFIX');
  f.sources[0]!.source_sequence='9007199254740994';const changed=await f.run();expect(changed.sourceGeneration).not.toBe(first.sourceGeneration);
  f.journal[0]!.entity_version='9007199254740995';expect((await f.run()).sourceGeneration).not.toBe(changed.sourceGeneration);
 });
 it('does not relabel a retained database generation or a same-branch foreign till',async()=>{
  const f=fixture();f.sources[0]!.database_guid=oldDatabase;f.movements[0]!.terminal_id='foreign';
  const result=await f.run();expect(result.sourceSequence).toBe('0');expect(result.sourceRoot).toBeNull();
  expect(result.blockers).toEqual(expect.arrayContaining(['RETAINED_DATABASE_GENERATION','OTHER_TERMINAL_PENDING_MOVEMENT','UNPROVEN_ORIGINAL_SOURCE']));
  expect(result.pending.unknown).not.toBe('0');
 });
 it('retains unsigned and missing original evidence as diagnostics, not accepted history',async()=>{
  const f=fixture();f.sources[0]!.unsigned=1;f.sources[0]!.proof_bytes=null;f.movements[0]!.unsigned=1;f.movements[0]!.proof_bytes=null;
  const result=await f.run();expect(result.pending.unsigned).toBe('2');expect(result.blockers).toEqual(['UNSIGNED_MOVEMENT','UNSIGNED_SOURCE']);
  f.sources.splice(0);expect((await f.run()).blockers).toContain('UNPROVEN_ORIGINAL_SOURCE');
 });
 it('requires complete local head/opening evidence even when all pending counts are zero',async()=>{
  const f=fixture();f.sources.splice(0);f.movements.splice(0);f.journal.splice(0);f.heads[0]!.baseline_state=null;
  const result=await f.run();expect(result.pending).toEqual({business:'0',metadata:'0',unsigned:'0',unknown:'1'});expect(result.coverageProven).toBe(false);
  expect(result.blockers).toEqual(['LOCAL_COVERAGE_UNPROVEN']);
 });
 it('does not equate an arbitrary last sequence/root with a linked complete prefix',async()=>{
  const f=fixture();f.sources.push({...f.sources[0],id:id(9),source_sequence:'3',predecessor_root:'a'.repeat(64),source_root:'e'.repeat(64)});
  expect((await f.run()).blockers).toContain('BROKEN_SOURCE_PREFIX');
  f.sources[1]!.source_sequence='2';f.sources[1]!.predecessor_root='f'.repeat(64);expect((await f.run()).blockers).toContain('BROKEN_SOURCE_PREFIX');
 });
 it('stable canonical evidence ignores row return order and survives a fresh repository instance',async()=>{
  const f=fixture();f.journal.push({...f.journal[0],change_id:'2'});const first=await f.run();f.journal.reverse();
  expect(await f.run()).toEqual(first);
 });
 it('treats orphan/failed metadata journal records as held evidence without exposing private errors',async()=>{
  const f=fixture();f.journal.push({...f.journal[0],change_id:'2',entity_type:'stock_history_movements',entity_id:JSON.stringify({id:id(99)}),failed:1});
  const result=await f.run();expect(result.pending.metadata).toBe('3');expect(result.pending.business).toBe('1');
  expect(result.blockers).toEqual(['HISTORY_UPLOAD_FAILED','ORPHAN_HISTORY_JOURNAL']);
 });
 it('does not treat an unrecognized local source writer as verified coverage',async()=>{
  const f=fixture();f.movements[0]!.source_kind='unsupported-writer';
  expect((await f.run()).blockers).toContain('UNKNOWN_STOCK_WRITER');
 });
 it.each([['absent','SCHEMA_NOT_INSTALLED'],['partial','PARTIAL_SCHEMA'],['unknown','UNKNOWN_SCHEMA']])('keeps %s031 unavailable without metadata or business mutation',async(capability,reason)=>{
  const f=fixture();f.state.capability=capability;expect(await f.run()).toEqual({available:false,reason});
  expect(f.commands.some(text=>text.includes('stock-frontier:sources'))).toBe(false);expect(f.state.transaction).toBe('0');expect(f.counts().releases).toBe(1);
 });
 it.each([['1','0'],['0','2'],['3','2']])('refuses inherited transaction/options %s/%s before table reads',async(transaction,options)=>{
  const f=fixture();f.state.transaction=transaction;f.state.options=options;expect(await f.run()).toEqual({available:false,reason:'FRONTIER_CALLER_TRANSACTION'});
  expect(f.state.transaction).toBe(transaction);expect(f.state.options).toBe(options);expect(f.commands).toHaveLength(1);expect(f.commands[0]).not.toMatch(/\bFROM\b/i);
 });
 it.each(['current','lease'] as const)('requires current %s authority before acquisition and after awaited BEGIN',async(kind)=>{
  const before=fixture();before.state[kind]=false;await expect(before.run()).rejects.toBeDefined();expect(before.counts().acquires).toBe(0);
  const after=fixture();after.state.afterQuery=text=>{if(text.includes('stock-frontier:begin'))after.state[kind]=false;};
  await expect(after.run()).rejects.toBeDefined();expect(after.state.transaction).toBe('0');expect(after.commands.some(text=>text.includes('ROLLBACK'))).toBe(true);expect(after.counts().releases).toBe(1);
 });
 it('rejects a replaced pool and missing guard functions without trusting counts',async()=>{
  const f=fixture();f.state.afterQuery=text=>{if(text.includes('stock-frontier:head'))f.manager.pool={} as never;};
  await expect(f.run()).rejects.toMatchObject({code:'ESTOCK_HISTORY_CONTEXT_CHANGED'});expect(f.state.transaction).toBe('0');
  await expect(f.run({assertLease:undefined})).rejects.toBeDefined();
 });
 it('rejects a database GUID change before completion rather than certifying another database',async()=>{
  const f=fixture();f.state.afterQuery=text=>{if(text.includes('stock-frontier:clock'))f.state.databaseId=oldDatabase;};
  await expect(f.run()).rejects.toMatchObject({code:'ESTOCK_HISTORY_CONTEXT_CHANGED'});expect(f.state.transaction).toBe('0');expect(f.counts().releases).toBe(1);
 });
 it.each([1222,1205])('yields to SQL writer contention %s and rolls back its own read',async number=>{
  const f=fixture();f.state.failAt='stock-frontier:sources';f.state.failNumber=number;
  expect(await f.run()).toEqual({available:false,reason:'FRONTIER_BUSY'});expect(f.state.transaction).toBe('0');expect(f.counts().releases).toBe(1);
 });
 it('handles SQL timeout/cancellation without ACK, mutation or an inherited transaction',async()=>{
  const f=fixture();f.state.failAt='stock-frontier:movements';f.state.failCode='ECANCEL';
  expect(await f.run()).toEqual({available:false,reason:'FRONTIER_READ_UNAVAILABLE'});expect(f.state.transaction).toBe('0');expect(f.counts().releases).toBe(1);
 });
 it('bounds evidence rows and raw proof work without publishing a truncated prefix',async()=>{
  const f=fixture();f.sources.splice(0,f.sources.length,...Array.from({length:2001},(_,index)=>({...f.sources[0],id:id(index+10)})));
  expect(await f.run()).toEqual({available:false,reason:'FRONTIER_EVIDENCE_OVERSIZED'});expect(f.commands.some(text=>text.includes('source-hashes'))).toBe(false);
  const bytes=fixture();bytes.sources[0]!.proof_bytes='9007199254740993';expect(await bytes.run()).toEqual({available:false,reason:'FRONTIER_EVIDENCE_OVERSIZED'});
 });
 it('cleans a late pool acquisition exactly once after its bounded wait has expired',async()=>{
  vi.useFakeTimers();const f=fixture();let complete!:()=>void;
  f.manager.pool.acquire=(_owner,callback)=>{complete=()=>callback(null,f.connection,f.manager.pool.config);};
  const promise=f.run();await vi.advanceTimersByTimeAsync(1001);expect(await promise).toEqual({available:false,reason:'FRONTIER_BUSY'});
  expect(f.counts().releases).toBe(0);complete();await Promise.resolve();expect(f.counts().releases).toBe(1);expect(f.commands).toHaveLength(0);
 });
 it('discards only its owned connection if rollback cannot be confirmed',async()=>{
  const f=fixture();f.state.failAt='stock-frontier:movements';f.state.rollbackFails=true;
  expect(await f.run()).toEqual({available:false,reason:'FRONTIER_READ_UNAVAILABLE'});expect(f.connection.hasError).toBe(true);expect(f.counts()).toEqual({acquires:1,releases:1,closes:1});
 });
});
