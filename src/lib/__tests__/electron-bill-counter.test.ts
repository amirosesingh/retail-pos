import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { reserveBillCounter } = require("../../../electron/bill-counter.cjs");
const session = require("../../../electron/admin-session.cjs");
const privilege = require("../../../electron/ipc-privilege.cjs");
const bridge = vi.hoisted(() => ({ reserveBillCounter: vi.fn() }));
vi.mock("@/core/local-db/local-db", () => ({localDb:()=>bridge,readLocalSetting:async()=>null,writeLocalSetting:vi.fn(()=>false)}));
vi.mock("@/lib/document-origin",()=>({documentDevice:()=>"device",documentPlatform:()=>"WIN"}));
vi.mock("@/core/activation/terminal-tokens",()=>({readTerminalConfig:()=>null}));
import { reserveBillNumber } from "@/lib/bill-number";
afterEach(()=>session.clear());
describe("protected Electron bill counter",()=>{
 it.each(["admin","supervisor","staff"])("allows normal %s sale authority without maintenance access",level=>{
  session.grant(level,level,{can_process_sale:true},"pos","branch");
  expect(privilege.allowed("business:reserve-bill")).toBe(true);
  session.grant(level,level,{can_process_sale:false},"pos","branch");
  expect(privilege.allowed("business:reserve-bill")).toBe(false);
 });
 it("rejects unsigned and hidden-register sessions",()=>{
  session.clear(); expect(privilege.allowed("business:reserve-bill")).toBe(false);
  session.grant("staff","cashier",{can_process_sale:true,"page:register":false},"pos","branch");
  expect(privilege.allowed("business:reserve-bill")).toBe(false);
 });
 it("migrates the saved counter and never rewinds after restart or switching prefixes",()=>{
  const data = new Map<string,unknown>([["setting:pos.bill.seq",JSON.stringify({prefix:"B-WIN01-20261010",next:42})]]);
  const store={get:(key:string)=>data.get(key),set:(key:string,value:unknown)=>{data.set(key,value);return {ok:true};}};
  expect(reserveBillCounter(store,"B-WIN01-20261010",1).sequence).toBe(42);
  reserveBillCounter(store,"OTHER",1);
  expect(reserveBillCounter(store,"B-WIN01-20261010",1).sequence).toBe(43);
  expect(reserveBillCounter(store,"B-WIN01-20261010",80).sequence).toBe(80);
 });
 it("keeps a held bill reserved while a new cashier completes later numbers",()=>{
  const data = new Map<string,unknown>();
  const store={get:(key:string)=>data.get(key),set:(key:string,value:unknown)=>{data.set(key,value);return {ok:true};}};
  const held = reserveBillCounter(store,"B-WIN01-20261010",1).sequence;
  const nextCustomer = reserveBillCounter(store,"B-WIN01-20261010",1).sequence;
  // A restarted renderer provides no sales or cached counter. Native state wins.
  const afterLogin = reserveBillCounter(store,"B-WIN01-20261010",1).sequence;
  expect([held,nextCustomer,afterLogin]).toEqual([1,2,3]);
  expect(held).toBe(1); // resuming restores this number; it never reserves again
 });
 it("does not issue a number on persistence failure or invalid input",()=>{
  const store={get:()=>null,set:()=>({ok:false})};
  expect(reserveBillCounter(store,"B-WIN01-20261010",1).ok).toBe(false);
  expect(reserveBillCounter(store,"B",-1).ok).toBe(false);
 });
 it("renderer uses the protected reservation instead of the restricted settings writer",async()=>{
  bridge.reserveBillCounter.mockResolvedValue({ok:true,sequence:100});
  expect(await reserveBillNumber("B",[],{terminalNo:"01"})).toMatch(/-0100$/);
  bridge.reserveBillCounter.mockResolvedValue({ok:false,error:"Storage failed"});
  await expect(reserveBillNumber("B",[],{terminalNo:"01"})).rejects.toMatchObject({code:"EBILL_COUNTER"});
 });
});
