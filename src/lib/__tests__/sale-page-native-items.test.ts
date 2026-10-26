import { beforeEach,expect,it,vi } from "vitest";
const h=vi.hoisted(()=>({query:vi.fn(),filters:[] as unknown[][]}));
vi.mock("@/core/local-db/local-db",()=>({localDb:()=>({query:h.query})}));
vi.mock("@/core/api/db-query",()=>({routedQuery:h.query}));
vi.mock("@/integrations/supabase/external-client",()=>({supabaseExternal:{from:()=>{
 const q={select:()=>q,eq:(key:string,value:unknown)=>{h.filters.push([key,value]);return q;},gte:()=>{throw new Error("Unexpected date cutoff");},lte:()=>{throw new Error("Unexpected date cutoff");},order:()=>q,or:()=>q,limit:async()=>({data:[],error:null})};return q;
}}}));
import { loadSalesPage } from "@/core/api/pos-db";
beforeEach(()=>{h.query.mockReset();h.filters=[];});
it("loads every native line beyond2000 within one50-bill batch and applies branch plus shift predicates",async()=>{
 const lines=Array.from({length:2105},(_,i)=>({id:`i${i}`,sale_id:"s",product_name:"Item",unit_price:1,quantity:1,unit_cost:0.5}));
 h.query.mockImplementation(async(table:string,options:{offset?:number})=>table==="sales" ? [{id:"s",store_id:"branch",shift_id:"shift",created_at:"2026-10-27T00:00:00Z"}]
  : lines.slice(options.offset??0,(options.offset??0)+2000));
 const page=await loadSalesPage("branch",null,500,{shiftId:"shift"});
 expect(page.rows[0].lines).toHaveLength(2105);
 expect(h.query).toHaveBeenCalledWith("sales",expect.objectContaining({match:{store_id:"branch",shift_id:"shift"}}));
 expect(h.query.mock.calls.filter(([table])=>table==="sale_items").map(([,options])=>options.offset)).toEqual([0,2000]);
 expect(page.source).toBe("local");
});
it("constrains cloud shift pages without restricting them to an opened/closed date",async()=>{
 await loadSalesPage("branch",null,500,{shiftId:"shift",source:"cloud"});
 expect(h.filters).toEqual([["store_id","branch"],["shift_id","shift"]]);
 expect(h.query).not.toHaveBeenCalled();
});
it("normalizes SQL Date objects so a full native page gets a usable continuation cursor",async()=>{
 h.query.mockImplementation(async(table:string)=>table==="sales" ? [{id:"s",store_id:"branch",shift_id:"shift",created_at:new Date("2026-10-27T00:00:00Z")}] : []);
 expect((await loadSalesPage("branch",null,1,{shiftId:"shift"})).cursor).toEqual({ts:"2026-10-27T00:00:00.000Z",id:"s"});
});
