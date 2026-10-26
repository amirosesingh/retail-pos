import { supabaseExternal } from "@/integrations/supabase/external-client";
import { readAllPages } from "./paged-read";
import { canonicalBranchId } from "./branch-id";
import { r2 } from "@/core/types/pos-types";
import { readManagementReport } from "./management-report-client";
import { effectiveTimeZone } from "./time-zone";

export type ShopLifetimeTotals = { revenue: number; profit: number; bills: number };
type DailyRow = {store_id:string|null;revenue:number|null;profit?:number|null;bills:number|null};

/** A complete management replica or cloud daily aggregates; never lifetime bills/items. */
export async function loadAllShopsLifetime(storeIds: readonly string[], through: string, includeProfit = false): Promise<Record<string,ShopLifetimeTotals>> {
  const ids=[...new Set(storeIds.filter(Boolean).map(canonicalBranchId))].sort();
  if (!ids.length) return {};
  const totals:Record<string,ShopLifetimeTotals>=Object.fromEntries(ids.map(id=>[id,{revenue:0,profit:0,bills:0}]));
  const replica=await readManagementReport({kind:"totals",storeIds:ids,from:"1900-01-01",to:through,zone:effectiveTimeZone(),includeProfit});
  let rows:DailyRow[];
  if(replica) rows=(replica.storeTotals ?? []) as unknown as DailyRow[];
  else {
    const cloud=await readAllPages<DailyRow>(async(start,end,count)=>{
      const options={count:count ? "exact" as const : undefined};
      const query=includeProfit
        ? supabaseExternal.from("v_daily_store_sales").select("store_id,sale_day,revenue,bills,profit",options)
        : supabaseExternal.from("v_daily_store_sales").select("store_id,sale_day,revenue,bills",options);
      return await query.in("store_id",ids).lte("sale_day",through).order("sale_day").order("store_id").range(start,end);
    });
    if(cloud.error || cloud.capped) throw new Error(cloud.error?.message ?? "Lifetime shop totals are incomplete.");
    rows=cloud.data ?? [];
  }
  const number=(value:unknown)=>Number.isFinite(Number(value)) ? Number(value) : 0;
  for(const row of rows) {
    const total=totals[canonicalBranchId(row.store_id)];
    if(!total) continue;
    total.revenue+=number(row.revenue);total.profit+=includeProfit ? number(row.profit) : 0;total.bills+=number(row.bills);
  }
  for(const total of Object.values(totals)){total.revenue=r2(total.revenue);total.profit=r2(total.profit);}
  return totals;
}
