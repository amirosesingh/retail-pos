/**
 * Emergency Access hub — everything a dead terminal needs to come back to life,
 * on one screen, behind the recovery PIN.
 *
 * A till that was never activated, or lost its database keys, cannot reach
 * Settings: every other screen sits behind activation, sign-in or a live
 * connection. So each of those setup steps is repeated here as its own card,
 * with a live status chip, and nothing on this page needs the network, a
 * signed-in user or a working database.
 */
import { Component, useEffect, useState, type ReactNode } from "react";
import { Building2, ChevronDown, KeyRound, MonitorCog, Server, ShieldCheck } from "lucide-react";

import { CloudConnectionPanel } from "@/platforms/web/components/pos/settings/panels/CloudConnectionPanel";
import { RecoveryPrinterSettings } from "@/platforms/web/components/pos/ReceiptPrinterSettings";
import { TerminalActivation } from "@/platforms/web/components/pos/TerminalActivation";
import { isTerminalApp } from "@/platform-config/platform";
import type { TerminalConfig } from "@/core/activation/terminal-tokens";
import { useRecoveryProfile } from "@/lib/use-recovery-profile";
import type { RecoverySection } from "@/lib/recovery-section";
import { Button } from "@/components/ui/button";
import { TerminalRegistrationDetails } from "@/components/shared/TerminalRegistrationDetails";
import { emergencyMode, useStartupGate } from "@/core/activation/registration-status";

type Health = "ok" | "todo" | "info";

/** One card must never take the whole screen down with it. */
class CardBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return (
        <p className="text-sm text-muted-foreground">
          This setting could not be loaded on this device. The other cards still work.
        </p>
      );
    }
    return this.props.children;
  }
}

function Chip({ health, label }: { health: Health; label: string }) {
  const tone =
    health === "ok"
      ? "border-success/40 bg-success/10 text-success"
      : health === "todo"
        ? "border-warning/40 bg-warning/10 text-warning"
        : "border-border bg-muted text-muted-foreground";
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] ${tone}`}>{label}</span>;
}

function Card({
  icon: Icon,
  title,
  blurb,
  health,
  status,
  defaultOpen,
  children,
}: {
  icon: typeof Server;
  title: string;
  blurb: string;
  health: Health;
  status: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  // The saved profile is asynchronous. Open a requested/missing section once
  // its status arrives, while still allowing the operator to collapse it.
  useEffect(() => { if (defaultOpen) setOpen(true); }, [defaultOpen]);
  return (
    <section className="rounded-lg border border-border bg-card">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 p-4 text-left"
      >
        <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">{title}</span>
            <Chip health={health} label={status} />
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{blurb}</span>
        </span>
        <ChevronDown
          className={`mt-0.5 size-4 shrink-0 text-muted-foreground transition ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="border-t border-border p-4">
          <CardBoundary>{children}</CardBoundary>
        </div>
      )}
    </section>
  );
}

/** The four emergency-access branches, spelled out for the operator. */
function ModeBanner() {
  const gate = useStartupGate();
  if (gate.loading) return null;
  const mode = emergencyMode(gate);
  const copy: Record<string, { tone: string; text: string }> = {
    "online-verified": {
      tone: "border-success/40 bg-success/10 text-success",
      text: "Registered and connected — activation is verified online.",
    },
    "offline-registered": {
      tone: "border-warning/40 bg-warning/10 text-warning",
      text: "Registered offline terminal — durable local operation remains available.",
    },
    "online-unregistered": {
      tone: "border-warning/40 bg-warning/10 text-warning",
      text: "This terminal is not activated. Set the database URL and key below, then activate it.",
    },
    "offline-unregistered": {
      tone: "border-border bg-muted text-muted-foreground",
      text: "Offline emergency mode — limited local functions only. Nothing can be verified until a connection returns.",
    },
  };
  const { tone, text } = copy[mode]!;
  return <div className={`rounded-lg border px-3 py-2 text-xs ${tone}`}>{text}</div>;
}

