import { cn } from "@/lib/utils";

/** Start with six slots, then grow without exposing the PIN's digits. */
export function PinEntryDots({ length }: { length: number }) {
  return <div className="flex flex-wrap items-center justify-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-3"
    aria-label="PIN entry" role="status">
    {Array.from({ length: Math.min(12, Math.max(6, length)) }, (_, index) =>
      <span key={index} className={cn("size-3.5 shrink-0 rounded-full border border-border", index < length ? "bg-primary" : "bg-transparent")} />)}
  </div>;
}
