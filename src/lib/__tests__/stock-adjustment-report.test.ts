import { afterEach,beforeEach,expect,it,vi } from "vitest";
const h=vi.hoisted(()=>({query:vi.fn()}));
vi.mock("@/core/api/db-query",()=>({routedQuery:h.query}));
import { loadStockAdjustmentReport } from "../stock-adjustment-report";
import { setPosTimeZone } from "../time-zone";
beforeEach(()=>{h.query.mockReset();setPosTimeZone("Asia/Kuala_Lumpur");});
afterEach(()=>{vi.unstubAllEnvs();setPosTimeZone(undefined);});
it("uses the store day and SQL date filter regardless of the viewing device timezone",async()=>{
  vi.stubEnv("TZ","America/New_York");
  h.query.mockResolvedValue([
    {id:"before",store_id:"A",created_at:"2026-10-19T15:59:59Z",delta:1},
    {id:"first",store_id:"A",created_at:"2026-10-19T16:00:00Z",delta:2},
    {id:"last",store_id:"A",created_at:"2026-10-20T15:59:59Z",delta:3},
    {id:"after",store_id:"A",created_at:"2026-10-20T16:00:00Z",delta:4},
    {id:"foreign",store_id:"B",created_at:"2026-10-20T12:00:00Z",delta:5},
  ]);
  const rows=await loadStockAdjustmentReport(["A"],"2026-10-20","2026-10-20");
  expect(rows.map(row=>row.id)).toEqual(["last","first"]);
  expect(h.query).toHaveBeenCalledWith("stock_adjustments",expect.objectContaining({match:{store_id:"A"},dateRange:{column:"created_at",from:"2026-10-19T00:00:00.000Z",to:"2026-10-21T23:59:59.999Z"}}));
});
it("reads all selected-period pages without double counting a repeated row",async()=>{
  h.query.mockResolvedValueOnce(Array.from({length:500},(_,n)=>({id:String(n),store_id:"A",created_at:"2026-10-20T12:00:00Z"})))
    .mockResolvedValueOnce([{id:"499",store_id:"A",created_at:"2026-10-20T12:00:00Z"},{id:"last",store_id:"A",created_at:"2026-10-20T11:00:00Z"}]);
  expect(await loadStockAdjustmentReport(["A","A"],"2026-10-20","2026-10-20")).toHaveLength(501);
  expect(h.query).toHaveBeenCalledTimes(2);
});
it("rejects reversed date ranges before any database query",async()=>{
  await expect(loadStockAdjustmentReport(["A"],"2026-10-21","2026-10-20")).rejects.toThrow("valid stock history");
  expect(h.query).not.toHaveBeenCalled();
});
it("honors the newly selected store zone before the shared formatter effect runs",async()=>{
  setPosTimeZone("UTC");
  h.query.mockResolvedValue([{id:"boundary",store_id:"A",created_at:"2026-10-19T16:00:00Z"}]);
  expect(await loadStockAdjustmentReport(["A"],"2026-10-20","2026-10-20","Asia/Kuala_Lumpur")).toHaveLength(1);
});
