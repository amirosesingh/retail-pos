import { createRequire } from "node:module";
import { afterEach, expect, it, vi } from "vitest";
const require=createRequire(import.meta.url);
const {CloudClient}=require("../../../electron/sync/cloud-client.cjs");
const {bootstrapDiagnostic}=require("../../../electron/diagnostics.cjs");
const client=()=>new CloudClient({configStore:{get:()=>"https://fixture.invalid"},terminalStore:{read:()=>({tokenId:"fixture",deviceBindingProof:"a".repeat(64)})}});
afterEach(()=>vi.unstubAllGlobals());
it.each([
 [{sqlServerPull:{branchId:"branch"}},"feed"],
 [{sqlServerScopedHistory:{action:"feed",branchId:"branch"}},"feed"],
 [{sqlServerScopedHistory:{action:"counts",branchId:"branch"}},"count"],
 [{sqlServerScopedHistory:{action:"begin",branchId:"branch"}},"bootstrap"],
 [{sqlServerBootstrap:{branchId:"branch"}},"bootstrap"],
 [{sqlServerShiftGraph:{branchId:"branch"}},"graph"],
 [{sqlServerCounts:{branchId:"branch"}},"count"],
 [{sqlServerBatch:{branchId:"branch"}},"upload"],
 [{sqlServerAggregate:{branchId:"branch"}},"upload"],
 [{unknown:true},"other"],
])("records only the failed request category without changing errors or requests",async(payload,operation)=>{
 const error=new TypeError("fetch failed",{cause:Object.assign(Error("secret URL and password"),{code:"ECONNRESET"})});
 const fetcher=vi.fn(async()=>{throw error;});vi.stubGlobal("fetch",fetcher);
 await expect(client().request(payload)).rejects.toBe(error);
 expect(bootstrapDiagnostic(error,[])).toEqual({transportOperation:operation,transportStage:"fetch",transportCode:"ECONNRESET",transportErrorName:"TypeError"});
 expect(fetcher).toHaveBeenCalledOnce();
 expect(JSON.stringify(error)).not.toContain("transport");
});
it("identifies interrupted successful response bodies while preserving their original error",async()=>{
 const error=new TypeError("terminated",{cause:Object.assign(Error("private"),{code:"UND_ERR_SOCKET"})});
 vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,status:200,headers:new Headers({"X-POS-Scoped-History-Transport":"1"}),json:async()=>{throw error;}})));
 await expect(client().pullBatch({branchId:"branch",cursor:1,limit:100})).rejects.toBe(error);
 expect(bootstrapDiagnostic(error,[])).toMatchObject({transportStage:"body",transportCode:"UND_ERR_SOCKET",transportOperation:"feed"});
});
it("does not evaluate a cause getter or attach arbitrary network messages",async()=>{
 const getter=vi.fn(()=>{throw Error("must not run");});const error=new TypeError("fetch failed");
 Object.defineProperty(error,"cause",{get:getter});
 vi.stubGlobal("fetch",vi.fn(async()=>{throw error;}));
 await expect(client().request({sqlServerPull:{}})).rejects.toBe(error);
 expect(getter).not.toHaveBeenCalled();expect(bootstrapDiagnostic(error,[])).not.toHaveProperty("transportCode");
});
it("retains the existing timeout wrapper and cause",async()=>{
 const error=Object.assign(Error("original timeout"),{name:"TimeoutError",code:"ETIMEDOUT"});
 vi.stubGlobal("fetch",vi.fn(async()=>{throw error;}));
 try {await client().request({sqlServerPull:{}});throw Error("expected rejection");}
 catch(failure){expect(failure).toMatchObject({code:"ETIMEDOUT",cause:error});expect(bootstrapDiagnostic(failure,[])).toMatchObject({transportErrorName:"TimeoutError",transportStage:"fetch",transportCode:"ETIMEDOUT"});}
});
it("preserves frozen transport errors without introducing a replacement failure",async()=>{
 const error=Object.freeze(new TypeError("fetch failed"));vi.stubGlobal("fetch",vi.fn(async()=>{throw error;}));
 await expect(client().request({sqlServerPull:{}})).rejects.toBe(error);
 expect(bootstrapDiagnostic(error,[])).toEqual({});
});
