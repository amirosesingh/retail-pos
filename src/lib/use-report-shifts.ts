import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Shift } from "@/core/types/pos-types";
import { canonicalBranchId } from "./branch-id";
import { PAGE_DATA_CACHE, pageDataScope } from "./page-data-cache";
import { useAuth } from "./pos-auth";
import { readCompleteShiftHistory, shiftHistoryNetworkMode } from "./shift-history-read";
import { effectiveTimeZone } from "./time-zone";
import { mergeReportShiftRows } from "./report-shift-rows";

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
  const shifts=useMemo(()=>mergeReportShiftRows(seed,query.data??[],branchId,from,to,zone),
    [seed,query.data,branchId,from,to,zone]);
  return { shifts:allowed?shifts:[], loading:allowed&&query.isPending, refreshing:allowed&&query.isFetching&&!query.isPending,
    error:allowed&&query.error?(query.error instanceof Error?query.error.message:String(query.error)):"" };
}
