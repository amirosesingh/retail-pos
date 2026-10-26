import { formatTime as systemTime } from "@/lib/time-zone";
import { formatDate as posDisplayDate } from "@/lib/time-zone";
import { Loader2, Lock, WifiOff } from "lucide-react";
import { money } from "@/lib/pos-store";
import { shiftDuration } from "@/lib/shift-hours";
import { useViewedBranchShift } from "@/lib/use-viewed-branch-shift";

/** Read-only status for the selected view; never replaces the terminal's trading shift. */
export function BranchShiftBanner() {
  const { shift, checked, error, currentStore } = useViewedBranchShift();
  const label = currentStore.name || "selected branch";
  const opened = shift ? new Date(shift.openedAt) : null;
  return (
    <div role="status" className={`flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-4 py-1.5 text-[11px] ${shift ? "border-success/30 bg-success/10 text-success" : "border-border bg-muted/40 text-muted-foreground"}`}>
      {shift && opened ? <>
        <span className="font-semibold">Shift {shift.state && shift.state !== "ACTIVE" ? "closing" : "open"} · {label}</span>
        <span>Opened {posDisplayDate(opened)} at {systemTime(opened)}</span>
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
