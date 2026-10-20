import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { loadActiveShift } from "@/core/api/pos-db";
import { usePos } from "@/lib/pos-store";
import { useAuth } from "@/lib/pos-auth";
import { activeBranchId } from "@/lib/active-branch";
import { sameBranchId } from "@/lib/branch-id";
import { sessionEpoch } from "@/lib/session-epoch";
import { subscribeDataChange } from "@/lib/sync-engine";


/** Shared read-only status; never changes the terminal trading shift. */
export function useViewedBranchShift() {
  const { currentStore, activeShift, shiftChecked, shiftReadError } = usePos();
  const { user } = useAuth();
  const storeId = currentStore.id;
  const viewingOtherBranch = !sameBranchId(storeId, activeBranchId(storeId));
  const query = useQuery({
    queryKey: ["viewed-branch-shift", sessionEpoch(), user?.staffId ?? user?.name, storeId],
    queryFn: () => loadActiveShift(storeId),
    enabled: !!storeId && !!user && viewingOtherBranch,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  const { refetch } = query;
  useEffect(() => {
    if (!viewingOtherBranch || !user) return;
    return subscribeDataChange(change => {
      if (change.table === "shifts" && (!change.storeId || sameBranchId(change.storeId, storeId)))
        void refetch();
    });
  }, [viewingOtherBranch, storeId, user, refetch]);
  const candidate = viewingOtherBranch ? query.data : activeShift;
  const shift = candidate && sameBranchId(candidate.storeId, storeId) && !candidate.closedAt && candidate.status !== "CLOSED"
    ? candidate : null;
  const checked = viewingOtherBranch ? query.isSuccess || query.isError : shiftChecked;
  const error = viewingOtherBranch ? query.isError : !!shiftReadError;
  return { shift, checked, error, currentStore };
}
