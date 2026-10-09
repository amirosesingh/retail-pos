import { expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { legacyExchangeLine, legacyExchangeReference } from "../legacy-exchange";
import type { Product } from "@/core/types/pos-types";
import { exchangePolicyError } from "../returns-policy";
const require = createRequire(import.meta.url);
const {aggregatePolicy}=require("../../../electron/db/write-policy.cjs");
const {OperationsRepository}=require("../../../electron/db/repositories/operations.cjs");
it("requires an old receipt and valid original paid value", () => {
  expect(legacyExchangeReference(" receipt-7 ")).toBe("OLDPOS:RECEIPT-7");
  expect(()=>legacyExchangeReference(" ")).toThrow();
  expect(()=>legacyExchangeLine({id:"p",name:"Item"} as Product,1.5,70)).toThrow();
  expect(()=>legacyExchangeLine({id:"p",name:"Item"} as Product,1,0)).toThrow();
  expect(legacyExchangeLine({id:"p",name:"Item"} as Product,1,70)).toMatchObject({qty:-1,price:70,credit:true});
});
it("permits equal and higher replacements, never refunds", () => {
  const line=legacyExchangeLine({id:"p",name:"Item"} as Product,1,70);
  const lines=[line,{...line,qty:1,credit:false,price:82}];
  expect(exchangePolicyError(lines,12,"OLDPOS:7")).toBeNull();
  expect(exchangePolicyError(lines,0,"OLDPOS:7")).toBeNull();
  expect(exchangePolicyError(lines,-1,"OLDPOS:7")).toContain("equal or higher");
});
it("native permissions reject cashier legacy entries even with exchange and sale grants", () => {
  const operations=[{kind:"upsert",table:"sales",rows:[{original_bill_number:"OLDPOS:7"}]}];
  const identity={source:"pos",level:"staff",permissions:{can_process_sale:true,can_process_exchange:true}};
  expect(()=>aggregatePolicy("sale",operations,identity)).toThrow("administrator");
  expect(aggregatePolicy("sale",operations,{...identity,level:"admin"}).enforcePermissions).toBe(true);
});
it("checks duplicate old receipts within the local SQL transaction", async () => {
  const query=vi.fn(async(_sql: string)=>({recordset:[{id:"prior"}]}));
  class Request { input(){return this;} query=query; }
  const context={connectionManager:{sql:()=>({Request})}};
  const op={table:"sales",rows:[{id:"next",original_bill_number:"OLDPOS:7",is_exchange:true,total_amount:12,exchange_credit:70}]};
  await expect(OperationsRepository.prototype.assertLegacyExchange.call(context,{},op,{branchId:"branch",enforcePermissions:true,isSettingsAdmin:true})).rejects.toThrow("already been exchanged");
  expect(query.mock.calls[0][0]).toContain("UPDLOCK,HOLDLOCK");
});
