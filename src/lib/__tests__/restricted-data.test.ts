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
  it("lets any signed-in account with transfer permission read transfers and their lines", () => {
    authority.grant("staff", "stock-clerk", { can_create_transfer: true, "page:stock": true }, "pos", "branch-a");
    for (const table of ["stock_transfers", "stock_transfer_items"])
      expect(ipc.allowed("business:query", [table, {}])).toBe(true);
    expect(ipc.allowed("business:query", ["sales", {}])).toBe(false);
  });
  it("does not ask for a supervisor PIN when a signed-in transfer permission is missing", () => {
    authority.grant("staff", "cashier", { can_process_sale: true }, "pos", "branch-a");
    expect(ipc.allowed("business:query", ["stock_transfers", {}])).toBe(false);
    expect(ipc.refusal(ipc.levelFor("business:query"), "business:query", ["stock_transfers"])).toMatchObject({
      code: "EPRIVILEGE",
      error: expect.stringContaining("permission to view stock_transfers"),
    });
  });
  it("distinguishes a missing verified session from a missing transfer permission", () => {
    authority.grant("admin", "owner", {}, "manual", null);
    expect(ipc.allowed("business:query", ["stock_transfers", {}])).toBe(false);
    expect(ipc.refusal(ipc.levelFor("business:query"), "business:query", ["stock_transfers"]).error)
      .toContain("verified POS session is not active");
    authority.grant("admin", "owner", {}, "pos", null);
    expect(ipc.allowed("business:query", ["stock_transfers", {}])).toBe(true);
  });
  it("uses operational permissions without requiring a supervisor role", () => {
    authority.grant("staff", "database-operator", {
      can_manage_sync_backup: true,
      can_manage_terminals: true,
      can_access_pos_settings: true,
    }, "pos", "branch-a");
    expect(ipc.allowed("pos:housekeep")).toBe(true);
    expect(ipc.allowed("db:set-branch")).toBe(true);
    expect(ipc.allowed("branding:write")).toBe(true);
    expect(ipc.allowed("settings:set", ["receipt_typography"])).toBe(true);
    authority.grant("supervisor", "unpermitted", {}, "pos", "branch-a");
    expect(ipc.allowed("pos:housekeep")).toBe(false);
    expect(ipc.allowed("branding:write")).toBe(false);
  });
  it("uses real permission keys and matching database policy definitions", () => {
    const sql = readFileSync("supabase/migrations/20261022051000_restrict_business_data_reads.sql","utf8");
    const encoded = sql.match(/jsonb_each\('([^']+)'::jsonb/);
    expect(JSON.parse(encoded![1])).toEqual(rules);
    for(const flags of Object.values(rules)) for(const flag of flags) expect(PERMISSION_KEYS).toContain(flag);
  });
});
