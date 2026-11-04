import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
const root=fileURLToPath(new URL("../../../",import.meta.url));
const text=readFileSync(new URL("../../../scripts/maintenance/mirror-three-str1-shift-summaries.sql",import.meta.url),"utf8");
const variable=(name:string)=>JSON.parse(text.match(new RegExp("DECLARE @"+name+" nvarchar\\(max\\)=N'((?:[^']|'')*)';"))![1].replaceAll("''","'"));
describe("LOCAL54 immutable repair contract",()=>{
 it("contains only the reviewed three identities and fingerprints, without private financial literals",()=>{
  const targets=variable("TargetJson");expect(targets.map((r:{id:string})=>r.id).sort()).toEqual(["2e735bd8-0db2-44fb-a6f7-e28edc64f7e0","85902cc1-9804-4d6f-af4f-f73a1e7799b8","d252a275-ebf7-4a09-8cd7-a45706c594a3"]);
  for(const target of targets){expect(target.old_version).toBe("5");expect(target.new_version).toBe("6");expect(target.expected_after_signature).toMatch(/^[A-F0-9]{64}$/);for(const name of ["expected_cash","expected_card","expected_digital","variance_cash","variance_total"])expect(target).not.toHaveProperty(name);}
  const rows=variable("Expected");expect(rows).toHaveLength(22);expect(new Set(rows.map((r:{table_name:string;id:string})=>r.table_name+":"+r.id)).size).toBe(22);for(const r of rows)expect(r.signature).toMatch(/^[A-F0-9]{64}$/);
 });
 it("retains the exact captured trigger bytes independently of checkout line endings",()=>{const captured=JSON.parse(readFileSync(new URL("./fixtures/local54-shifts-unfinished-tickets.live.json",import.meta.url),"utf8"));expect(createHash("sha256").update(Buffer.from(captured.definition,"utf16le")).digest("hex").toUpperCase()).toBe("3BB304E7D93DD5F747133EF3FE5CF558C61D4CFBF4A5603B3001295F365C4949");});
 it("restricts persisted mutation to seven mirrored parent fields and one local receipt",()=>{
  const update=text.match(/WITH CHANGE_TRACKING_CONTEXT\(0x434C4F5544\) UPDATE s SET ([\s\S]*?) FROM dbo\.shifts s JOIN @Targets/)!;
  expect(update[1].split(",").map(s=>s.split("=")[0].trim()).sort()).toEqual(["expected_card","expected_cash","expected_digital","row_version","updated_at","variance_cash","variance_total"]);
  expect(update[1]).toContain("expected_cash=mirror.expected_cash");expect(text.match(/INSERT dbo\./g)).toHaveLength(1);expect(text).not.toMatch(/\b(?:DELETE|TRUNCATE|ALTER|GRANT|REVOKE)\s+(?:TABLE|dbo\.|ON)/i);
  expect(text).toContain("LAPTOP-N0QBONGL\\LCRPOS");expect(text).toContain("CEAFA630-D613-423C-8997-8A31DF70C506");expect(text).toContain("no concurrent migrations/DDL");
 });
});
it.skipIf(process.platform!=="win32"||process.env.RUN_LOCAL54_SQLSERVER!=="1")("runs actual isolated SQL Server mirror/rollback/locking acceptance",()=>{
 const output=execFileSync(process.execPath,["scripts/test-local54-three-shift-mirror.cjs","--run"],{cwd:root,encoding:"utf8",timeout:120000,maxBuffer:1024*1024});expect(output).toMatch(/PASS \d+ actual isolated LOCAL54 SQLServer groups/);expect(output).toContain("Cleaned owned fixture CodexLocal54_");
},130000);
