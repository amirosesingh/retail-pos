import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const require = createRequire(import.meta.url);
const { SyncCoordinator } = require("../../../electron/sync/coordinator.cjs");
const { tagBootstrapDiagnostic, bootstrapDiagnostic } = require("../../../electron/diagnostics.cjs");
const safe = { transportOperation:"feed",transportStage:"fetch",transportCode:"ECONNRESET",transportErrorName:"TypeError",httpStatus:503,nonJsonResponse:true,table:"products",phase:"download",origin:"gap_recovery" };
function coordinator(push:()=>Promise<unknown>,pull:()=>Promise<unknown>){return new SyncCoordinator({pushWorker:{run:push},pullWorker:{run:pull}});}
describe("coordinator private transport diagnostics",()=>{
 it.each(["push","pull"])("preserves safe %s failure metadata privately across the returned snapshot",async direction=>{
  const error=tagBootstrapDiagnostic(Object.assign(new Error("fetch failed"),{code:"ESYNC"}),{...safe,secret:"never-export",url:"https://private.invalid/token"});
  const ok=async()=>({}),fail=async()=>{throw error;};
  const c=coordinator(direction==="push"?fail:ok,direction==="pull"?fail:ok);
  const result=await c.runNow({branchId:"branch"});
  expect(result).toMatchObject({ok:false,code:"ESYNC",error:"fetch failed",table:null,running:false});
  expect(bootstrapDiagnostic(result,["products"])).toEqual({...safe,phase:undefined,origin:undefined,bootstrapPhase:"download",bootstrapOrigin:"gap_recovery"});
  const descriptor=Object.getOwnPropertyDescriptor(result,"bootstrapDiagnostic")!;
  expect(descriptor.enumerable).toBe(false);expect(Object.isFrozen(descriptor.value)).toBe(true);
  const serialized=JSON.stringify(result);expect(serialized).not.toContain("transport");expect(serialized).not.toContain("never-export");expect(serialized).not.toContain("private.invalid");
  expect(bootstrapDiagnostic(c.snapshot(),["products"])).toEqual({});
 });
 it("does not retain arbitrary fields or evaluate diagnostic accessors",async()=>{
  let reads=0;const error=new Error("fetch failed");Object.defineProperty(error,"bootstrapDiagnostic",{get(){reads++;throw Error("secret");}});
  const c=coordinator(async()=>{throw error;},async()=>({}));const result=await c.runNow({branchId:"branch"});
  expect(result.ok).toBe(false);expect(reads).toBe(0);expect(bootstrapDiagnostic(result,[])).toEqual({});
 });
 it("does not leak old failure metadata into a successful retry or add enumerable result keys",async()=>{
  let fail=true;const c=coordinator(async()=>{if(fail)throw tagBootstrapDiagnostic(new Error("fetch failed"),safe);return {};},async()=>({}));
  const first=await c.runNow({branchId:"branch"});fail=false;const success=await c.runNow({branchId:"branch"});
  expect(first.ok).toBe(false);expect(success.ok).toBe(true);expect(bootstrapDiagnostic(success,["products"])).toEqual({});
  expect(Object.keys(success)).not.toContain("bootstrapDiagnostic");expect(JSON.stringify(success)).not.toContain("ECONNRESET");
 });
 it("passes sanitized private evidence to the existing automatic failure log only",()=>{
  const source=readFileSync(new URL("../../../electron/main.cjs",import.meta.url),"utf8");
  const line=source.split("\n").find(line=>line.includes('if (!result.ok) diagnostics.logConnection("synchronization.automatic.failed"'))!;
  const logs:unknown[][]=[];
  const result=tagBootstrapDiagnostic({ok:false,code:"ESYNC",error:"fetch failed"},{...safe,secret:"never-export"});
  const logFailure=new Function("result","failure","diagnostics","syncRegistry",line);
  // Main retains the original private failure separately from its public result.
  logFailure(result,result,{bootstrapDiagnostic,logConnection:(...args:unknown[])=>logs.push(args)},{tables:[{cloudTable:"products"}]});
  expect(logs).toHaveLength(1);expect(logs[0][0]).toBe("synchronization.automatic.failed");
  expect(logs[0][1]).toMatchObject({transportCode:"ECONNRESET",table:"products",bootstrapPhase:"download",category:"synchronization"});
  expect(JSON.stringify(logs)).not.toContain("never-export");
  logFailure({ok:true},undefined,{bootstrapDiagnostic,logConnection:(...args:unknown[])=>logs.push(args)},{tables:[]});
  expect(logs).toHaveLength(1);
 });
});
