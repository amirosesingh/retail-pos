import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Lock, WifiOff } from "lucide-react";
import { loadActiveShift } from "@/core/api/pos-db";
import { money, usePos } from "@/lib/pos-store";
import { useAuth } from "@/lib/pos-auth";
import { activeBranchId } from "@/lib/active-branch";
import { sameBranchId } from "@/lib/branch-id";
import { sessionEpoch } from "@/lib/session-epoch";
import { shiftDuration } from "@/lib/shift-hours";
import { subscribeDataChange } from "@/lib/sync-engine";

/** Read-only status for the selected view; never replaces the terminal's trading shift. */
export function BranchShiftBanner() {
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
  const label = currentStore.name || "selected branch";
  const opened = shift ? new Date(shift.openedAt) : null;
  return (
    <div role="status" className={`flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-1.5 text-[11px] ${shift ? "border-success/30 bg-success/10 text-success" : "border-border bg-muted/40 text-muted-foreground"}`}>
      {shift && opened ? <>
        <span className="font-semibold">Shift {shift.state && shift.state !== "ACTIVE" ? "closing" : "open"} · {label}</span>
        <span>Opened {opened.toLocaleDateString()} at {opened.toLocaleTimeString()}</span>
        <span>Float {money(shift.openingFloat)}</span>
        <span>Running {shiftDuration(shift)}</span>
        {error && <span className="flex items-center gap-1 text-warning"><WifiOff className="size-3" /> Reconnecting — showing last known status</span>}
      </> : !checked ? <>
        <Loader2 className="size-3 animate-spin" /><span>Checking the open shift at {label}…</span>
      </> : error ? <>
        <WifiOff className="size-3" /><span>Shift status unavailable at {label} — retrying</span>
      </> : <>
        <Lock className="size-3" /><span className="font-semibold">No shift open at {label}</span>
      </>}
    </div>
  );
}
