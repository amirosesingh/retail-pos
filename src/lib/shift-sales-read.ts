import { loadSalesPage,rowToSale } from "@/core/api/pos-db";
import type { Sale } from "@/core/types/pos-types";
import type { Cursor,Page } from "./keyset";
import { canonicalBranchId } from "./branch-id";
import { readManagementReport } from "./management-report-client";
import { effectiveTimeZone } from "./time-zone";

/** Every bill of exactly one branch/shift, irrespective of midnight/date. */
export async function readCompleteShiftSales(branchId:string,shiftId:string,signal?:AbortSignal):Promise<Sale[]> {
 if(!branchId || !shiftId) throw new Error("A branch and shift are required.");
 const found=new Map<string,Sale>();
 let cursor:Cursor=null;
 let source:string|undefined;
 for(let pageNumber=0;pageNumber<1000;pageNumber++){
  if(signal?.aborted) throw new Error("Shift sales read cancelled");
  const replica:Awaited<ReturnType<typeof readManagementReport>>=source!=="cloud" && source!=="local" ? await readManagementReport({kind:"sales",storeIds:[branchId],shiftId,
   from:"1900-01-01",to:"9999-12-31",zone:effectiveTimeZone(),limit:500,cursor}) : null;
  if(source==="management" && !replica) throw new Error("The management replica changed during the shift report. Refresh before printing.");
  const page:Page<Sale>&{source?:string}=replica ? {rows:(replica.rows??[]).map(rowToSale),cursor:replica.cursor??null,hasMore:replica.hasMore===true,source:"management"}
   : await loadSalesPage(branchId,cursor,500,{shiftId,source:source==="cloud"?"cloud":"auto"});
  if(signal?.aborted) throw new Error("Shift sales read cancelled");
  if(source && page.source && source!==page.source) throw new Error("The shift report source changed. Refresh before printing.");
  source=page.source;
  for(const sale of page.rows){
   if(canonicalBranchId(sale.storeId)!==canonicalBranchId(branchId) || canonicalBranchId(sale.shiftId)!==canonicalBranchId(shiftId))
    throw new Error("The shift report contained a bill from another branch or shift.");
   found.set(canonicalBranchId(sale.id),sale);
  }
  if(!page.hasMore) return [...found.values()];
  if(!page.cursor || (page.cursor.id===cursor?.id && page.cursor.ts===cursor?.ts)) throw new Error("Shift report pagination did not advance.");
  cursor=page.cursor;
 }
 throw new Error("This shift report is too large to print safely.");
}
