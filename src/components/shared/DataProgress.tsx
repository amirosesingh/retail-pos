import { useSyncExternalStore } from "react";
import { dataProgress, subscribeDataProgress } from "@/lib/data-progress";

export function DataProgress() {
  const tasks = useSyncExternalStore(subscribeDataProgress, dataProgress, dataProgress);
  if (!tasks.length) return null;
  const task = tasks[tasks.length - 1];
  const percent =
    task.total && task.completed < task.total
      ? Math.min(99, Math.floor((task.completed / task.total) * 100))
      : null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed left-1/2 top-2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 rounded-md border bg-background/95 px-4 py-2 text-xs shadow-sm"
    >
      <div className="flex justify-between gap-3">
        <span>
          {task.label}
          {tasks.length > 1 ? ` · ${tasks.length} operations active` : ""}
        </span>
        <span>
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
        className="mt-1 h-1 overflow-hidden rounded bg-muted"
      >
        <div
          className={`h-full bg-primary ${percent === null ? "w-1/3 animate-pulse" : ""}`}
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
