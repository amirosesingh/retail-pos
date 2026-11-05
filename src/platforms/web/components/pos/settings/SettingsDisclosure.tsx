import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/** Keep draft controls mounted while folding long settings sections. */
export function SettingsDisclosure({ title, description, children, initialOpen = false }: { title: string; description?: string; children: ReactNode; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  return <details open={open} onToggle={event => setOpen(event.currentTarget.open)} className="group min-w-0 rounded-xl border bg-card">
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
      <span className="min-w-0"><span className="block text-base font-semibold">{title}</span>{description && <span className="mt-1 block text-sm font-normal text-muted-foreground">{description}</span>}</span>
      <ChevronDown aria-hidden="true" className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" />
    </summary>
    <div className="min-w-0 space-y-4 border-t p-4">{children}</div>
  </details>;
}
