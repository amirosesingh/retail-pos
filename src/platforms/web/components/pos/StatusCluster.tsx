/**
 * Consolidated header status controls.
 *
 * Two buttons replace four pills:
 *  - SystemAlertsButton   = system integration health + security alerts
 *  - ConnectionStatusButton = online sync + offline/local SQL database
 *
 * Each shows a single icon normally. When both halves are "active" at the same
 * time (a service is degraded/down *and* alerts are open, or sync needs
 * attention *and* the local database is in use), the button splits in half:
 * left half = first signal, right half = second signal.
 *
 * No database path, instance or table name is ever printed inline — that
 * detail lives in the popover only.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  Activity,
  Settings2,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { usePos } from "@/lib/pos-store";
import { useAuth } from "@/lib/pos-auth";
import {
  overallState,
  runDiagnostics,
  STATE_LABEL,
  type ServiceCheck,
  type ServiceState,
} from "@/lib/system-health";
import {
  listSecurityFindings,
  SEVERITY_TONE,
  SOURCE_LABEL,
  type SecurityFinding,
} from "@/lib/security-alerts";
import { SystemStatusBadge } from "@/platforms/web/components/pos/status/SystemStatus";
import { usePublicFlags } from "@/lib/public-flags";

const DOT: Record<ServiceState, string> = {
  ok: "bg-success",
  degraded: "bg-warning",
  down: "bg-destructive",
  checking: "bg-muted-foreground",
};

type Tone = "ok" | "warn" | "bad" | "idle";

const TONE_CLASS: Record<Tone, string> = {
  ok: "border-success/40 bg-success/10 text-success",
  warn: "border-warning/40 bg-warning/10 text-warning",
  bad: "border-destructive/40 bg-destructive/10 text-destructive",
  idle: "border-border bg-surface-2 text-muted-foreground",
};

const TONE_TEXT: Record<Tone, string> = {
  ok: "text-success",
  warn: "text-warning",
  bad: "text-destructive",
  idle: "text-muted-foreground",
};

/** One icon, or two halves separated by a hairline when both sides are active. */
function SplitTrigger({
  left,
  right,
  leftTone,
  rightTone,
  split,
  badge,
  label,
  className,
}: {
  left: ReactNode;
  right: ReactNode;
  leftTone: Tone;
  rightTone: Tone;
  split: boolean;
  badge?: number;
  label: string;
  className?: string;
}) {
  const tone: Tone = split ? "bad" : rightTone !== "idle" && rightTone !== "ok" ? rightTone : leftTone;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "relative flex h-8 shrink-0 items-center justify-center rounded-md border px-2",
        split ? "gap-0 border-border bg-surface-2 text-foreground" : TONE_CLASS[tone],
        className,
      )}
    >
      {split ? (
        <>
          <span className={cn("flex items-center pr-1.5", TONE_TEXT[leftTone])}>{left}</span>
          <span className="h-4 w-px bg-border" />
          <span className={cn("flex items-center pl-1.5", TONE_TEXT[rightTone])}>{right}</span>
        </>
      ) : (
        <span className="flex items-center">{rightTone !== "idle" && rightTone !== "ok" ? right : left}</span>
      )}
      {!!badge && badge > 0 && (
        <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[9px] font-semibold text-destructive-foreground">
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* System integration + security alerts                                */
/* ------------------------------------------------------------------ */

const SEEN_KEY = "pos.security.seen";

export function SystemAlertsButton({ className }: { className?: string }) {
  const { state: pos } = usePos();
  const { isAdmin } = useAuth();
  const integrations = pos.settings.integrations;
  const { flags } = usePublicFlags();
  const [checks, setChecks] = useState<ServiceCheck[]>([]);
  const [busy, setBusy] = useState(false);
  const [findings, setFindings] = useState<SecurityFinding[]>([]);
  const [open, setOpen] = useState(false);

  const probe = useCallback(
    () =>
      runDiagnostics([
        ...(flags.member ? [{ url: integrations.memberDomain, label: "Member domain" }] : []),
        ...(flags.redeem ? [{ url: integrations.redeemDomain, label: "Redeem domain" }] : []),
      ]).then((results) => [
        ...results,
        ...(!flags.member ? [{ id: "domain:member-disabled", label: "Member domain", state: "ok" as const, detail: "Switched off in settings.", at: new Date().toISOString() }] : []),
        ...(!flags.redeem ? [{ id: "domain:redeem-disabled", label: "Redeem domain", state: "ok" as const, detail: "Switched off in settings.", at: new Date().toISOString() }] : []),
      ]),
    [flags.member, flags.redeem, integrations.memberDomain, integrations.redeemDomain],
  );

  useEffect(() => {
    let live = true;
    const tick = () => void probe().then((r) => live && setChecks(r));
    tick();
    const t = window.setInterval(tick, 120_000);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, [probe]);

  const refreshFindings = useCallback(async () => {
    // The header only needs existing alerts. Running the full database posture
    // audit every 90 seconds made every open admin session do unnecessary work.
    const rows = (await listSecurityFindings()).filter((f) => f.status === "open");
    setFindings(rows);
    if (typeof window !== "undefined")
      localStorage.setItem(SEEN_KEY, JSON.stringify(rows.map((f) => f.id).slice(0, 300)));
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    void refreshFindings();
    const t = setInterval(() => void refreshFindings(), 90_000);
    return () => clearInterval(t);
  }, [isAdmin, refreshFindings]);

  const serviceState = busy && !checks.length ? "checking" : overallState(checks);
  const serviceTone: Tone =
    serviceState === "ok" ? "ok" : serviceState === "degraded" ? "warn" : serviceState === "down" ? "bad" : "idle";
  const alertCount = isAdmin ? findings.length : 0;
  const alertsActive = alertCount > 0;
  const servicesActive = serviceTone === "warn" || serviceTone === "bad";
  const split = alertsActive && servicesActive;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span className={cn("inline-flex", className)}>
          <SplitTrigger
            split={split}
            leftTone={serviceTone}
            rightTone={alertsActive ? "bad" : "ok"}
            badge={!split && alertsActive ? alertCount : undefined}
            label={`System ${STATE_LABEL[serviceState]}${alertsActive ? ` · ${alertCount} security alert${alertCount > 1 ? "s" : ""}` : ""}`}
            left={<Activity className="size-3.5" />}
            right={alertsActive ? <ShieldAlert className="size-3.5" /> : <ShieldCheck className="size-3.5" />}
          />
        </span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-1rem))] p-0">
        <div className="space-y-3 border-b border-border p-3">
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-primary" />
            <p className="text-sm font-semibold">System integration</p>
            <span className="ml-auto text-[11px] text-muted-foreground">
              {STATE_LABEL[serviceState]}
            </span>
          </div>
          <ul className="space-y-2">
            {checks.map((c) => (
              <li key={c.id} className="flex items-start gap-2">
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", DOT[c.state])} />
                <div className="min-w-0">
                  <p className="text-xs font-medium">{c.label}</p>
                  <p className="text-[11px] text-muted-foreground">{c.detail}</p>
                </div>
              </li>
            ))}
            {!checks.length && (
              <li className="text-[11px] text-muted-foreground">Running first check…</li>
            )}
          </ul>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void probe()
                  .then(setChecks)
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? "Testing…" : "Test again"}
            </Button>
            <Button asChild size="sm" className="flex-1">
              <Link to="/settings/system" onClick={() => setOpen(false)}>
                <Settings2 className="size-3.5" /> Open settings
              </Link>
            </Button>
          </div>
        </div>

        {isAdmin && (
          <>
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              {alertsActive ? (
                <ShieldAlert className="size-4 text-destructive" />
              ) : (
                <ShieldCheck className="size-4 text-success" />
              )}
              <p className="text-sm font-medium">Security alerts</p>
              <span className="ml-auto text-[11px] text-muted-foreground">
                {alertCount ? `${alertCount} open` : "All clear"}
              </span>
            </div>
            <div className="max-h-64 overflow-y-auto">
              {!alertsActive ? (
                <p className="px-3 py-5 text-center text-xs text-muted-foreground">
                  Nothing open. The last checks came back clean.
                </p>
              ) : (
                findings.slice(0, 8).map((f) => (
                  <div key={f.id} className="border-b border-border/60 px-3 py-2 last:border-0">
                    <div className="flex items-start gap-2">
                      <span
                        className={cn(
                          "shrink-0 rounded border px-1.5 py-0.5 text-[9px] uppercase",
                          SEVERITY_TONE[f.severity],
                        )}
                      >
                        {f.severity}
                      </span>
                      <p className="min-w-0 text-xs font-medium">{f.title}</p>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{f.detail}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {SOURCE_LABEL[f.source]}
                      {f.deploymentRef ? ` · ${f.deploymentRef}` : ""}
                    </p>
                  </div>
                ))
              )}
            </div>
            <div className="border-t border-border p-2">
              <Button asChild size="sm" variant="secondary" className="w-full text-xs">
                <Link to="/settings/security-alerts" onClick={() => setOpen(false)}>
                  Review all findings
                </Link>
              </Button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------------------ */
/* Online sync + local SQL database                                    */
/* ------------------------------------------------------------------ */

export function ConnectionStatusButton({ className }: { className?: string }) {
  return <SystemStatusBadge className={className} showLabel={false} />;
}
