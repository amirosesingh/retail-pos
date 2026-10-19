/** Mobile connection and security details; activity notifications have their own header bell. */
import type { ReactNode } from "react";
import { Cloud, CloudCheck, CloudOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  ConnectionStatusButton,
  SystemAlertsButton,
} from "@/platforms/web/components/pos/StatusCluster";
import { useSystemStatus } from "@/lib/system-status";
import { cn } from "@/lib/utils";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-2 px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

export function MobileStatusSheet({ className }: { className?: string }) {
  const status = useSystemStatus();
  const failed = status.tone === "error" || status.tone === "offline";
  const healthy = status.tone === "ok" && !status.failed && !status.conflicts;
  const tone = failed ? "text-destructive" : healthy ? "text-success" : "text-warning";
  const StatusIcon = failed ? CloudOff : healthy ? CloudCheck : Cloud;

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Connection and alerts: ${status.label}`}
          title={status.detail}
          className={cn("size-9 shrink-0 border-0 bg-transparent shadow-none hover:bg-transparent", className)}
        >
          <StatusIcon className={cn("size-4", tone)} />
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
        <SheetTitle className="text-sm">Status &amp; alerts</SheetTitle>
        <div className="mt-3 space-y-2 pb-6">
          <Row label="Connection">
            <span className={cn("text-xs font-medium", tone)}>
              {status.label}
            </span>
          </Row>
          <Row label="Connection detail">
            <ConnectionStatusButton />
          </Row>
          <Row label="System &amp; security">
            <SystemAlertsButton />
          </Row>
        </div>
      </SheetContent>
    </Sheet>
  );
}
