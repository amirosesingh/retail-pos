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
import { ReceiptPrinterSettings } from "@/platforms/web/components/pos/ReceiptPrinterSettings";
import { TerminalActivation } from "@/platforms/web/components/pos/TerminalActivation";
import { isTerminalApp } from "@/platform-config/platform";
import { readTerminalConfig } from "@/core/activation/terminal-tokens";
import { cloudKeyStatus, subscribeCloudKeys } from "@/lib/secure-cloud-config";
import { boundBranchName } from "@/lib/active-branch";
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
  return (
    <section className="rounded-lg border border-border bg-card">
      <button
        type="button"
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

export function RecoveryHub() {
  const terminalApp = isTerminalApp();
  const [activated, setActivated] = useState<boolean | null>(null);
  const [cloud, setCloud] = useState<boolean | null>(null);
  const [branch, setBranch] = useState<string | null>(null);

  // A terminal that cannot sign anybody in cannot be asked for a supervisor
  // sign-in before it is repaired. Passing the recovery code therefore opens
  // the whole of this screen — connection, activation, local database, branch,
  // branch and hardware. The audit trail, backups and app control are
  // not here: they are not repairs and still need a real administrator.

  useEffect(() => {
    setActivated(Boolean(readTerminalConfig()));
    setBranch(boundBranchName());
    const read = () =>
      void cloudKeyStatus()
        .then((s) => setCloud(Boolean(s.configured)))
        .catch(() => setCloud(false));
    read();
    return subscribeCloudKeys(read);
  }, []);

  return (
    <div className="space-y-3">
      <ModeBanner />

      {terminalApp && (
        <Card
          icon={ShieldCheck}
          title="Terminal activation"
          blurb="Link this machine to a location with an activation code or phone pairing."
          health={activated ? "ok" : "todo"}
          status={activated ? "Activated" : "Not activated"}
          defaultOpen={activated === false}
        >
          <TerminalActivation embedded onActivated={() => window.location.reload()} />
        </Card>
      )}

      <Card
        icon={KeyRound}
        title="Database & cloud connection"
        blurb="Database URL, publishable key and POS backend address for this device."
        health={cloud ? "ok" : "todo"}
        status={cloud === null ? "Checking…" : cloud ? "Configured" : "Missing"}
        defaultOpen={cloud === false}
      >
        <CloudConnectionPanel recoveryUnlocked />
      </Card>

      <Card
        icon={Building2}
        title="Branch binding"
        blurb="Which store or warehouse this terminal books its sales and stock to."
        health={branch ? "ok" : "todo"}
        status={branch ?? "Not bound"}
      >
        <p className="text-sm text-muted-foreground">
          {branch
            ? `This device is bound to ${branch}. The binding comes from the activation code — re-activate above with a code issued for another location to move it.`
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
        <ReceiptPrinterSettings />
      </Card>
    </div>
  );
}
