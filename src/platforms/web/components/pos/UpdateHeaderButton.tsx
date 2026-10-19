import { useState } from "react";
import { UpdateConfirmation } from "./MinimalUpdatePanel";
import { Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAppUpdates } from "@/lib/app-updates";

/**
 * Software updates next to the settings gear, so nobody has to hunt through
 * Settings to find them. A dot appears the moment a release is waiting.
 */
export function UpdateHeaderButton({ className }: { className?: string }) {
  const updates = useAppUpdates();
  const { state, supported } = updates;
  const [open, setOpen] = useState(false);
  const waiting = state.status !== "unavailable" && state.status !== "current" && (state.status === "ready" || !!state.available);
  const busy = state.status === "checking" || state.status === "downloading";

  if (!supported || !waiting) return null;
  return <>
      <Button variant="ghost" size="icon" className={cn("relative shrink-0", className)} aria-label="Software update available" title="Update Retail" onClick={() => setOpen(true)}>
        {busy ? <RefreshCw className="size-4 animate-spin" /> : <Download className="size-4" />}
        <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-primary" />
      </Button>
      <UpdateConfirmation updates={updates} open={open} onOpenChange={setOpen} />
  </>;
}
