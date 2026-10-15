import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const { reserveStockCounter } = require("../../../electron/bill-counter.cjs");
const prefix="SC-B1-WIN-DEVICE-202610";
function harness() {
  const request={input:vi.fn(() => request),query:vi.fn(async (_text:string) => ({recordset:[{sequence:42}]}))};
  return {sql:{BigInt:"bigint"},pool:{request:()=>request},request};
}
describe("SQL-only stock numbering",()=>{
  it("uses one atomic parameterized SQL request and returns only its acknowledged reservation",async()=>{
    const h=harness();
    expect(await reserveStockCounter(h.sql,h.pool,"B1",prefix,1)).toEqual({ok:true,sequence:42});
    expect(h.request.query).toHaveBeenCalledOnce();
    expect(h.request.input).toHaveBeenCalledWith("branch","B1");
    const text=h.request.query.mock.calls[0][0];
    expect(text).toContain("BEGIN TRANSACTION");expect(text).toContain("COMMIT TRANSACTION");expect(text).toContain("UPDLOCK,HOLDLOCK");
    for(const table of ["stock_count_drafts","purchase_orders","stock_transfers"]) expect(text).toContain("dbo."+table);
    expect(text).not.toContain(prefix);
  });
  it("passes configured minimums and refuses another branch without consuming a number",async()=>{
    const h=harness();h.request.query.mockResolvedValueOnce({recordset:[{sequence:500}]});
    expect(await reserveStockCounter(h.sql,h.pool,"B1",prefix,500)).toMatchObject({sequence:500});
    expect(h.request.input).toHaveBeenCalledWith("minimum","bigint",500);
    h.request.query.mockRejectedValueOnce(Object.assign(new Error("Other branch"),{number:51021}));
    expect(await reserveStockCounter(h.sql,h.pool,"B2",prefix,1)).toMatchObject({ok:false,error:expect.stringContaining("another branch")});
  });
  it("refuses SQL/acknowledgement failures and invalid arguments, retrying only deadlock rollbacks",async()=>{
    const h=harness();h.request.query.mockRejectedValueOnce(new Error("Disconnected"));
    expect(await reserveStockCounter(h.sql,h.pool,"B1",prefix,1)).toMatchObject({ok:false});
    h.request.query.mockResolvedValueOnce({recordset:[{sequence:0}]});
    expect(await reserveStockCounter(h.sql,h.pool,"B1",prefix,1)).toMatchObject({ok:false});
    h.request.query.mockRejectedValueOnce(Object.assign(new Error("Deadlock"),{number:1205}));
    expect(await reserveStockCounter(h.sql,h.pool,"B1",prefix,1)).toMatchObject({ok:true});
    const count=h.request.query.mock.calls.length;
    for(const [branch,value,min] of [["B1","bad' SQL",1],["",prefix,1],["B1",prefix,Number.MAX_SAFE_INTEGER]])
      expect(await reserveStockCounter(h.sql,h.pool,branch,value,min)).toMatchObject({ok:false});
    expect(h.request.query.mock.calls.length).toBe(count);
  });
});
