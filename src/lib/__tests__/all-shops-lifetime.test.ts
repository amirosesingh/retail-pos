import { beforeEach,describe,expect,it,vi } from "vitest";
const h=vi.hoisted(()=>({from:vi.fn(),calls:[] as unknown[][],rows:[] as {store_id:string;revenue:number;profit:number;bills:number}[],error:null as null|{message:string}}));
const replica=vi.hoisted(()=>vi.fn());
vi.mock("@/integrations/supabase/external-client",()=>({supabaseExternal:{from:h.from}}));
vi.mock("../management-report-client",()=>({readManagementReport:replica}));
import { loadAllShopsLifetime } from "../all-shops-lifetime";
beforeEach(()=>{
 h.calls=[];h.rows=[];h.error=null;
 replica.mockReset().mockResolvedValue(null);
 h.from.mockReset().mockImplementation((table:string)=>{
  h.calls.push(["table",table]);
  const query={select:(columns:string,options:unknown)=>{h.calls.push(["select",columns,options]);return query;},
   in:(column:string,ids:string[])=>{h.calls.push(["scope",column,ids]);return query;},
   lte:(column:string,value:string)=>{h.calls.push(["end",column,value]);return query;},order:()=>query,
   range:async(start:number,end:number)=>{h.calls.push(["page",start,end]);return {data:h.rows.slice(start,end+1),count:h.rows.length,error:h.error};}};
  return query;
 });
});
describe("lifetime shop totals",()=>{
 it("uses a complete permission-checked management replica without any cloud or bill enumeration",async()=>{
  replica.mockResolvedValue({ok:true,complete:true,storeTotals:[{store_id:"a",revenue:100,profit:30,bills:4}]});
  expect((await loadAllShopsLifetime(["a"],"2026-10-27",true)).a).toEqual({revenue:100,profit:30,bills:4});
  expect(replica).toHaveBeenCalledWith(expect.objectContaining({kind:"totals",storeIds:["a"],to:"2026-10-27",includeProfit:true}));
  expect(h.from).not.toHaveBeenCalled();
 });
 it("does not hide a real local permission error by falling back to cloud",async()=>{
  replica.mockRejectedValue(new Error("Report permission required"));
  await expect(loadAllShopsLifetime(["a"],"2026-10-27")).rejects.toThrow("Report permission required");
  expect(h.from).not.toHaveBeenCalled();
 });
 it("pages beyond 1000 daily rows without fetching sales or items and scopes every page",async()=>{
  h.rows=Array.from({length:1205},()=>({store_id:"a",revenue:10.25,profit:2.5,bills:2}));
  const totals=await loadAllShopsLifetime(["a"],"2026-10-27",true);
  expect(totals.a).toEqual({revenue:12351.25,profit:3012.5,bills:2410});
  expect(h.calls.filter(call=>call[0]==="table")).toEqual([["table","v_daily_store_sales"],["table","v_daily_store_sales"]]);
  expect(h.calls.filter(call=>call[0]==="scope")).toEqual([["scope","store_id",["a"]],["scope","store_id",["a"]]]);
  expect(h.calls.filter(call=>call[0]==="end")).toHaveLength(2);
 });
 it("omits profit from the read when cost/margin visibility is unavailable",async()=>{
  h.rows=[{store_id:"a",revenue:10,profit:7,bills:1}];
  expect((await loadAllShopsLifetime(["a"],"2026-10-27")).a.profit).toBe(0);
  expect(h.calls.find(call=>call[0]==="select")?.[1]).not.toContain("profit");
 });
 it("never turns an empty authorized scope into an unscoped read",async()=>{
  expect(await loadAllShopsLifetime([],"2026-10-27")).toEqual({});
  expect(h.from).not.toHaveBeenCalled();
  expect(replica).not.toHaveBeenCalled();
 });
 it("ignores out-of-scope rows and distinguishes empty stores from transport failures",async()=>{
  h.rows=[{store_id:"other",revenue:999,profit:999,bills:99}];
  expect(await loadAllShopsLifetime(["a"],"2026-10-27")).toEqual({a:{revenue:0,profit:0,bills:0}});
  h.error={message:"Database unavailable"};
  await expect(loadAllShopsLifetime(["a"],"2026-10-27")).rejects.toThrow("Database unavailable");
 });
});
