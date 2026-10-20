import { formatDateTime as posDisplayDateTime } from "@/lib/time-zone";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { notifyError } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/pos-auth";
import {
  assessSecurityFindings,
  setFindingStatus,
  SEVERITY_TONE,
  SOURCE_LABEL,
  type SecurityFinding,
} from "@/lib/security-alerts";

function when(value: string): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : posDisplayDateTime(d);
}

export function SecurityAlertsPanel() {
  const { user, isAdmin } = useAuth();
  const [rows, setRows] = useState<SecurityFinding[]>([]);
  const [showResolved, setShowResolved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyFinding, setBusyFinding] = useState("");
  const busyFindingRef = useRef("");
  const [checkedAt, setCheckedAt] = useState<string>("");

  const load = useCallback(async () => {
    // Every visit re-tests the current conditions instead of trusting flags.
    const res = await assessSecurityFindings(showResolved);
    setRows(res.findings);
    setCheckedAt(res.retested ? res.checkedAt : "");
  }, [showResolved]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(f: SecurityFinding, status: SecurityFinding["status"]) {
    if (busyFindingRef.current) return;
    busyFindingRef.current = f.id;
    setBusyFinding(f.id);
    try {
      await setFindingStatus(f.id, status, user?.name ?? user?.staffId ?? "admin");
      await load();
    } catch (e) {
      notifyError(e);
    } finally {
      busyFindingRef.current = "";
      setBusyFinding("");
    }
  }

  async function scanNow() {
    setBusy(true);
    try {
      await load();
      toast.success("Re-tested — the list shows only conditions still true");
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  }

  if (!isAdmin) {
    return (
      <div className="w-full max-w-full space-y-5">
        <p className="text-sm text-muted-foreground">
          Ask an administrator to review security findings.
        </p>
      </div>
    );
  }

  const open = rows.filter((r) => r.status !== "resolved");

  return (
    <div className="w-full max-w-full space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div
          className={cn(
            "flex items-center gap-2 rounded-md border px-3 py-2 text-sm",
            open.length === 0
              ? "border-success/40 bg-success/10 text-success"
              : "border-destructive/40 bg-destructive/10 text-destructive",
          )}
        >
          {open.length === 0 ? (
            <ShieldCheck className="size-4" />
          ) : (
            <ShieldAlert className="size-4" />
          )}
          {open.length === 0
            ? "No open findings"
            : `${open.length} finding${open.length > 1 ? "s" : ""} need review`}
        </div>
        <div className="flex items-center gap-2">
          <Switch id="resolved" checked={showResolved} onCheckedChange={setShowResolved} />
          <Label htmlFor="resolved" className="text-xs">
            Show resolved
          </Label>
        </div>
        <Button size="sm" variant="outline" className="ml-auto" disabled={busy} onClick={scanNow}>
          <RefreshCw className={cn("size-3.5", busy && "animate-spin")} /> Run check now
        </Button>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {checkedAt ? `Last re-tested ${when(checkedAt)}` : "Showing the last stored results."}
      </p>

      <div className="mt-4 space-y-2">
        {rows.length === 0 && (
          <p className="rounded-md border border-border bg-surface-2 px-3 py-6 text-center text-sm text-muted-foreground">
            Nothing reported yet.
          </p>
        )}
        {rows.map((f) => (
          <div key={f.id} className="rounded-md border border-border bg-card p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "rounded border px-1.5 py-0.5 text-[10px] uppercase",
                  SEVERITY_TONE[f.severity],
                )}
              >
                {f.severity}
              </span>
              <p className="min-w-0 flex-1 text-sm font-medium">{f.title}</p>
              <span className="text-[11px] capitalize text-muted-foreground">{f.status}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{f.detail}</p>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {SOURCE_LABEL[f.source]}
              {f.deploymentRef ? ` · ${f.deploymentRef}` : ""} · first seen {when(f.firstSeenAt)} ·
              last seen {when(f.lastSeenAt)}
              {f.acknowledgedBy ? ` · handled by ${f.acknowledgedBy}` : ""}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {f.status === "open" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={Boolean(busyFinding)}
                  aria-busy={busyFinding === f.id}
                  onClick={() => void act(f, "acknowledged")}
                >
                  {busyFinding === f.id ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  {busyFinding === f.id ? "Saving…" : "Acknowledge"}
                </Button>
              )}
              {f.status !== "resolved" && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={Boolean(busyFinding)}
                  aria-busy={busyFinding === f.id}
                  onClick={() => void act(f, "resolved")}
                >
                  {busyFinding === f.id ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  {busyFinding === f.id ? "Saving…" : "Mark fixed"}
                </Button>
              )}
              {f.status === "resolved" && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={Boolean(busyFinding)}
                  aria-busy={busyFinding === f.id}
                  onClick={() => void act(f, "open")}
                >
                  {busyFinding === f.id ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  {busyFinding === f.id ? "Saving…" : "Reopen"}
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
