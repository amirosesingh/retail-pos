import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export function LoginOptions({ children }: { children: ReactNode }) {
  return <details className="group rounded-md border border-border">
    <summary className="flex cursor-pointer list-none items-center justify-center gap-2 rounded-md p-2 text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      More sign-in options <ChevronDown aria-hidden className="size-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
    </summary>
    <div className="space-y-3 border-t border-border p-3">{children}</div>
  </details>;
}
