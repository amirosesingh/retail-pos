import { expect, it } from "vitest";
import type { Sale, Shift } from "@/core/types/pos-types";
import { expectedDrawer, saleTenderAmounts, tenderSales, tenderTotals } from "../shift-close";
const shift={id:"shift",openingFloat:100} as Shift;
const sale=(patch:Partial<Sale>) => ({id:crypto.randomUUID(),shiftId:"shift",method:"cash",total:0,...patch} as Sale);
it("adds only this shift's cash to float: 100 + 401 = 501",()=>{
 const sales=[sale({total:400}),sale({method:"card",total:200,payments:[{id:"cash",method:"cash",amount:1},{id:"card",method:"card",amount:199}]}),sale({method:"card",total:900}),sale({shiftId:"other",total:600}),sale({refunded:true,total:80})];
 expect(expectedDrawer(shift,sales)).toBe(501);
 expect(tenderSales(shift,sales,"card")).toBe(1099);
 expect(tenderTotals(shift,sales).find(t=>t.method==="cash")?.value).toBe(401);
});
it("deducts split change once without subtracting single-payment change twice",()=>{
 expect(saleTenderAmounts(sale({total:70,paid:100,change:30,payments:[{id:"cash",method:"cash",amount:70}]})).cash).toBe(70);
 expect(saleTenderAmounts(sale({total:90,paid:120,change:30,payments:[{id:"cash",method:"cash",amount:100},{id:"card",method:"card",amount:20}]}))).toEqual({cash:70,card:20});
});
it("handles legacy empty tenders and bank transfers without affecting cash",()=>{
 expect(saleTenderAmounts(sale({total:12,payments:[]}))).toEqual({cash:12});
 const sales=[sale({method:"bank_transfer",total:30})];
 expect(expectedDrawer(shift,sales)).toBe(100);
 expect(tenderSales(shift,sales,"digital")).toBe(30);
});
