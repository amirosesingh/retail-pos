import { useEffect, useState } from "react";
import { Activity, ClipboardCopy, Copy, Eraser, PlugZap, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { notifyError } from "@/lib/notify";
import { UnpairTerminalCard } from "@/platforms/web/components/pos/UnpairTerminal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { usePos } from "@/lib/pos-store";
import { MEMBER_FLAG, REDEEM_FLAG, setPublicFlag, usePublicFlags } from "@/lib/public-flags";
import { cn } from "@/lib/utils";
import {
  clearHealthErrors,
  listHealthErrors,
  overallState,
  runDiagnostics,
  retryQuarantined,
  STATE_LABEL,
  type HealthError,
  type ServiceCheck,
  type ServiceState,
} from "@/lib/system-health";

const dot: Record<ServiceState, string> = {
  ok: "bg-success",
  degraded: "bg-warning",
  down: "bg-destructive",
  checking: "bg-muted-foreground",
};

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
};

/** On/off switch for a public subdomain, saved straight to the database. */
function DomainSwitch({
  label,
  hint,
  flagKey,
  enabled,
}: {
  label: string;
  hint: string;
  flagKey: string;
  enabled: boolean;
}) {
  const [saving, setSaving] = useState(false);
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </div>
      <Switch
        aria-label={label}
        checked={enabled}
        disabled={saving}
        onCheckedChange={(v) => {
          setSaving(true);
          void setPublicFlag(flagKey, v)
            .then(() => toast.success(v ? `${label} is now live` : `${label} is switched off`))
            .catch((e: unknown) => notifyError(e, "Could not save the switch"))
            .finally(() => setSaving(false));
        }}
      />
    </div>
  );
}

