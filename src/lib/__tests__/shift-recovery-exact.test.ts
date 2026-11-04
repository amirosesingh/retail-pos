import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
const require=createRequire(import.meta.url);
const {parseExactJson,stringifyExactJson,decimal,instant,projection,exactRows}=require("../../../electron/sync/shift-recovery-exact.cjs");
const id="11111111-1111-4111-8111-111111111111";
const column=(name:string,type:string,sql:string)=>({cloudColumn:name,sqlServerColumn:name,cloudType:type,sqlServerType:sql});
const table={columns:[column("id","uuid","uniqueidentifier"),column("amount","numeric","decimal(38,12)"),column("at","timestamp with time zone","datetimeoffset(7)"),column("data","jsonb","nvarchar(max)")]};
const raw=(amount="648",stamp="2026-01-01T00:00:00.123456Z",data='{"n":1}')=>`[{"id":"${id}","amount":${amount},"at":"${stamp}","data":${data}}]`;
const local=(amount="648.000000000000",stamp="2026-01-01T08:00:00.1234560+08:00",data='{"n":1}')=>[{id,amount,at:stamp,data}];
describe("recovery-only exact evidence",()=>{
 it("roundtrips unrounded numeric lexemes and does not treat string lookalikes as raw JSON",()=>{const raw='{"huge":9007199254740993.000000000001,"tiny":1e-100,"string":"1e-100","lookalike":{"raw":"1]"}}';expect(stringifyExactJson(parseExactJson(raw))).toBe(raw);expect(()=>stringifyExactJson({n:648})).toThrow();expect(()=>stringifyExactJson(new Date())).toThrow();expect(()=>stringifyExactJson({toJSON:()=>"secret"})).toThrow();});
 it("rejects accessors, sparse arrays and cycles before invoking arbitrary code",()=>{let called=false;const obj=Object.defineProperty({},"x",{enumerable:true,get(){called=true;return "secret";}});expect(()=>stringifyExactJson(obj)).toThrow(/accessor/);expect(called).toBe(false);expect(()=>stringifyExactJson(new Array(1))).toThrow();const cycle:Record<string,unknown>={};cycle.self=cycle;expect(()=>stringifyExactJson(cycle)).toThrow();});
 it("matches SQL decimal text and exact timestamp instants without changing normal rows",()=>{expect(exactRows(table,local(),parseExactJson(raw()))).toBe(true);});
 it("retains precision beyond JS number and submillisecond Date",()=>{
  expect(JSON.parse("648.00000000000000000001")).toBe(648);
  expect(exactRows(table,local(),parseExactJson(raw("648.00000000000000000001")))).toBe(false);
  expect(exactRows(table,local(),parseExactJson(raw("648","2026-01-01T00:00:00.1234561Z")))).toBe(false);
  expect(exactRows(table,local("9007199254740993.000000000001"),parseExactJson(raw("9007199254740993.000000000001")))).toBe(true);
 });
 it("refuses already-rounded numeric/Date values and missing facts",()=>{
  expect(exactRows(table,local(),JSON.parse(raw()))).toBe(false);
  expect(exactRows(table,[{...local()[0],at:new Date("2026-01-01T00:00:00.123Z")}],parseExactJson(raw()))).toBe(false);
  const missing=parseExactJson(raw());delete missing[0].data;expect(exactRows(table,local(),missing)).toBe(false);
 });
 it("preserves JSON numeric/string distinction and nested decimal precision",()=>{
  expect(exactRows(table,local("648",undefined,'{"n":"1"}'),parseExactJson(raw()))).toBe(false);
  expect(exactRows(table,local("648",undefined,'{"n":9007199254740993}'),parseExactJson(raw("648",undefined,'{"n":9007199254740992}')))).toBe(false);
  expect(exactRows(table,local("648",undefined,'{"b":[true,null],"a":1.000}'),parseExactJson(raw("648",undefined,'{"a":1e0,"b":[true,null]}')))).toBe(true);
 });
 it("rejects duplicate keys including escaped spelling and prototype-shaped collisions",()=>{
  for(const text of ['{"x":1,"x":2}','{"x":1,"\\u0078":2}','{"a":{"x":1,"x":1}}'])expect(()=>parseExactJson(text)).toThrow(/Duplicate/);
  const object=parseExactJson('{"__proto__":{"safe":true}}');expect(Object.getPrototypeOf(object)).toBe(null);expect(object.__proto__.safe).toBe(true);expect(({} as Record<string,unknown>).safe).toBeUndefined();
 });
 it.each(['','01','1.','+1','NaN','Infinity','[1,]','{"x":}','"unclosed','true false','[','{"x" 1}','[1] extra','"bad\nstring"'])('rejects malformed input %s',(text)=>{expect(()=>parseExactJson(text)).toThrow();});
 it("enforces exact byte, depth and row boundaries",()=>{
  expect(parseExactJson('"'+"x".repeat(6*1024*1024-2)+'"').length).toBe(6*1024*1024-2);
  expect(()=>parseExactJson('"'+"x".repeat(6*1024*1024-1)+'"')).toThrow(/bounded/);
  expect(()=>parseExactJson('"雪"',{maxBytes:4})).toThrow(/bounded/);
  expect(()=>parseExactJson('['.repeat(128)+'0'+']'.repeat(128))).not.toThrow();
  expect(()=>parseExactJson('['.repeat(129)+'0'+']'.repeat(129))).toThrow(/depth/);
  const onlyId={columns:[table.columns[0]]};const rows=Array.from({length:2000},(_,n)=>({id:`11111111-1111-4111-8111-${String(n).padStart(12,"0")}`}));expect(exactRows(onlyId,rows,rows)).toBe(true);expect(exactRows(onlyId,[...rows,{id}], [...rows,{id}])).toBe(false);
 });
 it("normalizes exact decimal exponents and rejects invalid or excessive ones",()=>{expect(decimal("1.2300e2")).toBe(decimal("123"));expect(decimal("-0.000")).toBe("0");expect(decimal("1e1001")).toBeUndefined();expect(decimal(648)).toBeUndefined();});
 it("validates dates and zone offsets without rounding fractions",()=>{expect(instant("2026-02-30T00:00:00Z")).toBeUndefined();expect(instant("2026-01-01T24:00:00Z")).toBeUndefined();expect(instant("2026-01-01T00:00:00+14:01")).toBeUndefined();expect(instant("2026-01-01T00:00:00.00000001Z")).toBeUndefined();expect(instant("2026-01-01T00:00:00.0000001Z")).not.toBe(instant("2026-01-01T00:00:00Z"));});
 it("projects database values as exact strings and never accepts SQL identifier input",()=>{const sql=projection(table);expect(sql).toContain("CONVERT(nvarchar(100),source.[amount])");expect(sql).toContain("CONVERT(nvarchar(40),source.[at],127)");expect(()=>projection(table,"x;DROP")).toThrow();expect(()=>projection({columns:[column("bad]","text","text")]})).toThrow();});
 it("rejects unequal sets, duplicates, null-vs-value and invalid UUIDs",()=>{expect(exactRows(table,[...local(),...local()],parseExactJson(raw()))).toBe(false);expect(exactRows(table,local(),[...parseExactJson(raw()),...parseExactJson(raw())])).toBe(false);expect(exactRows(table,local(),parseExactJson(raw("null")))).toBe(false);expect(exactRows(table,[{...local()[0],id:"-".repeat(36)}],parseExactJson(raw()))).toBe(false);});
});
