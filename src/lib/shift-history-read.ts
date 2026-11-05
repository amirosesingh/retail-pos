import { loadShiftPage } from "@/core/api/pos-db";
import type { Shift } from "@/core/types/pos-types";
import type { Cursor } from "./keyset";
import { canonicalBranchId } from "./branch-id";
import { inPosDayRange, reportScanEnd, reportScanStart } from "./time-zone";

export const shiftHistoryNetworkMode=(source:"auto"|"cloud"):"always"|"online"=>source==="auto"?"always":"online";

export async function readCompleteShiftHistory(
  branchId: string, from: string, to: string, timeZone: string,
  signal?: AbortSignal, source: "auto" | "cloud" = "auto",
): Promise<Shift[]> {
  if (!branchId || (from && to && from > to)) throw new Error("Choose a valid branch and shift date range.");
  let cursor: Cursor = null;
  let readSource: string|undefined;
  const found = new Map<string, Shift>();
  for (let pageNumber=0; pageNumber<1_000; pageNumber++) {
    if (signal?.aborted) throw new Error("Shift history read cancelled");
    const page = await loadShiftPage(branchId, cursor, 500, {
      ...(from ? { from: new Date(reportScanStart(from)).toISOString() } : {}),
      ...(to ? { to: new Date(reportScanEnd(to)).toISOString() } : {}), source,
      businessFrom:from,businessTo:to,timeZone,
    });
    if (signal?.aborted) throw new Error("Shift history read cancelled");
    if(readSource && page.source && page.source!==readSource) throw new Error("The shift history source changed during this report. Refresh before continuing.");
    readSource=page.source;
    for (const row of page.rows) {
      if (canonicalBranchId(row.storeId)===canonicalBranchId(branchId) && inPosDayRange(row.openedAt,from,to,timeZone))
        found.set(canonicalBranchId(row.id),row);
    }
    if (!page.hasMore) return [...found.values()];
    if (!page.cursor || (page.cursor.id===cursor?.id && page.cursor.ts===cursor?.ts))
      throw new Error("Shift history pagination did not advance. Please retry.");
    cursor=page.cursor;
  }
  throw new Error("This shift history is too large. Choose a shorter date range.");
}
