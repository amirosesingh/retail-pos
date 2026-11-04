import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
const require=createRequire(import.meta.url);
const {tagBootstrapDiagnostic,bootstrapDiagnostic}=require("../../../electron/diagnostics.cjs");
const fields={transportOperation:"feed",transportStage:"fetch",transportCode:"ENOTFOUND",transportErrorName:"TypeError"};
function fixture(){
 const lines:string[]=[];const module={exports:{} as {logConnection:(event:string,detail:object)=>void;databaseErrors:()=>Array<Record<string,unknown>>}};
 const fs={statSync:()=>({size:0}),appendFileSync:(_p:string,text:string)=>lines.push(text),readFileSync:()=>lines.join("")};
 runInNewContext(readFileSync("electron/diagnostics.cjs","utf8"),{module,require:(name:string)=>name==="node:fs"?fs:name==="electron"?{app:{getPath:()=>"fixture"}}:require(name),process,Date});
 return {...module.exports,lines};
}
describe("fixed allowlisted transport diagnostic evidence",()=>{
 it("keeps private frozen nonenumerable fields and preserves existing bootstrap evidence",()=>{
  const error=Object.assign(Error("fetch failed"),{code:"UNCHANGED"});expect(tagBootstrapDiagnostic(error,{...fields,table:"products",phase:"download",httpStatus:503,nonJsonResponse:true})).toBe(error);
  expect(Object.getOwnPropertyDescriptor(error,"bootstrapDiagnostic")?.enumerable).toBe(false);expect(Object.isFrozen(Object.getOwnPropertyDescriptor(error,"bootstrapDiagnostic")?.value)).toBe(true);
  expect(bootstrapDiagnostic(error,["products"])).toEqual({...fields,table:"products",bootstrapPhase:"download",httpStatus:503,nonJsonResponse:true});
  tagBootstrapDiagnostic(error,{origin:"gap_recovery"});expect(bootstrapDiagnostic(error,["products"])).toMatchObject({...fields,bootstrapOrigin:"gap_recovery"});expect(error.code).toBe("UNCHANGED");
 });
 it.each(["ENOTFOUND","EAI_AGAIN","ECONNRESET","ECONNREFUSED","ETIMEDOUT","UND_ERR_CONNECT_TIMEOUT","UND_ERR_HEADERS_TIMEOUT","UND_ERR_BODY_TIMEOUT","UND_ERR_SOCKET","ABORT_ERR"])("accepts only the explicit network code %s",code=>{
  expect(bootstrapDiagnostic(tagBootstrapDiagnostic(Error(),{transportCode:code}),[])).toEqual({transportCode:code});
 });
 it.each(["feed","bootstrap","graph","count","upload","other"])("accepts fixed operation %s",transportOperation=>{
  expect(bootstrapDiagnostic(tagBootstrapDiagnostic(Error(),{transportOperation}),[])).toEqual({transportOperation});
 });
 it.each(["TypeError","TimeoutError","AbortError","Error"])("accepts fixed error name %s",transportErrorName=>{
  expect(bootstrapDiagnostic(tagBootstrapDiagnostic(Error(),{transportErrorName,transportStage:"body"}),[])).toEqual({transportErrorName,transportStage:"body"});
 });
 it("never invokes getters, reads prototypes, raw cause, URLs or arbitrary strings",()=>{
  let invoked=0;const bad=Object.create({transportOperation:"feed"});Object.defineProperty(bad,"transportStage",{get(){invoked++;throw Error("secret");}});
  bad.transportCode="ENOTFOUND password=private https://secret.invalid";bad.transportErrorName="TypeError\nsecret";bad.cause={code:"ECONNRESET"};
  const error=tagBootstrapDiagnostic(Error(),bad);expect(bootstrapDiagnostic(error,[])).toEqual({});expect(invoked).toBe(0);
  const foreign=Object.defineProperty({},"bootstrapDiagnostic",{get(){invoked++;throw Error("secret");}});expect(bootstrapDiagnostic(foreign,[])).toEqual({});expect(invoked).toBe(0);
 });
 it("does not mutate or replace frozen errors",()=>{
  const error=Object.freeze(Error("original"));expect(tagBootstrapDiagnostic(error,fields)).toBe(error);expect(bootstrapDiagnostic(error,[])).toEqual({});
 });
 it("revalidates forged private fields without reading getters",()=>{
  let invoked=0;const forged=Object.defineProperty({...fields,transportCode:"P0001 https://secret"},"transportStage",{get(){invoked++;return "body";}});
  const error=Object.defineProperty({},"bootstrapDiagnostic",{value:forged});expect(bootstrapDiagnostic(error,[])).toEqual({transportOperation:"feed",transportErrorName:"TypeError"});expect(invoked).toBe(0);
 });
 it("writes and renders only approved transport values",()=>{
  const f=fixture();f.logConnection("sync.failed",{...fields,failed:true,category:"synchronization",stage:"automatic",code:"EOFFLINE",message:"fetch failed"});
  expect(f.lines.join("")).toContain('"transportCode":"ENOTFOUND"');expect(f.databaseErrors()[0]).toMatchObject(fields);
  const bad={...fields,transportOperation:"https://secret.invalid",transportCode:"ENOTFOUND token=private",transportErrorName:"secret",transportStage:"body secret"};f.logConnection("sync.failed",{...bad,failed:true,message:"fetch failed"});expect(f.lines.at(-1)).not.toContain("transport");expect(f.lines.join("")).not.toContain("private");
 });
 it("does not invoke transport detail getters during logging",()=>{
  const f=fixture();let reads=0;const detail={failed:true,message:"fetch failed"};for(const key of Object.keys(fields))Object.defineProperty(detail,key,{get(){reads++;throw Error("private");}});expect(()=>f.logConnection("sync.failed",detail)).not.toThrow();expect(reads).toBe(0);expect(f.lines.join("")).not.toContain("transport");
 });
});
