import { afterEach, describe, expect, it } from "vitest";
import { boardTradingPeriods, shopSlices, type BoardData, type StoreDayRow } from "../analytics-board";
import { inPosDayRange, reportScanStart, reportScanEnd, setPosTimeZone } from "../time-zone";
import { archiveBlockers } from "../locations";
import type { Product, Store } from "@/core/types/pos-types";
afterEach(() => setPosTimeZone(""));
const day = (sale_day: string, store_id = "a"): StoreDayRow => ({sale_day,sale_month:sale_day.slice(0,7),store_id,bills:1,revenue:80,cost:40,profit:40,discount:20,foc_value:0,units:1});
describe("Business Overview report contracts", () => {
  it("counts distinct selected trading days independently of chart grouping", () => {
    const rows = [day("2026-09-01"),day("2026-09-02"),day("2026-10-01","b")];
    expect(boardTradingPeriods(rows)).toEqual({days:3,months:2});
    expect(boardTradingPeriods(rows,new Set(["a"]))).toEqual({days:2,months:1});
    expect(boardTradingPeriods([],new Set(["a"]))).toEqual({days:1,months:1});
  });
  it("counts free items, manual discounts, coupons and bill discounts once", () => {
    const data: BoardData = {storeDays:[{...day("2026-10-17"),discount:30,foc_value:10}],itemDays:[],
      bills:[{store_id:"a",store_name:"A",created_at:"2026-10-17T00:00:00Z",total:65,discount_amount:35,coupon_discount:2}],storeNames:{},liveStoreIds:["a"]};
    expect(shopSlices(data,id=>id)[0]).toMatchObject({itemDiscount:20,billDiscount:3,coupon:2,focValue:10,givenAway:35});
  });
  it("includes the last millisecond and assigns midnight using the business zone", () => {
    setPosTimeZone("Asia/Singapore");
    expect(inPosDayRange("2026-10-16T16:00:00Z","2026-10-17","2026-10-17")).toBe(true);
    expect(inPosDayRange("2026-10-17T15:59:59.999Z","2026-10-17","2026-10-17")).toBe(true);
    expect(inPosDayRange("2026-10-17T16:00:00Z","2026-10-17","2026-10-17")).toBe(false);
    expect(inPosDayRange("invalid","2026-10-17","2026-10-17")).toBe(false);
    expect(reportScanStart("2026-10-17")).toBeLessThan(Date.parse("2026-10-16T16:00:00Z"));
    expect(reportScanEnd("2026-10-17")).toBeGreaterThan(Date.parse("2026-10-17T16:00:00Z"));
  });
  it("prevents archiving a warehouse with a negative stock balance", () => {
    const product: Product = {id:"p",name:"Item",sku:"p",barcode:"p",category:"C",price:10,cost:5,reorderLevel:1,taxRate:0,stockByStore:{warehouse:-2}};
    expect(archiveBlockers([product],[{id:"warehouse",active:true} as Store],"warehouse")?.items).toEqual([{name:"Item",qty:-2}]);
  });
});
