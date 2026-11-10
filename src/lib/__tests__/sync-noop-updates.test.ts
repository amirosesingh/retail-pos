import {createRequire} from "node:module";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {describe,expect,it} from "vitest";
const require=createRequire(import.meta.url);
const {CloudClient}=require("../../../electron/sync/cloud-client.cjs");
const {loadRegistry}=require("../../../electron/db/schema-registry.cjs");
const registry=loadRegistry();
function fixture(){
 const queries:string[]=[],values:unknown[]=[];
 class Request {input(_name:string,value:unknown){values.push(value);return this;}async query(text:string){queries.push(text);return {rowsAffected:[1],recordset:[]};}}
 return {queries,values,transaction:{request:()=>new Request()},client:new CloudClient({connectionManager:{sql:()=>({Request})}})};
}
describe("ordinary download effective-assignment no-op guard",()=>{
 it("compares incoming persisted fields, not row version alone or collation text equality",async()=>{
  const h=fixture();await h.client.applyLocalBatch(h.transaction,registry.tables.find((t:{cloudTable:string})=>t.cloudTable==="products"),{rows:[{entity_id:'{"id":"00000000-0000-4000-8000-000000000001"}',row_data:{id:"00000000-0000-4000-8000-000000000001",name:"Case ",owner_store_id:null,cost_price:"1.0000",row_version:1}}]});
  const query=h.queries.at(-1);expect(query).toContain("EXCEPT SELECT");expect(query).toContain("CONVERT(varbinary(max),target.[name])");expect(query).toContain("DATALENGTH(target.[name])");expect(query).toContain("DATALENGTH(CONVERT(nvarchar(max),source.[name]))");expect(query).toContain("CONVERT(nvarchar(max),source.[name])");expect(query).toContain("TRY_CONVERT(decimal(38,12),source.[cost_price])");expect(query).toContain("source.[cost_price] IS NOT NULL");expect(query).toContain("target.[owner_store_id]");expect(query).toContain("WITH(HOLDLOCK)");
 });
 it("retains existing device field exclusion rather than comparing or persisting forbidden fields",async()=>{
  const h=fixture();await h.client.applyLocalBatch({},registry.tables.find((t:{cloudTable:string})=>t.cloudTable==="app_users"),{rows:[{row_data:{id:"00000000-0000-4000-8000-000000000001",full_name:"Synthetic",auth_user_id:"not-for-device",email:"private@example.invalid",row_version:1}}]});
  expect(h.queries[0]).not.toContain("[auth_user_id]");expect(h.values).not.toContain("not-for-device");expect(h.values).not.toContain("private@example.invalid");
 });
 it("keeps tombstone deletion separate from ordinary update suppression",async()=>{
  const h=fixture();await h.client.applyLocalBatch(h.transaction,registry.tables.find((t:{cloudTable:string})=>t.cloudTable==="products"),{tombstones:[{entity_id:'{"id":"00000000-0000-4000-8000-000000000001"}',tombstone:true}]});
  const deletes=h.queries.filter(query=>query.includes("DELETE FROM"));expect(deletes).toHaveLength(1);expect(deletes[0]).not.toContain("EXCEPT SELECT");
 });
 it("falls back conservatively for an unknown registered storage type",async()=>{
  const h=fixture();const table={cloudTable:"fixture",sqlServerTable:"fixture",conflictRule:"highest_version",columns:[{cloudColumn:"id",sqlServerColumn:"id",sqlServerType:"uniqueidentifier",primaryKey:true},{cloudColumn:"value",sqlServerColumn:"value",sqlServerType:"unknown"}]};
  await h.client.applyLocalBatch({},table,{rows:[{row_data:{id:"00000000-0000-4000-8000-000000000001",value:"unchanged"}}]});expect(h.queries[0]).toContain("WHEN MATCHED THEN UPDATE");expect(h.queries[0]).not.toContain("EXCEPT SELECT");
 });
 it.skipIf(process.env.POS_RUN_ISOLATED_SQLSERVER!=="1")("validates actual SQL types, triggers, CT and concurrent writers in an owned disposable database",()=>{
  const script=fileURLToPath(new URL("../../../scripts/test-sync-noop-sqlserver.cjs",import.meta.url));
  const output=execFileSync(process.execPath,[script,"--run"],{encoding:"utf8",windowsHide:true,timeout:120000});
  expect(output).toContain("11 isolated no-op SQL Server groups passed");expect(output).toContain("Cleaned owned fixture");
 },120000);
});
