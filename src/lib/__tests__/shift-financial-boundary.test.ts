import {createRequire} from "node:module";
import {createHash} from "node:crypto";
import {describe,expect,it,vi} from "vitest";
const require=createRequire(import.meta.url);
const {ShiftSyncJournal}=require("../../../electron/db/shift-sync-journal.cjs");
const {OperationsRepository}=require("../../../electron/db/repositories/operations.cjs");
const {canonical}=require("../../../electron/db/repositories/aggregates.cjs");
const branch="branch-a",shift="11111111-1111-4111-8111-111111111111",count="22222222-2222-4222-8222-222222222222";
type Row=Record<string,unknown>;
type Operation={kind:string;table:string;match?:Row;values?:Row;rows?:Row[]};
function fixture(kind="ORIGINAL",prior=false) {
  const events:string[]=[],transaction={label:"the SERIALIZABLE write transaction"};
  const totals={expected_cash:100,expected_card:20,expected_digital:10};
  const operations:Operation[]=[{kind:"update",table:"shifts",match:{id:shift},values:{store_id:branch}},
    ...(kind==="VARIANCE"?[]:[{kind:"insert",table:"shift_cash_counts",rows:[{id:count,shift_id:shift,store_id:branch,kind}]},
      {kind:"insert",table:"shift_reconciliations",rows:[{id:"33333333-3333-4333-8333-333333333333",shift_id:shift,store_id:branch,count_id:count,...totals}]}])];
  class Request {
    constructor(tx:unknown){expect(tx).toBe(transaction);}
    input(){return this;}
    async query(sql:string){if(sql.includes("SELECT note")){events.push("receipt lock");return{recordset:prior?[{note:createHash("sha256").update(JSON.stringify(canonical({kind:"protected_shift_close",branchId:branch,shiftId:shift,operations}))).digest("hex")}]:[]};}
      if(sql.includes("SELECT id")){events.push("parent lock");return{recordset:[{id:shift}]};}
      events.push("journal/receipt write");return{recordset:[]};}
  }
  const repository={connectionManager:{sql:()=>({Request,UniqueIdentifier:"uuid"})},
    tables:new Map(["shifts","shift_cash_counts","shift_reconciliations"].map(name=>[name,{columns:[{primaryKey:true,sqlServerColumn:"id"}]}])),
    validate:(ops:unknown)=>ops,
    shiftExpectedTotals:vi.fn(async (b:string,s:string,tx:unknown)=>{expect([b,s,tx]).toEqual([branch,shift,transaction]);events.push("financial read");return totals;}),
    apply:async(_context:string,ops:unknown,_scope:unknown,after:(...args:unknown[])=>Promise<unknown>,before:(...args:unknown[])=>Promise<unknown>,final:()=>Promise<unknown>)=>{
      try{const proceed=await before(transaction);if(proceed!==false){events.push("business write");await after(transaction,ops);}await final();events.push("commit");return{ok:true};}
      catch(error){events.push("rollback");throw error;}
    }};
  const journal=new ShiftSyncJournal(repository);
  journal.intents={verify:async()=>{events.push("causal check");return{};},freeze:vi.fn(async()=>({payloadHash:"hash"})),get:async()=>({}),verifySavedHistory:vi.fn()};
  journal.snapshot=async()=>new Map();
  return {events,operations,repository,journal,totals,run:()=>journal.apply("count",operations,{branchId:branch})};
}
describe("local count financial boundary",()=>{
  it.each(["ORIGINAL","RECOUNT"])("checks %s inside the write transaction before business writes and freezing",async kind=>{
    const f=fixture(kind);await f.run();expect(f.events).toEqual(["receipt lock","parent lock","causal check","financial read","business write","journal/receipt write","commit"]);
    expect(f.journal.intents.freeze).toHaveBeenCalledOnce();
  });
  it.each(["expected_cash","expected_card","expected_digital"])("rolls back a stale %s draft before writes or intent signing",async field=>{
    const f=fixture();(f.totals as Record<string,number>)[field]+=1;
    await expect(f.run()).rejects.toMatchObject({code:"ESHIFT_FINANCIAL_CONFLICT",table:"shifts"});
    expect(f.events).toEqual(["receipt lock","parent lock","causal check","financial read","rollback"]);expect(f.journal.intents.freeze).not.toHaveBeenCalled();
  });
  it("uses the existing Main rounding and rejects unavailable authoritative values",async()=>{
    const f=fixture();f.totals.expected_cash=100.004;await f.run();
    const bad=fixture();bad.totals.expected_cash=NaN;await expect(bad.run()).rejects.toMatchObject({code:"ESHIFT_FINANCIAL_CONFLICT"});
  });
  it("does not reprice variance-only approval",async()=>{const f=fixture("VARIANCE");await f.run();expect(f.repository.shiftExpectedTotals).not.toHaveBeenCalled();});
  it.each(["unknown kind","missing count","missing reconciliation","extra count","extra reconciliation"])("rejects unsupported financial shape: %s",async shape=>{
    const f=fixture();
    if(shape==="unknown kind")f.operations[1].rows![0].kind="OTHER";
    if(shape==="missing count")f.operations.splice(1,1);
    if(shape==="missing reconciliation")f.operations.splice(2,1);
    if(shape==="extra count")f.operations[1].rows!.push({...f.operations[1].rows![0]});
    if(shape==="extra reconciliation")f.operations[2].rows!.push({...f.operations[2].rows![0]});
    await expect(f.run()).rejects.toMatchObject({code:"ESHIFT_CLOSURE_SNAPSHOT"});expect(f.repository.shiftExpectedTotals).not.toHaveBeenCalled();
    expect(f.events).not.toContain("business write");expect(f.journal.intents.freeze).not.toHaveBeenCalled();
  });
  it("retains an accepted exact receipt after later financial changes",async()=>{
    const f=fixture("ORIGINAL",true);f.totals.expected_cash=0;
    await f.run();expect(f.repository.shiftExpectedTotals).not.toHaveBeenCalled();expect(f.journal.intents.verifySavedHistory).toHaveBeenCalledOnce();
    expect(f.events).toEqual(["receipt lock","parent lock","commit"]);
  });
  it("routes optional transaction reads through that transaction, retaining ordinary pool reads",async()=>{
    const tx={},seen:unknown[]=[];const result={recordset:[{expected_cash:10,expected_card:0,expected_digital:0}]};
    class Request{constructor(value:unknown){seen.push(value);}input(){return this;}async query(){return result;}}
    const poolRead=vi.fn(()=>({input(){return this;},query:async()=>result}));
    const repo=new OperationsRepository({pool:{request:poolRead},sql:()=>({Request})},{tables:[]});
    await repo.shiftExpectedTotals(branch,shift,tx);expect(seen).toEqual([tx]);expect(poolRead).not.toHaveBeenCalled();
    await repo.shiftExpectedTotals(branch,shift);expect(poolRead).toHaveBeenCalledOnce();
  });
});
