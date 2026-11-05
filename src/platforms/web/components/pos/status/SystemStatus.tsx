import { formatTime as systemTime } from "@/lib/time-zone";
/**
 * The one status indicator for the whole app (web, desktop till and Android).
 *
 * A single cloud icon reports whether the central database is connecting,
 * online, unavailable, or rejecting the configured credentials.
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Cloud, CloudAlert, CloudOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useSystemStatus, type StatusTone } from "@/lib/system-status";
import { heartbeat } from "@/core/activation/connection-health";

const TONE_TEXT: Record<StatusTone, string> = {
  connecting: "text-muted-foreground",
  ok: "text-success",
  busy: "text-accent",
  offline: "text-destructive",
  error: "text-destructive",
};

const TONE_CHIP: Record<StatusTone, string> = {
  connecting: "border-border bg-surface-2 text-muted-foreground",
  ok: "border-success/40 bg-success/10 text-success",
  busy: "border-accent/40 bg-accent/10 text-accent",
  offline: "border-destructive/40 bg-destructive/10 text-destructive",
  error: "border-destructive/40 bg-destructive/10 text-destructive",
};

/** The cloud icon in the state the tone describes. */
export function CloudStateIcon({ tone, className }: { tone: StatusTone; className?: string }) {
  const Icon = tone === "offline" ? CloudOff : tone === "error" ? CloudAlert : Cloud;
  return (
    <Icon
      aria-hidden
      className={cn("size-4", TONE_TEXT[tone], tone === "connecting" && "animate-pulse", className)}
    />
  );
}

const time = (value: string | null) => (value ? systemTime(value) : "—");

/** Start-up / full-screen version: just the cloud, nothing else. */
export function ConnectingCloud({ className }: { className?: string }) {
  const { tone, label } = useSystemStatus();
  return (
    <div
      className={cn("flex min-h-screen items-center justify-center", className)}
      role="status"
      aria-label={label}
    >
      <CloudStateIcon tone={tone} className="size-10" />
    </div>
  );
}

/** The persistent badge plus its details panel. */
export function SystemStatusBadge({
  className,
  showLabel = true,
}: {
  className?: string;
  showLabel?: boolean;
}) {
  const status = useSystemStatus();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    setBusy(true);
    void heartbeat().finally(() => setBusy(false));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Connection: ${status.label}`}
          title={status.detail}
          className={cn(
            "flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs",
            TONE_CHIP[status.tone],
            className,
          )}
        >
          <CloudStateIcon tone={status.tone} className="size-3.5" />
          {showLabel && <span className="whitespace-nowrap">{status.label}</span>}
          {!showLabel && status.pending > 0 && (
            <span className="text-[10px] font-semibold">{status.pending}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-1rem))] space-y-4 rounded-xl">
        <div className="flex flex-wrap items-center gap-2">
          <CloudStateIcon tone={status.tone} />
          <p className="text-sm font-semibold">
            Database & synchronization
          </p>
          <span className="ml-auto text-[11px] text-muted-foreground">{status.label}</span>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">{status.detail}</p>
        <div className="rounded-lg border border-primary/15 bg-primary/5 px-3 py-2">
          <p className="text-[11px] text-muted-foreground">Saving transactions to</p>
          <p className="mt-1 text-sm font-semibold text-primary">{status.databaseMode}</p>
        </div>

        <dl className="space-y-1.5 text-[11px]">
          {
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Online Supabase</dt>
              <dd
                className={cn(
                  "font-medium",
                  status.connectivity === "online" ? "text-success" : status.connectivity === "connecting" ? "text-muted-foreground" : "text-destructive",
                )}
              >
                {!status.cloudConfigured ? "Not configured" : status.credentialsInvalid ? "Check credentials" : status.connectivity === "online" ? "Connected" : status.connectivity === "connecting" ? "Checking…" : "Unavailable"}
              </dd>
            </div>
          }
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Connection checked</dt>
            <dd className="font-medium">{time(status.checkedAt)}</dd>
          </div>
          {status.local.connected && (
            <>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Local SQL Server</dt>
                <dd className={cn("font-medium", status.local.ready ? "text-success" : "text-muted-foreground")}>
                  {status.local.ready ? "Ready" : "Preparing"}{!status.local.inUse ? " · not in use" : ""}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Local database</dt>
                <dd className="max-w-48 break-all text-right font-medium">
                  {status.local.database ?? "SQL Server"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">SQL health checked</dt>
                <dd className="font-medium">{time(status.local.lastCheckedAt)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Sync queue</dt>
                <dd
                  className={cn("font-medium", status.failed ? "text-destructive" : "text-success")}
                >
                  {status.pending} waiting · {status.failed} errors
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Synchronization</dt>
                <dd className="font-medium">
                  {status.syncing ? (status.syncPhase === "pulling" ? "Receiving updates" : "Sending updates") : status.lastError ? "Needs attention" : status.pending ? "Waiting to send" : status.lastSyncAt ? "Up to date" : "Waiting for first sync"}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Last cloud synchronization</dt>
                <dd className="font-medium">{time(status.lastSyncAt)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Conflicts</dt>
                <dd className="font-medium">{status.conflicts}</dd>
              </div>
            </>
          )}
        </dl>

        {status.lastError && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-[11px] text-destructive">
            {status.lastError}
          </p>
        )}

        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="flex-1" disabled={busy} onClick={refresh}>
            <RefreshCw className={cn("size-3.5", busy && "animate-spin")} /> Re-check
          </Button>
          <Button asChild size="sm" className="flex-1">
            <Link to="/settings/database" onClick={() => setOpen(false)}>
              Database settings
            </Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
