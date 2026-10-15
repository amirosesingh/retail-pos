import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const { reserveStockCounter } = require("../../../electron/bill-counter.cjs");
const prefix = "SC-B1-WIN-11111111111141118111111111111111-202610";
function harness(last = 0) {
  const values = new Map<string, unknown>();
  const store = { get: (key: string) => values.get(key), set: vi.fn((key: string, value: unknown) => { values.set(key, value); return {ok:true}; }) };
  const query = vi.fn(async (_sql: string) => ({recordset:[{last_sequence:last}]}));
  const request = {input:vi.fn(() => request), query};
  const pool = {request:() => request};
  return {store,pool,query,request,values};
}
describe("durable Electron stock numbering", () => {
  it("recovers after a reset from existing drafts, receiving and transfer documents", async () => {
    const h = harness(41);
    expect(await reserveStockCounter(h.store,h.pool,prefix,1)).toMatchObject({ok:true,sequence:42});
    expect(await reserveStockCounter(h.store,h.pool,prefix,1)).toMatchObject({ok:true,sequence:43});
    expect(h.request.input).toHaveBeenCalledWith("prefix",prefix);
    const sql = h.query.mock.calls[0][0];
    for (const table of ["stock_count_drafts","purchase_orders","stock_transfers"]) expect(sql).toContain("dbo."+table);
    expect(sql).not.toContain(prefix);
  });
  it("serializes simultaneous windows and persists each reservation before returning", async () => {
    const h = harness();
    const results = await Promise.all(Array.from({length:20},() => reserveStockCounter(h.store,h.pool,prefix,1)));
    expect(new Set(results.map(row => row.sequence)).size).toBe(20);
    expect(await reserveStockCounter(h.store,h.pool,prefix,1)).toMatchObject({sequence:21});
    expect(await reserveStockCounter(h.store,h.pool,prefix.replace("SC-","GRN-"),1)).toMatchObject({sequence:1});
  });
  it("refuses storage failure, unreadable SQL, invalid input and exhausted counters", async () => {
    const h = harness(); h.store.set.mockReturnValue({ok:false});
    expect(await reserveStockCounter(h.store,h.pool,prefix,1)).toMatchObject({ok:false});
    h.query.mockRejectedValueOnce(new Error("Disconnected"));
    expect(await reserveStockCounter(h.store,h.pool,prefix,1)).toMatchObject({ok:false});
    const queries = h.query.mock.calls.length;
    expect(await reserveStockCounter(h.store,h.pool,"bad' SQL",1)).toMatchObject({ok:false});
    expect(h.query.mock.calls.length).toBe(queries);
    expect(await reserveStockCounter(h.store,h.pool,prefix,Number.MAX_SAFE_INTEGER)).toMatchObject({ok:false});
    h.values.set("setting:pos.stockref.counter:"+prefix,"corrupt");
    expect(await reserveStockCounter(h.store,h.pool,prefix,1)).toMatchObject({ok:false});
  });
});
