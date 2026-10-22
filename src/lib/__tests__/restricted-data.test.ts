import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { PERMISSION_KEYS } from "../permissions";
const require = createRequire(import.meta.url);
const authority = require("../../../electron/admin-session.cjs");
const ipc = require("../../../electron/ipc-privilege.cjs");
const { filterSnapshot } = require("../../../electron/read-snapshot-policy.cjs");
const rules = require("../../../electron/read-permissions.json") as Record<string,string[]>;
afterEach(() => authority.clear());
describe("restricted Windows data", () => {
  it("does not return sales or inventory to an unsigned renderer", () => {
    authority.clear();
    expect(ipc.allowed("business:query", ["sales", {}])).toBe(false);
    expect(filterSnapshot({ok:true,sales:[{id:"bill"}],products:[{id:"item"}],settings:{company_name:"Shop"}}, authority))
      .toEqual({ok:true,sales:[],products:[],settings:{company_name:"Shop"}});
  });
  it("allows linked selling data but denies unrelated purchasing data", () => {
    authority.grant("staff","cashier",{can_process_sale:true},"pos","branch-a");
    expect(ipc.allowed("business:query",["products",{}])).toBe(true);
    expect(ipc.allowed("business:query",["sales",{}])).toBe(true);
    expect(ipc.allowed("business:query",["purchase_orders",{}])).toBe(false);
  });
  it("denies a supervisor with no read permissions", () => {
    authority.grant("supervisor","reviewer",{can_view_sales_reports:false},"pos","branch-a");
    expect(ipc.allowed("business:query",["sales",{}])).toBe(false);
    expect(filterSnapshot({sales:[{id:"private"}]},authority)).toEqual({sales:[]});
  });
  it("preserves administrator recovery access", () => {
    authority.grant("admin","owner",{},"pos",null);
    expect(ipc.allowed("business:query",["sales",{}])).toBe(true);
  });
  it("uses real permission keys and matching database policy definitions", () => {
    const sql = readFileSync("supabase/migrations/20261022051000_restrict_business_data_reads.sql","utf8");
    const encoded = sql.match(/jsonb_each\('([^']+)'::jsonb/);
    expect(JSON.parse(encoded![1])).toEqual(rules);
    for(const flags of Object.values(rules)) for(const flag of flags) expect(PERMISSION_KEYS).toContain(flag);
  });
});
