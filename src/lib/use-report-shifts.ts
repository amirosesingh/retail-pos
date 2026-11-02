import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Shift } from "@/core/types/pos-types";
import { canonicalBranchId } from "./branch-id";
import { PAGE_DATA_CACHE, pageDataScope } from "./page-data-cache";
import { useAuth } from "./pos-auth";
import { readCompleteShiftHistory, shiftHistoryNetworkMode } from "./shift-history-read";
import { effectiveTimeZone, inPosDayRange } from "./time-zone";

/** One cached complete branch/date history; changing branch never shows old rows. */
export function useReportShifts(seed: Shift[], branchId: string, from: string, to: string, enabled=true, source: "auto"|"cloud"="auto") {
  const { ready, user }=useAuth();
  const zone=effectiveTimeZone();
  const allowed=enabled && ready && !!user && !!branchId && (!from || !to || from<=to);
  const rangeKey=JSON.stringify([pageDataScope(user),canonicalBranchId(branchId),from,to,zone,source]);
  const query=useQuery({
    queryKey:["report-shifts",rangeKey], enabled:allowed,
    queryFn:({signal})=>readCompleteShiftHistory(branchId,from,to,zone,signal,source),
    networkMode:shiftHistoryNetworkMode(source),
    meta:{tables:["shifts"],liveRefresh:{allowOffline:source === "auto"}}, ...PAGE_DATA_CACHE, retry:false,
    refetchOnWindowFocus:false,refetchOnReconnect:false,
  });
  const shifts=useMemo(()=>{
    const rows=new Map<string,Shift>();
    for(const shift of [...seed,...(query.data??[])]) {
      if(canonicalBranchId(shift.storeId)===canonicalBranchId(branchId) && inPosDayRange(shift.openedAt,from,to,zone))
        rows.set(canonicalBranchId(shift.id),shift);
    }
    return [...rows.values()].sort((a,b)=>b.openedAt.localeCompare(a.openedAt)||b.id.localeCompare(a.id));
  },[seed,query.data,branchId,from,to,zone]);
  return { shifts:allowed?shifts:[], loading:allowed&&query.isPending, refreshing:allowed&&query.isFetching&&!query.isPending,
    error:allowed&&query.error?(query.error instanceof Error?query.error.message:String(query.error)):"" };
}
