import { beforeEach,expect,it,vi } from "vitest";
import type { Sale } from "@/core/types/pos-types";
const h=vi.hoisted(()=>({page:vi.fn(),replica:vi.fn()}));
vi.mock("@/core/api/pos-db",()=>({loadSalesPage:h.page,rowToSale:(row:unknown)=>row}));
vi.mock("../management-report-client",()=>({readManagementReport:h.replica}));
import { readCompleteShiftSales } from "../shift-sales-read";
import { closedShiftEffects } from "../closed-shift-effects";
const sale=(id:string)=>({id,storeId:"branch",shiftId:"shift",createdAt:"2026-10-27T00:00:00Z"}) as Sale;
beforeEach(()=>{vi.resetAllMocks();h.replica.mockResolvedValue(null);});
it("reads every shift bill beyond the500bootseed without any date cutoff",async()=>{
 h.page.mockResolvedValueOnce({rows:Array.from({length:500},(_,i)=>sale(`s${i}`)),hasMore:true,cursor:{ts:"2026-10-27",id:"s499"},source:"cloud"})
  .mockResolvedValueOnce({rows:Array.from({length:253},(_,i)=>sale(`s${500+i}`)),hasMore:false,cursor:null,source:"cloud"});
 expect(await readCompleteShiftSales("branch","shift")).toHaveLength(753);
 expect(h.page).toHaveBeenNthCalledWith(1,"branch",null,500,{shiftId:"shift",source:"auto"});
 expect(h.page.mock.calls[1][3]).toEqual({shiftId:"shift",source:"cloud"});
});
it("refuses any branch/shift mismatch rather than printing a partial report",async()=>{
 for(const wrong of [{...sale("s"),storeId:"other"},{...sale("s"),shiftId:"other"}]){
  h.page.mockResolvedValueOnce({rows:[wrong],hasMore:false,source:"cloud"});
  await expect(readCompleteShiftSales("branch","shift")).rejects.toThrow("another branch or shift");
 }
});
it("rejects page failures, repeated cursors and changing sources without returning a partial result",async()=>{
 h.page.mockRejectedValueOnce(new Error("Permission denied"));
 await expect(readCompleteShiftSales("branch","shift")).rejects.toThrow("Permission denied");
 h.page.mockResolvedValue({rows:[sale("s")],hasMore:true,cursor:{ts:"2026-10-27",id:"s"},source:"cloud"});
 await expect(readCompleteShiftSales("branch","shift")).rejects.toThrow("did not advance");
 h.page.mockReset().mockResolvedValueOnce({rows:[sale("s")],hasMore:true,cursor:{ts:"2026-10-27",id:"s"},source:"local"})
  .mockResolvedValueOnce({rows:[],hasMore:false,source:"cloud"});
 await expect(readCompleteShiftSales("branch","shift")).rejects.toThrow("source changed");
});
it("uses exact-shift management paging and refuses loss of replica completeness mid-report",async()=>{
 h.replica.mockResolvedValueOnce({rows:[sale("s")],hasMore:false,complete:true});
 expect(await readCompleteShiftSales("branch","shift")).toHaveLength(1);
 expect(h.replica).toHaveBeenCalledWith(expect.objectContaining({kind:"sales",shiftId:"shift",storeIds:["branch"]}));
 expect(h.page).not.toHaveBeenCalled();
 h.replica.mockResolvedValueOnce({rows:[sale("s")],hasMore:true,cursor:{ts:"2026-10-27",id:"s"},complete:true}).mockResolvedValueOnce(null);
 await expect(readCompleteShiftSales("branch","shift")).rejects.toThrow("replica changed");
 expect(h.page).not.toHaveBeenCalled();
});
it("does not print partial data after close and still runs synchronization when report loading fails",async()=>{
 h.page.mockRejectedValueOnce(new Error("Report data unavailable"));
 const printer=vi.fn(async(sales:Sale[])=>({ok:sales.length>=0}));
 const synchronize=vi.fn(async()=>({ok:true as const}));
 const result=await closedShiftEffects({print:async()=>printer(await readCompleteShiftSales("branch","shift")),synchronize});
 expect(printer).not.toHaveBeenCalled();expect(synchronize).toHaveBeenCalledOnce();
 expect(result.printed).toEqual({ok:false,error:"Report data unavailable"});
 expect(result.synchronized.ok).toBe(true);
});
