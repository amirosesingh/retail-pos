/**
 * The start-up screen of the till, with the connection state written on it.
 *
 * While the first heartbeat is still in flight the screen says "Connecting…"
 * and shows the pulsing cloud — it never claims the till is offline on a
 * guess, and it waits as long as the check needs. Only once the check has
 * actually answered does it turn green (central database connected) or amber
 * (working from this terminal), and only then may it offer a way out.
 */
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  connectivity,
  lastHealth,
  subscribeConnectivity,
  type Connectivity,
  type HealthReport,
} from "@/core/activation/connection-health";
import { subscribeSyncState, syncState } from "@/lib/sync-status";
import { CloudStateIcon } from "@/platforms/web/components/pos/status/SystemStatus";
import type { StatusTone } from "@/lib/system-status";
import { cn } from "@/lib/utils";
import { isOnlineOnly } from "@/lib/live-mode";
import { EmergencyAccessLink } from "@/components/shared/EmergencyAccessLink";

const TONE: Record<StatusTone, { bar: string; text: string; label: string }> = {
  connecting: {
    bar: "bg-muted-foreground/40",
    text: "text-muted-foreground",
    label: "Connecting…",
  },
  ok: { bar: "bg-success", text: "text-success", label: "Online — central database connected" },
  busy: { bar: "bg-accent", text: "text-accent", label: "Syncing data…" },
  offline: {
    bar: "bg-warning",
    text: "text-warning",
    label: "Offline — working from this terminal",
  },
  error: { bar: "bg-destructive", text: "text-destructive", label: "Connection problem" },
};

/** How long the startup screen waits before offering recovery. */
const STALL_MS = 12000;

export function TillLoader({
  message = "Loading store data…",
  onContinueOffline,
  onRetry,
}: {
  message?: string;
  onContinueOffline?: () => void;
  onRetry?: () => void;
}) {
  const [health, setHealth] = useState<HealthReport | null>(lastHealth());
  const [state, setState] = useState<Connectivity>(connectivity());
  const [phase, setPhase] = useState(syncState().phase);
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    const off = subscribeConnectivity((next) => {
      setState(next);
      setHealth(lastHealth());
    });
    const offSync = subscribeSyncState(() => setPhase(syncState().phase));
    return () => {
      off();
      offSync();
    };
  }, []);

  // Recovery must remain available even if the first connection check is
  // stalled. Connectivity notifications must not restart this deadline.
  useEffect(() => {
    const stall = window.setTimeout(() => setStalled(true), STALL_MS);
    return () => window.clearTimeout(stall);
  }, []);

  const tone: StatusTone =
    state === "connecting"
      ? "connecting"
      : phase === "syncing"
        ? "busy"
        : state === "online"
          ? "ok"
          : "offline";
  const style = TONE[tone];

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6">
      <div className="flex items-center gap-2">
        <CloudStateIcon tone={tone} className="size-5" />
        <p className="text-sm font-medium">{tone === "connecting" ? "Connecting…" : message}</p>
        {tone === "offline" && (
          <span className="rounded-full border border-warning px-2 py-0.5 text-[11px] uppercase tracking-wide text-warning">
            Offline
          </span>
        )}
      </div>

      <div role="progressbar" aria-label={message} aria-valuemin={0} aria-valuemax={100} className="h-1.5 w-64 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", style.bar, "w-1/2 animate-pulse")} />
      </div>

      <p className={cn("text-xs", style.text)}>{style.label}</p>
      {!isOnlineOnly() && state !== "connecting" && health && (
        <div className="space-y-2 text-center"><p className="text-xs text-muted-foreground">
          Terminal database {health.local ? "ready" : "unavailable"}
        </p>{!health.local && <EmergencyAccessLink />}</div>
      )}

      {stalled && (
        <div className="flex flex-col items-center gap-3 pt-2">
          <p role="status" className="max-w-xs text-center text-xs text-muted-foreground">
            Still loading. You can retry without clearing your saved connection.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onRetry ?? (() => window.location.reload())}
            >
              <RefreshCw className="mr-1.5 size-3.5" /> Try again
            </Button>
            {onContinueOffline && health?.local && (
              <Button size="sm" onClick={onContinueOffline}>
                Continue on this terminal
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
