import {describe,it,expect} from "vitest";
import {execFileSync} from "node:child_process";

describe("FIN62 isolated financial-basis prototype",()=>{
  it("preserves authoritative formula, scope and point-in-time numeric inputs",()=>{
    const output=execFileSync(process.execPath,["scripts/test-shift-financial-basis.mjs"],{
      encoding:"utf8",windowsHide:true,timeout:30000,
    });
    expect(output).toContain("17 groups passed");
    expect(output).toContain("No admission/security/deployment claim");
  },35000);
});