import { describe, expect, it } from "vitest";
import { savingsOf, soldLines } from "../sales-analytics";
import type { Sale } from "@/core/types/pos-types";
const bill=(gift=false,extra=0)=>({id:"sale",receiptNo:"B1",createdAt:"2026-10-17T00:00:00Z",storeId:"a",cashier:"C",subtotal:100,discount:gift?100:28+extra,total:gift?0:72-extra,tax:0,couponDiscount:gift?0:10,
  lines:[{productId:"p",name:"Item",qty:1,price:100,cost:40,taxRate:0,discount:gift?100:20,discountType:gift?"amount":"percent",couponDiscount:gift?0:10,foc:gift}]} as Sale);
describe("analytics giveaway breakdown",()=>{
  it("separates an item coupon from the manual discount without counting either twice",()=>{
    const sale=bill();expect(savingsOf([sale],soldLines([sale],[]))).toMatchObject({lineDiscount:18,coupon:10,billDiscount:0,total:28});
  });
  it("keeps the extra bill amount separate",()=>{
    const sale=bill(false,3);expect(savingsOf([sale],soldLines([sale],[]))).toMatchObject({lineDiscount:18,coupon:10,billDiscount:3,total:31});
  });
  it("counts a free item once rather than as both a bill discount and a gift",()=>{
    const sale=bill(true);expect(savingsOf([sale],soldLines([sale],[]))).toMatchObject({lineDiscount:0,coupon:0,billDiscount:0,focValue:100,total:100});
  });
});
