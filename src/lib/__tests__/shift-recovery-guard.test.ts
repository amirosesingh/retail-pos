import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
const require=createRequire(import.meta.url);
const {ChangeReader}=require("../../../electron/sync/change-reader.cjs");
const {applyShiftGraphs,prepareShiftGraphs}=require("../../../electron/sync/shift-graph.cjs");
const {CloudClient}=require("../../../electron/sync/cloud-client.cjs");
const {rememberGraph,exactGraph}=require("../../../electron/sync/shift-recovery-exact.cjs");
const {ShiftGapRecovery}=require("../../../electron/sync/shift-gap-recovery.cjs");
const {loadRegistry}=require("../../../electron/db/schema-registry.cjs");
type Row=Record<string,unknown>;
type Table={cloudTable:string;sqlServerTable:string;columns:Array<{cloudColumn:string;sqlServerColumn:string;cloudType:string;sqlServerType:string;nullable:boolean}>};
type Graph={ok:boolean;shiftGraphVersion:number;branchId:string;shiftId:string;graphToken:string|null;closedAtRaw:string|null;tables:Array<{table:string;rows:Row[]}>};
const branch="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",foreign="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const uuid=(n:number)=>`11111111-1111-4111-8111-${String(n).padStart(12,"0")}`;
const names=["shifts","shift_cash_counts","shift_reconciliations","shift_close_events","shift_notifications","shift_variance_alerts"];
const registry:{tables:Table[]}=loadRegistry();
function row(name:string,n:number):Row{
 const table=registry.tables.find((t:Table)=>t.cloudTable===name);if(!table)throw new Error("Unregistered fixture table");const r:Row={};
 for(const c of table.columns){const type=c.cloudType;r[c.cloudColumn]=c.nullable?null:type==="uuid"?uuid(n):/^(numeric|bigint|integer|smallint|real|double)/.test(type)?0:type==="boolean"?false:/^timestamp/.test(type)?"2026-01-01T00:00:00.123456Z":type==="date"?"2026-01-01":type==="jsonb"?{}:type.endsWith("[]")?[]:"fixture";}
 return {...r,id:uuid(n),store_id:branch,...(name!=="shifts"?{shift_id:uuid(1)}:{})};
}
function graph(open=false):Graph{
 const p={...row("shifts",1),status:open?"OPEN":"CLOSED",state:open?"ACTIVE":"CLOSED",closed_at:open?null:"2026-01-01T01:00:00.123456Z",counted_cash:open?null:0,final_counted_cash:open?null:0,counted_card:null,counted_digital:null,expected_cash:open?null:0,expected_card:open?null:0,expected_digital:open?null:0,variance_cash:open?null:0,variance_card:null,variance_digital:null,variance_total:open?null:0,variance_status:open?null:"NO_VARIANCE"};
 const c:Row={...row("shift_cash_counts",2),kind:"ORIGINAL",counted_cash:0,counted_card:null,counted_digital:null};
 const r={...row("shift_reconciliations",3),count_id:c.id,counted_cash:0,counted_card:null,counted_digital:null,expected_cash:0,expected_card:0,expected_digital:0,variance_cash:0,variance_card:null,variance_digital:null,variance_total:0,variance_status:"NO_VARIANCE"};
 return {ok:true,shiftGraphVersion:1,branchId:branch,shiftId:uuid(1),graphToken:open?null:"f".repeat(64),closedAtRaw:p.closed_at,tables:names.map(name=>({table:name,rows:name==="shifts"?[p]:open?[]:name==="shift_cash_counts"?[c]:name==="shift_reconciliations"?[r]:[]}))};
}
const trust=(g:Graph):Graph=>{const raw=JSON.stringify(g);return rememberGraph(JSON.parse(raw),raw,"1");};
function fixture(g=graph()){
 const local:Record<string,Row[]>={};for(const part of g.tables){const table=registry.tables.find((t:Table)=>t.cloudTable===part.table);if(!table)throw new Error("Unregistered fixture table");local[part.table]=part.rows.map((r:Row)=>Object.fromEntries(table.columns.map((c:Table["columns"][number])=>[c.sqlServerColumn,r[c.cloudColumn]===null?null:/^(numeric|bigint|integer|smallint|real|double)/.test(c.cloudType)?String(r[c.cloudColumn]):c.cloudType==="jsonb"||c.cloudType.endsWith("[]")?JSON.stringify(r[c.cloudColumn]):r[c.cloudColumn]])));}
 const state={local,journal:[] as Row[],intents:[] as Row[],tracked:[] as Row[],minimum:20,current:30,checkpoint:10,writes:[] as string[],saved:[] as unknown[][]};
 class Transaction{async begin(){}async commit(){}async rollback(){} request(){return new Request(this);}}
 class Request{values:Row={};constructor(readonly owner:object){}input(k:string,v:unknown){this.values[k]=v;return this;}async query(sql:string):Promise<{recordset:Row[]}>{
  const p=this.values;const name=/FROM dbo\.\[([^\]]+)\]/.exec(sql)?.[1]??/CHANGES dbo\.\[([^\]]+)\]/.exec(sql)?.[1];
  if(sql.includes("MERGE")||sql.includes("INSERT ")||sql.includes("UPDATE ")&&!sql.includes("UPDLOCK")){state.writes.push(sql);return {recordset:[]};}
  if(sql.includes("minimum_version")&&p.tables)return {recordset:names.map(n=>({table_name:n,minimum_version:String(state.minimum),current_version:String(state.current)}))};
  if(sql.includes("AS checkpoint_version"))return {recordset:[{checkpoint_version:state.checkpoint,min_version:state.minimum,current_version:state.current}]};
  if(sql.includes("pos_sync_shift_intents"))return {recordset:state.intents.filter(r=>r.acknowledged_at==null&&(p.shift===undefined||r.shift_id===p.shift))};
  if(sql.includes("sync_change_journal"))return {recordset:state.journal.filter(r=>r.acknowledged_at==null&&(p.entity===undefined||r.entity_type===p.entity))};
  if(sql.includes("CHANGETABLE"))return {recordset:state.tracked.filter(r=>r.table===name)};
  if(!name)throw new Error("Unexpected fixture query "+sql);
  const data=state.local[name]??[];
  let selected=data.filter(r=>p.shift!==undefined?(name==="shifts"?r.id:r.shift_id)===p.shift:p.shifts?JSON.parse(String(p.shifts)).includes(name==="shifts"?r.id:r.shift_id):p.ids?JSON.parse(String(p.ids)).includes(r.id):true);
  if(sql.includes(" AS shift_id"))selected=selected.map(r=>({id:r.id,store_id:r.store_id,shift_id:name==="shifts"?r.id:r.shift_id}));
  return {recordset:structuredClone(selected)};
 }}
 const pool={request:()=>new Request(pool)};const manager={pool,sql:()=>({Request,Transaction,ISOLATION_LEVEL:{SERIALIZABLE:4}})};
 const reader=new ChangeReader(manager,registry);const tx=new Transaction();
 const recovery=()=>new ShiftGapRecovery({connectionManager:manager,registry,reader,checkpoints:{advanceRecovery:async(...args:unknown[])=>{state.saved.push(args);}},branchId:branch,tableName:"shifts",cloud:{terminalId:()=>uuid(99),backendUrl:()=>"https://fixture.test"}});
 return {state,manager,reader,tx,recovery};
}
const pending=(f:ReturnType<typeof fixture>,g:Graph,tx=f.tx)=>f.reader.pendingShiftGraph(registry.tables.find((t:Table)=>t.cloudTable==="shifts"),[JSON.stringify({id:uuid(1)})],tx,{branchId:branch,changes:[{row_data:g.tables[0].rows[0]}],incomingGraph:g});
afterEach(()=>vi.unstubAllGlobals());
describe("fresh complete no-op shift recovery guard",()=>{
 it.each([false,true])("permits exact closed/open match without business or baseline writes (%s)",async open=>{const g=trust(graph(open)),f=fixture(graph(open));const prepared=await prepareShiftGraphs({cloud:{shiftGraph:async()=>g},connectionManager:f.manager,branchId:branch,changes:[{table_name:"shifts",entity_id:JSON.stringify({id:uuid(1)}),tombstone:false}]});await applyShiftGraphs({transaction:f.tx,connectionManager:f.manager,registry,reader:f.reader,branchId:branch,prepared});expect(f.state.writes).toEqual([]);expect(prepared.covers({table_name:"shifts",entity_id:JSON.stringify({id:uuid(1)}),row_data:g.tables[0].rows[0]})).toBe(true);});
 it("rejects rounded bodies, body flags, missing/unknown capabilities",async()=>{for(const capability of [undefined,"2"]){const raw=JSON.stringify({...graph(),exact:true});const g=rememberGraph(JSON.parse(raw),raw,capability);const f=fixture();await expect(pending(f,g)).rejects.toMatchObject({code:"ELOCAL_PENDING_UNVERIFIED"});expect(f.state.writes).toEqual([]);}});
 it("retains divergent amounts, times, clocks, local-only and deleted history",async()=>{for(const change of [(f:ReturnType<typeof fixture>)=>f.state.local.shifts[0].counted_cash="1",(f:ReturnType<typeof fixture>)=>f.state.local.shifts[0].closed_at="2026-01-01T01:00:00.1234561Z",(f:ReturnType<typeof fixture>)=>f.state.local.shifts[0].row_version="2",(f:ReturnType<typeof fixture>)=>f.state.local.shift_cash_counts.push({...f.state.local.shift_cash_counts[0],id:uuid(4)}),(f:ReturnType<typeof fixture>)=>f.state.local.shift_cash_counts.splice(0)]){const f=fixture();change(f);await expect(pending(f,trust(graph()))).rejects.toMatchObject({code:"ELOCAL_PENDING_UNVERIFIED"});}});
 it("rejects pending/orphan journals and unacknowledged protected intents",async()=>{const f=fixture();f.state.journal.push({entity_type:"shift_cash_counts",entity_id:JSON.stringify({id:uuid(99)})});expect(await pending(f,trust(graph()))).toBe(true);f.state.journal=[];f.state.intents.push({shift_id:uuid(1)});await expect(pending(f,trust(graph()))).rejects.toMatchObject({code:"ELOCAL_PENDING_UNVERIFIED"});});
 it("does not reuse proof across graph changes, mutation, branch or transaction",async()=>{const f=fixture(),g=trust(graph());expect(await pending(f,g)).toBe(false);expect(f.reader.exactShiftGraphNoop(f.tx,branch,g)).toBe(true);expect(f.reader.exactShiftGraphNoop({},branch,g)).toBe(false);expect(f.reader.exactShiftGraphNoop(f.tx,foreign,g)).toBe(false);const changed=graph();changed.tables[0].rows[0].note="new";await expect(pending(f,trust(changed))).rejects.toMatchObject({code:"ELOCAL_PENDING_UNVERIFIED"});g.tables[0].rows[0].note="mutated";expect(exactGraph(g,branch,uuid(1))).toBe(null);expect(f.reader.exactShiftGraphNoop(f.tx,branch,g)).toBe(false);});
 it("keeps ordinary retained-CT guards unchanged",async()=>{const f=fixture();f.state.minimum=1;expect(await pending(f,graph())).toBe(false);expect(f.reader.exactShiftGraphNoop(f.tx,branch,graph())).toBe(false);});
});
describe("whole-branch recovery completion",()=>{
 it("requires all retained graph proofs and advances only captured V0",async()=>{const f=fixture(),r=await f.recovery().begin();await expect(r.finish()).rejects.toMatchObject({code:"ELOCAL_PENDING_UNVERIFIED"});const g=trust(graph());await pending(f,g);r.note(f.tx,uuid(1),g);r.committed(f.tx);f.state.current=40;expect(await r.finish()).toMatchObject({currentVersion:"30",retainedShifts:1});expect(f.state.saved[0][2]).toBe("30");expect(f.state.writes).toEqual([]);});
 it("does not retain proof from a rolled-back page",async()=>{const f=fixture(),r=await f.recovery().begin(),g=trust(graph());await pending(f,g);r.note(f.tx,uuid(1),g);await expect(r.finish()).rejects.toMatchObject({code:"ELOCAL_PENDING_UNVERIFIED"});expect(f.state.saved).toEqual([]);});
 it("does not finalize a proof after backend or SQL pool identity changes",async()=>{for(const mutate of [(r:InstanceType<typeof ShiftGapRecovery>,_f:ReturnType<typeof fixture>)=>{r.cloud.backendUrl=()=>"https://another.test";},(_r:InstanceType<typeof ShiftGapRecovery>,f:ReturnType<typeof fixture>)=>{f.manager.pool={request:()=>{throw new Error("must not query new profile");}};}]){const f=fixture(),r=await f.recovery().begin(),g=trust(graph());await pending(f,g);r.note(f.tx,uuid(1),g);r.committed(f.tx);mutate(r,f);await expect(r.finish()).rejects.toMatchObject({code:"SYNC_BRANCH_FORBIDDEN"});expect(f.state.saved).toEqual([]);}});
 it("rejects deletion of complete retained graph before cloud page",async()=>{const f=fixture(),r=await f.recovery().begin();for(const n of names)f.state.local[n]=[];const g=trust(graph());const prepared=await prepareShiftGraphs({cloud:{shiftGraph:async()=>g},connectionManager:f.manager,branchId:branch,changes:[{table_name:"shifts",entity_id:JSON.stringify({id:uuid(1)}),tombstone:false}]});await expect(applyShiftGraphs({transaction:f.tx,connectionManager:f.manager,registry,reader:f.reader,branchId:branch,prepared,recovery:r})).rejects.toMatchObject({code:"ELOCAL_PENDING_UNVERIFIED"});expect(f.state.writes).toEqual([]);expect(f.state.saved).toEqual([]);});
 it("rejects local-only/orphan identity, missing coverage and concurrent edits/deletes",async()=>{const orphan=fixture();orphan.state.local.shift_cash_counts[0].shift_id=uuid(88);await expect(orphan.recovery().begin()).rejects.toMatchObject({code:"ELOCAL_PENDING_UNVERIFIED"});for(const mutate of [(f:ReturnType<typeof fixture>)=>f.state.local.shifts[0].note="later",(f:ReturnType<typeof fixture>)=>f.state.tracked.push({table:"shifts",id:uuid(9),operation:"D",context:null}),(f:ReturnType<typeof fixture>)=>f.state.tracked.push({table:"shifts",id:uuid(1),operation:"U",context:null}),(f:ReturnType<typeof fixture>)=>f.state.minimum=31]){const f=fixture(),r=await f.recovery().begin(),g=trust(graph());await pending(f,g);r.note(f.tx,uuid(1),g);r.committed(f.tx);mutate(f);await expect(r.finish()).rejects.toHaveProperty("code");expect(f.state.saved).toEqual([]);}});
});
describe("native graph transport capability",()=>{
 it("binds proof to successful header-bearing fresh response without visible fields",async()=>{const raw=JSON.stringify(graph());vi.stubGlobal("fetch",vi.fn(async()=>new Response(raw,{headers:{"X-POS-Shift-Graph-Exact":"1"}})));const client=new CloudClient({configStore:{get:()=>"https://fixture.test"},terminalStore:{read:()=>({tokenId:uuid(99)})}});const actual=await client.shiftGraph({branchId:branch,shiftId:uuid(1)});expect(JSON.stringify(actual)).toBe(raw);expect(exactGraph(actual,branch,uuid(1))).not.toBe(null);});
 it.each([undefined,"2"])("does not grant proof from legacy/unknown transport header %s",async header=>{vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({...graph(),exact:true}),{headers:header?{"X-POS-Shift-Graph-Exact":header}:{}})));const client=new CloudClient({configStore:{get:()=>"https://fixture.test"},terminalStore:{read:()=>({tokenId:uuid(99)})}});const actual=await client.shiftGraph({branchId:branch,shiftId:uuid(1)});expect(exactGraph(actual,branch,uuid(1))).toBe(null);});
 it("preserves a complete large ordinary graph without granting exact proof",async()=>{const source=graph();source.tables[0].rows[0].note="x".repeat(33*1024);const raw=JSON.stringify(source);vi.stubGlobal("fetch",vi.fn(async()=>new Response(raw)));const client=new CloudClient({configStore:{get:()=>"https://fixture.test"},terminalStore:{read:()=>({tokenId:uuid(99)})}});const actual=await client.shiftGraph({branchId:branch,shiftId:uuid(1)});expect(JSON.stringify(actual)).toBe(raw);expect(exactGraph(actual,branch,uuid(1))).toBe(null);await expect(pending(fixture(source),actual)).rejects.toMatchObject({code:"ELOCAL_PENDING_UNVERIFIED"});});
});
