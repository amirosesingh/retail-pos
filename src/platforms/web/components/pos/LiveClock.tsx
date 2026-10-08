/**
 * The one place the current date and time is always visible.
 *
 * Ticks every second in the app header, and shows how long the open shift has
 * been running so the cashier never has to guess.
 */
import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { usePos } from "@/lib/pos-store";
import { cn } from "@/lib/utils";

const elapsed = (fromIso: string, now: number) => {
  const ms = Math.max(0, now - Date.parse(fromIso));
  const mins = Math.floor(ms / 60_000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
};

export function LiveClock({ className, compact }: { className?: string; compact?: boolean }) {
  const { activeShift } = usePos();
  // Rendered only after mount so the server and the browser never disagree.
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    let timer: number | undefined;
    const start = () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
      setNow(Date.now());
      if (document.visibilityState === "visible") {
        timer = window.setInterval(() => setNow(Date.now()), 1000);
      }
    };
    start();
    document.addEventListener("visibilitychange", start);
    return () => {
      if (timer !== undefined) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", start);
    };
  }, []);

  if (now === null) return null;
  const d = new Date(now);
  const date = d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const time = d.toLocaleTimeString(undefined, { hour12: false });

  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-md border border-border bg-surface-2 px-1.5 py-0.5",
        className,
      )}
      aria-label="Current date and time"
    >
      <Clock className="size-3 shrink-0 text-muted-foreground" />
      <span className="numeric text-[11px] leading-tight">
        {!compact && <span className="text-muted-foreground">{date} · </span>}
        <span className="font-semibold">{time}</span>
      </span>
      {activeShift && (
        <span className="numeric text-[11px] text-success">· {elapsed(activeShift.openedAt, now)}</span>
      )}
    </div>
  );
}
