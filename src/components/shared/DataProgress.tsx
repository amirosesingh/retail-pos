import { useSyncExternalStore } from "react";
import { Loader2 } from "lucide-react";
import { dataProgress, subscribeDataProgress } from "@/lib/data-progress";
import { cn } from "@/lib/utils";

export function DataProgress({ variant = "inline" }: { variant?: "inline" | "panel" }) {
  const tasks = useSyncExternalStore(subscribeDataProgress, dataProgress, dataProgress);
  if (!tasks.length) return null;
  const task = tasks[tasks.length - 1];
  const percent =
    task.total === null
      ? null
      : task.total === 0
        ? 100
        : Math.min(100, Math.floor((task.completed / task.total) * 100));
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "shrink-0 border-border/70 bg-muted/25 text-xs",
        variant === "panel"
          ? "w-full max-w-md rounded-xl border px-4 py-3"
          : "border-b px-3 py-2 sm:px-4",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <Loader2
            aria-hidden="true"
            className="size-3.5 shrink-0 animate-spin text-primary motion-reduce:animate-none"
          />
          <span className="min-w-0 font-medium">{task.label}</span>
          {tasks.length > 1 && (
            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {tasks.length} active
            </span>
          )}
        </div>
        <span className="tabular-nums text-muted-foreground">
          {task.completed.toLocaleString()} records
          {task.total !== null ? ` / ${task.total.toLocaleString()}` : " processed"}
          {percent !== null ? ` · ${percent}%` : ""}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={task.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        className="mt-2 h-1 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn(
            "h-full rounded-full bg-primary",
            percent === null && "w-1/3 animate-pulse motion-reduce:animate-none",
          )}
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