function ActivationSettings({ config }: { config: TerminalConfig | null }) {
  const [review, setReview] = useState(false);
  return <div className="space-y-3">
    {config && <>
      <p className="text-xs text-muted-foreground">Saved registration on this device. Online validation is separate.</p>
      <TerminalRegistrationDetails details={{
        tokenId: config.tokenId,
        deviceName: config.deviceName,
        locationId: config.locationId,
        locationName: config.deviceUse === "management" && !config.locationId ? "Management" : config.locationName,
        backendUrl: config.backendUrl,
        supabaseUrl: config.supabaseUrl,
      }} />
      {!review && <Button variant="outline" size="sm" onClick={() => setReview(true)}>Review activation options</Button>}
    </>}
    {(!config || review) && <TerminalActivation embedded onActivated={() => window.location.reload()} />}
  </div>;
}

export function RecoveryHub({ section }: { section?: RecoverySection } = {}) {
  const terminalApp = isTerminalApp();
  const profile = useRecoveryProfile();
  const { config, cloud } = profile;
  const ready = !profile.loading && !profile.error;
  const management = config?.deviceUse === "management" && !config.locationId;
  const branch = management ? "Management" : config?.locationName || config?.locationId || null;
  const unread = profile.loading ? "Checking saved settings…" : "Could not read saved settings";

  // A terminal that cannot sign anybody in cannot be asked for a supervisor
  // sign-in before it is repaired. Passing the recovery code therefore opens
  // the whole of this screen — connection, activation, local database, branch,
  // branch and hardware. The audit trail, backups and app control are
  // not here: they are not repairs and still need a real administrator.

  return (
    <div className="space-y-3">
      {ready && <ModeBanner />}
      {!ready && <div role="status" className="space-y-2 rounded-lg border border-border p-3 text-sm">
        <p>{profile.loading ? "Restoring this device's saved registration and connection settings…" : "Saved settings could not be read. They have not been removed. Retry before changing this device's setup."}</p>
        {profile.error && <Button variant="outline" size="sm" onClick={profile.retry}>Retry saved settings</Button>}
      </div>}

      {terminalApp && (
        <Card
          icon={ShieldCheck}
          title="Terminal activation"
          blurb="Link this machine to a location with an activation code or phone pairing."
          health={!ready ? "info" : config ? "ok" : "todo"}
          status={!ready ? unread : config ? "Saved registration" : "Not activated"}
          defaultOpen={section === "activation" || (ready && !config)}
        >
          {ready ? <ActivationSettings config={config} /> : <p className="text-sm text-muted-foreground">{unread}</p>}
        </Card>
      )}

      <Card
        icon={KeyRound}
        title="Database & cloud connection"
        blurb="Database URL, publishable key and POS backend address for this device."
        health={!ready ? "info" : cloud ? "ok" : "todo"}
        status={!ready ? unread : cloud ? "Configured" : "Missing"}
        defaultOpen={section === "connection" || (ready && cloud === false)}
      >
        {ready ? <CloudConnectionPanel recoveryUnlocked /> : <p className="text-sm text-muted-foreground">{unread}</p>}
      </Card>

      <Card
        icon={Building2}
        title="Branch binding"
        blurb="Which store or warehouse this terminal books its sales and stock to."
        health={!ready ? "info" : branch ? "ok" : "todo"}
        status={!ready ? unread : branch ?? "Not bound"}
      >
        <p className="text-sm text-muted-foreground">
          {!ready ? unread : management
            ? "This is a Management terminal. Each user's permissions determine which branches they can access."
            : branch
            ? `This device is bound to ${branch}. Changing its branch requires authorized reassignment and checks for pending transactions.`
            : "No branch is bound yet. Activate this terminal with a code issued for the right location; the binding is applied automatically."}
        </p>
      </Card>

      <Card
        icon={MonitorCog}
        title="Receipt printer & cash drawer"
        blurb="Finish the hardware setup without leaving this screen."
        health="info"
        status="This device only"
      >
        <RecoveryPrinterSettings />
      </Card>
    </div>
  );
}
