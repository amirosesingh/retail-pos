import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { draftTicketId, flushTicketDrafts, preserveSessionDrafts, registerSessionDraft } from "@/lib/session-draft";
const require=createRequire(import.meta.url);
const { aggregatePolicy }=require("../../../electron/db/write-policy.cjs");
const unregister: Array<()=>void>=[];
afterEach(()=>{unregister.splice(0).forEach(off=>off());});
describe("database ticket lifecycle",()=>{
 it("coalesces logout requests and waits for the hold before ending the session",async()=>{
  let resolve!:()=>void;
  const wait=new Promise<void>(done=>{resolve=done;});
  const handler=vi.fn(()=>wait);unregister.push(registerSessionDraft(handler));
  const first=preserveSessionDrafts();const second=preserveSessionDrafts();
  expect(first).toBe(second);expect(handler).toHaveBeenCalledWith("hold");
  let finished=false;void first.then(()=>{finished=true;});
  await Promise.resolve();expect(finished).toBe(false);
  resolve();await first;expect(finished).toBe(true);expect(handler).toHaveBeenCalledTimes(1);
 });
 it("refuses session teardown when saving the hold fails and allows a later retry",async()=>{
  const handler=vi.fn().mockRejectedValueOnce(new Error("SQL disconnected")).mockResolvedValueOnce(undefined);
  unregister.push(registerSessionDraft(handler));
  await expect(preserveSessionDrafts()).rejects.toThrow("SQL disconnected");
  await expect(preserveSessionDrafts()).resolves.toBeUndefined();
 });
 it("keeps one stable draft identity through cashier changes and flushing",async()=>{
  expect(draftTicketId("BRANCH-A","B-WIN01-20261010-001")).toBe(draftTicketId("branch-a","B-WIN01-20261010-001"));
  const handler=vi.fn().mockResolvedValue(undefined);unregister.push(registerSessionDraft(handler));
  await flushTicketDrafts();await flushTicketDrafts("cancel");
  expect(handler.mock.calls.map(call=>call[0])).toEqual(["save","cancel"]);
 });
 it("returns the reserved bill from the saved draft for checkout", async()=>{
  unregister.push(registerSessionDraft(async()=>"B-WIN01-001"));
  expect(await flushTicketDrafts()).toBe("B-WIN01-001");
 });
 it("only permits booking completion with a matching booking in the same batch",()=>{
  const identity={source:"pos",permissions:{can_create_booking:true}};
  const finish={kind:"update",table:"held_orders",match:{store_id:"branch",bill_no:"bill"},values:{status:"completed",note:"booking:booking-id"}};
  expect(()=>aggregatePolicy("booking",[finish],identity)).toThrow();
  expect(()=>aggregatePolicy("booking",[{kind:"upsert",table:"bookings",rows:[{id:"booking-id",store_id:"branch"}]},finish],identity)).not.toThrow();
  expect(()=>aggregatePolicy("booking",[{kind:"upsert",table:"bookings",rows:[{id:"booking-id",store_id:"other"}]},finish],identity)).toThrow();
 });
 it("allows sale-authorized automatic drafts but preserves cancel and manual-hold grants",()=>{
  const identity={source:"pos",level:"staff",permissions:{can_process_sale:true}};
  const op=(status:string,note="")=>[{kind:"upsert",table:"held_orders",rows:[{id:"D:one",status,note}]}];
  expect(()=>aggregatePolicy("held_order",op("draft"),identity)).not.toThrow();
  expect(()=>aggregatePolicy("held_order",op("held","session-draft:device"),identity)).not.toThrow();
  expect(()=>aggregatePolicy("held_order",op("held"),identity)).toThrow("Permission");
  expect(()=>aggregatePolicy("held_order",op("cancelled"),identity)).toThrow("Permission");
  expect(()=>aggregatePolicy("held_order",op("cancelled"),{...identity,permissions:{...identity.permissions,can_void_cart:true}})).not.toThrow();
  expect(()=>aggregatePolicy("held_order",op("completed"),identity)).toThrow();
 });
});