export function SystemStatusPanel() {
  const { state, updateSettings, saveConfiguredSettings } = usePos();
  const integrations = state.settings.integrations;
  const [checks, setChecks] = useState<ServiceCheck[]>([]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<HealthError[]>([]);
  const [showErrors, setShowErrors] = useState(false);
  const [dnsOpen, setDnsOpen] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);
  const [cacheUsage, setCacheUsage] = useState<{ totalBytes: number; cacheBytes: number; diagnosticBytes: number } | null>(null);
  const [memberDomain, setMemberDomain] = useState(integrations.memberDomain);
  const [redeemDomain, setRedeemDomain] = useState(integrations.redeemDomain);
  const { flags } = usePublicFlags();

  useEffect(() => {
    setMemberDomain(integrations.memberDomain);
    setRedeemDomain(integrations.redeemDomain);
  }, [integrations.memberDomain, integrations.redeemDomain]);

  const refresh = () => setErrors(listHealthErrors());

  const diagnose = () => {
    setBusy(true);
    void runDiagnostics([
      ...(flags.member ? [{ url: integrations.memberDomain, label: "Member domain" }] : []),
      ...(flags.redeem ? [{ url: integrations.redeemDomain, label: "Redeem domain" }] : []),
    ])
      .then((r) => {
        setChecks(r);
        refresh();
      })
      .finally(() => setBusy(false));
  };

  useEffect(() => {
    diagnose();
    void window.pos?.cacheStatus?.().then((result) => {
      if (result.ok) setCacheUsage(result);
    }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const overall = busy && !checks.length ? "checking" : overallState(checks);
  const unhealthy = overall === "down" || overall === "degraded";

  const forceReconnect = () => {
    retryQuarantined();
    toast.success("Reconnecting — queued changes will retry now");
    diagnose();
  };

  const clearCache = async () => {
    setClearingCache(true);
    try {
      for (const key of Object.keys(window.localStorage)) {
        // Recovery must never unregister this device or replace its pending QR.
        if (key.startsWith("pos.") && !key.startsWith("pos.terminal")) {
          window.localStorage.removeItem(key);
        }
      }
      window.sessionStorage.clear();
      const result = await window.pos?.clearAppCache?.();
      if (result?.ok === false) throw new Error(result.error ?? "Electron could not clear its cache.");
      if (result?.ok) setCacheUsage(result as { totalBytes: number; cacheBytes: number; diagnosticBytes: number });
      toast.success("App cache cleared — reloading");
      window.setTimeout(() => window.location.reload(), 600);
    } catch (error) {
      notifyError(error, "App cache could not be cleared");
      setClearingCache(false);
    }
  };

  const saveDomains = async () => {
    try {
      updateSettings({
        integrations: {
          ...integrations,
          memberDomain: memberDomain.trim(),
          redeemDomain: redeemDomain.trim(),
        },
      });
      await saveConfiguredSettings();
      toast.success("Domains saved");
    } catch (error) {
      notifyError(error, "Domains could not be saved");
    }
  };

  const dnsInstructions = `Cloudflare DNS
CNAME  member   -> your Pages deployment
CNAME  redeem   -> your Pages deployment

Member signup URL: ${integrations.memberDomain}/join
Voucher redemption URL: ${integrations.redeemDomain}/c/<token>

Both subdomains serve the same build; only the landing path differs.`;

  return (
    <div className="w-full max-w-full space-y-5">
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">Status dashboard</h2>
          <span className="ml-auto text-xs text-muted-foreground">{STATE_LABEL[overall]}</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {checks.map((c) => (
            <div key={c.id} className="rounded-md border border-border px-3 py-2">
              <div className="flex items-center gap-2">
                <span className={cn("size-2 rounded-full", dot[c.state])} />
                <p className="text-sm font-medium">{c.label}</p>
                {c.latency != null && (
                  <span className="numeric ml-auto text-[11px] text-muted-foreground">
                    {c.latency} ms
                  </span>
                )}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">{c.detail}</p>
              {c.url && (
                <a
                  href={c.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block text-[11px] text-primary underline"
                >
                  Open page
                </a>
              )}
              {c.url && c.state === "down" && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Fix: connect this domain in Project settings → Domains, add the CNAME and TXT
                  records it shows at your DNS provider, then wait for verification.
                </p>
              )}
            </div>
          ))}
          {!checks.length && (
            <p className="text-sm text-muted-foreground">Running the first check…</p>
          )}
        </div>
        <Button onClick={diagnose} disabled={busy} variant="outline" size="sm">
          <RefreshCw className={cn("size-4", busy && "animate-spin")} />
          {busy ? "Testing services…" : "Run diagnostics / test connection"}
        </Button>
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2">
          <div className="mr-auto text-[11px] text-muted-foreground">
            {cacheUsage
              ? `Electron profile ${formatBytes(cacheUsage.totalBytes)} · disposable cache ${formatBytes(cacheUsage.cacheBytes)} · diagnostics ${formatBytes(cacheUsage.diagnosticBytes)}`
              : "Browser cache size is managed by the browser; Electron cache size is unavailable here."}
          </div>
          <Button size="sm" variant="outline" onClick={() => void clearCache()} disabled={clearingCache}>
            <Eraser className={cn("size-4", clearingCache && "animate-pulse")} />
            {clearingCache ? "Clearing…" : "Clear app cache & reload"}
          </Button>
        </div>
      </section>

      <UnpairTerminalCard />

      {unhealthy && (
        <section className="space-y-3 rounded-md border border-warning/40 bg-warning/5 p-4">
          <h2 className="text-sm font-semibold">Troubleshooting & recovery</h2>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={forceReconnect}>
              <PlugZap className="size-4" /> Force reconnect
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowErrors((v) => !v)}>
              {showErrors ? "Hide" : "View"} error logs ({errors.length})
            </Button>
          </div>
          {showErrors && (
            <div className="max-h-64 space-y-2 overflow-auto rounded-md border border-border bg-card p-3">
              {errors.map((e) => (
                <div key={e.id} className="text-[11px]">
                  <p className="font-mono">
                    {new Date(e.at).toLocaleString()} · {e.service} · {e.code}
                  </p>
                  <p className="text-muted-foreground">{e.detail}</p>
                </div>
              ))}
              {!errors.length && (
                <p className="text-[11px] text-muted-foreground">No errors recorded.</p>
              )}
              {errors.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    clearHealthErrors();
                    refresh();
                  }}
                >
                  Clear log
                </Button>
              )}
            </div>
          )}
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Subdomains & API configuration</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <DomainSwitch
            label="Member signup subdomain"
            hint="Turns the public /join page on or off."
            flagKey={MEMBER_FLAG}
            enabled={flags.member}
          />
          <DomainSwitch
            label="Voucher redemption subdomain"
            hint="Turns the public claim and voucher pages on or off."
            flagKey={REDEEM_FLAG}
            enabled={flags.redeem}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Member domain</Label>
            <Input value={memberDomain} onChange={(e) => setMemberDomain(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Redeem domain</Label>
            <Input value={redeemDomain} onChange={(e) => setRedeemDomain(e.target.value)} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void saveDomains()}>
            Save domains
          </Button>
          <Button size="sm" variant="outline" onClick={() => setDnsOpen(true)}>
            <ClipboardCopy className="size-4" /> Copy webhook & DNS instructions
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Database key status:{" "}
          {checks.find((c) => c.id === "database")?.state === "ok"
            ? "valid and accepted"
            : "not confirmed — run diagnostics"}
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Operational rules</h2>
        <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
          <div>
            <p className="text-sm font-medium">Stock transfers need approval</p>
            <p className="text-[11px] text-muted-foreground">
              Nothing leaves a branch until a supervisor, warehouse user or admin authorises it.
            </p>
          </div>
          <Switch
            aria-label="Stock transfers need approval"
            checked={integrations.requireTransferApproval}
            onCheckedChange={(v) =>
              updateSettings({ integrations: { ...integrations, requireTransferApproval: v } })
            }
          />
        </div>
      </section>

      <Dialog open={dnsOpen} onOpenChange={setDnsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Webhook & DNS instructions</DialogTitle>
          </DialogHeader>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-surface-2 p-3 text-[11px]">
            {dnsInstructions}
          </pre>
          <Button
            size="sm"
            onClick={() => {
              void navigator.clipboard.writeText(dnsInstructions);
              toast.success("Instructions copied");
            }}
          >
            <Copy className="size-4" /> Copy to clipboard
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
