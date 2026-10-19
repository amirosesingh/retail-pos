/** Presentation only: never use these groups to authorize a state transition. */
export function statusLabelTone(status: string): string {
  const value = status.trim().toLowerCase().replace(/[_-]+/g, " ");
  if (["posted", "success", "successful", "approved", "completed", "complete", "received", "paid", "active", "verified", "synced", "delivered", "fulfilled"].includes(value))
    return "border-emerald-600/30 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300";
  if (["draft", "drafted", "pending", "requested", "awaiting approval", "awaiting payment", "queued", "partial", "partially received"].includes(value))
    return "border-amber-600/30 bg-amber-50 text-amber-900 dark:bg-amber-950/50 dark:text-amber-300";
  if (["failed", "error", "rejected", "denied", "overdue", "blocked"].includes(value))
    return "border-red-600/30 bg-red-50 text-red-800 dark:bg-red-950/50 dark:text-red-300";
  if (["processing", "in progress", "dispatched", "in transit", "open", "running"].includes(value))
    return "border-sky-600/30 bg-sky-50 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300";
  return "border-border bg-muted text-muted-foreground";
}
