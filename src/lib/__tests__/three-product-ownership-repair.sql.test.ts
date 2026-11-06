import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

describe("three-product ownership-only recovery artifact", () => {
  it("freezes only the three proven identities and leaves quantities, grants and schema alone", () => {
    const sql=readFileSync("scripts/maintenance/repair-str1-three-product-ownership.sql","utf8");
    const manifest=JSON.parse(sql.match(/\$manifest\$([\s\S]*?)\$manifest\$/)![1]) as {id:string;before_md5:string}[];
    expect(manifest.map(row=>row.id)).toEqual([
      "27b5b2a7-71c3-4334-9b15-6087aeab8cf0",
      "29da1541-a922-40f9-aaf5-b336b24107a8",
      "9ffab37c-7d1e-425b-b4b1-bf887be41714",
    ]);
    expect(manifest.every(row=>/^[a-f0-9]{32}$/.test(row.before_md5))).toBe(true);
    expect(sql).toContain("UPDATE public.products p SET owner_store_id=branch");
    expect(sql).toContain("OWNERSHIP3_SOURCE_PROOF_CHANGED");
    expect(sql).toContain("FOR SHARE NOWAIT");
    expect(sql).not.toMatch(/DISABLE TRIGGER|CREATE OR REPLACE FUNCTION|ALTER TABLE|SET stock_quantity|SET sku|SET selling_price|\bGRANT\b/i);
  });
  it("proves stock preservation, same-cluster visibility, replay, rollback and source guards with actual PostgreSQL triggers", () => {
    const output=execFileSync(process.execPath,["scripts/test-three-product-ownership-repair.mjs"],{
      encoding:"utf8",windowsHide:true,timeout:95000,maxBuffer:1024*1024,
    });
    expect(output).toContain("PASS 25 isolated ownership3");
  },100000);
});
