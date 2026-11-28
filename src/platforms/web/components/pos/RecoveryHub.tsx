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
import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Building2, ChevronDown, KeyRound, MonitorCog, Server, ShieldCheck } from "lucide-react";

import { CloudConnectionPanel } from "@/platforms/web/components/pos/settings/panels/CloudConnectionPanel";
import { RecoveryPrinterSettings } from "@/platforms/web/components/pos/ReceiptPrinterSettings";
import { TerminalActivation } from "@/platforms/web/components/pos/TerminalActivation";
import { isTerminalApp } from "@/platform-config/platform";
import { ActivationError, retainedTerminalRecoveryEvidence, type TerminalConfig } from "@/core/activation/terminal-tokens";
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
      text: "The last connection check did not reach the central database. You can try your activation token or review the connection settings.",
    },
  };
  const { tone, text } = copy[mode]!;
  return <div className={`rounded-lg border px-3 py-2 text-xs ${tone}`}>{text}</div>;
}

const repairMessages: Record<string, string> = {
  EACTIVATION_REPAIR_DATABASE: "Connect this terminal's saved local SQL database so its pending transactions can be checked, then check again.",
  EACTIVATION_REPAIR_DATABASE_UNKNOWN: "The saved local SQL connection could not be verified. You can continue with the saved online database while previous local work remains preserved for recovery.",
  EACTIVATION_REPAIR_PENDING: "Previous local transactions still need synchronization or review. They must be resolved before changing registration.",
  EACTIVATION_REPAIR_STORE: "Windows could not read this device's previous registration. Keep the saved setup and retry its recovery.",
  EACTIVATION_REPAIR_EXISTING: "This device's saved registration is available again. Retry saved registration before changing it.",
  EACTIVATION_REPAIR_CONTEXT: "The registration or connection changed during the check. Review this device's current settings and check again.",
  EPRIVILEGE: "Emergency Access authorization has expired. Open Emergency Access again and verify the administrator before repairing registration.",
  EAPP_CLOSING: "Registration repair paused while the app closes. Reopen the app and try again.",
  EACTIVATION_REPAIR_ONLINE_BUSY: "Local work is still running. Let it finish, then retry continuing online.",
  EACTIVATION_REPAIR_ONLINE_CONFIG: "The saved online connection is not ready. Review Database & cloud connection, then retry continuing online.",
  EACTIVATION_REPAIR_ONLINE_STORE: "The previous local setup could not be preserved safely. Keep it unchanged and retry continuing online.",
  EACTIVATION_REPAIR_ONLINE_TARGET: "This online recovery already has a replacement registration. Retry the same activation code or retry saved registration.",
  EACTIVATION_REPAIR_ONLINE_LIMIT: "The preserved recovery history needs review before another registration. All previous setups have been kept.",
  EACTIVATION_REPAIR_CURRENT_LOCAL: "This registration has a current local database. Keep its saved work and verify its recovery before changing registration again.",
};
const repairFailure = (code?: string) => repairMessages[code ?? ""] ?? "The previous local setup could not be checked. Keep it unchanged and retry the check.";
const repairableRegistration = (code: string | null) => [
  "EACTIVATION_RECOVERY_BINDING", "EACTIVATION_RECOVERY_PROOF", "EACTIVATION_RECOVERY_VERIFY", "EACTIVATION_RECOVERY_PROJECT",
].includes(code ?? "");

function ActivationSettings({ config, connectionReady = true, registrationReady = true, registrationCode = null, registrationFailure = "" }: {
  config: TerminalConfig | null;
  connectionReady?: boolean;
  registrationReady?: boolean;
  registrationCode?: string | null;
  registrationFailure?: string;
}) {
  const [mode, setMode] = useState<"overview" | "review" | "activating">("overview");
  const [repairChosen, setRepairChosen] = useState(false);
  const [repairReady, setRepairReady] = useState(false);
  const [repairBusy, setRepairBusy] = useState(false);
  const [repairMessage, setRepairMessage] = useState("");
  const [needsDatabase, setNeedsDatabase] = useState(false);
  const [canContinueOnline, setCanContinueOnline] = useState(false);
  const [localRecoveryPending, setLocalRecoveryPending] = useState(false);
  const repairContext = useRef(0);
  const repairRequest = useRef(0);
  const mounted = useRef(false);
  const canOfferRepair = connectionReady && !registrationReady && repairableRegistration(registrationCode)
    && typeof window !== "undefined" && Boolean(window.pos?.terminalRepairStatus);
  useEffect(() => {
    mounted.current = true;
    const context = ++repairContext.current;
    setRepairBusy(false);
    if (!registrationReady) {
      setRepairReady(false);
      setMode("overview");
    }
    return () => { mounted.current = false; repairContext.current = context + 1; };
  }, [connectionReady, registrationCode, registrationReady]);
  const checkRepair = useCallback(async (connectDatabase = false, continueOnline = false) => {
    const context = repairContext.current;
    const request = ++repairRequest.current;
    const current = () => mounted.current && context === repairContext.current && request === repairRequest.current;
    setRepairBusy(true);
    try {
      const result = continueOnline
        ? await window.pos?.terminalRepairContinueOnline?.(retainedTerminalRecoveryEvidence())
        : connectDatabase
        ? await window.pos?.terminalRepairConnectDatabase?.()
        : await window.pos?.terminalRepairStatus?.();
      if (!current()) throw new ActivationError(repairFailure("EACTIVATION_REPAIR_CONTEXT"));
      if (result?.ok && result.ready === true) {
        setNeedsDatabase(false);
        setCanContinueOnline(false);
        setLocalRecoveryPending(result.localRecoveryPending === true);
        setRepairMessage("");
        setRepairReady(true);
        setMode("activating");
        return;
      }
      setNeedsDatabase(result?.code === "EACTIVATION_REPAIR_DATABASE" && result.requiresLocalDatabase === true);
      setCanContinueOnline(["EACTIVATION_REPAIR_DATABASE", "EACTIVATION_REPAIR_DATABASE_UNKNOWN", "EACTIVATION_REPAIR_CHECK", "EACTIVATION_REPAIR_CONTEXT", "EACTIVATION_REPAIR_ONLINE_TARGET", "EACTIVATION_REPAIR_ONLINE_BUSY", "EACTIVATION_REPAIR_ONLINE_CONFIG", "EACTIVATION_REPAIR_ONLINE_STORE"].includes(result?.code ?? ""));
      const message = repairFailure(result?.code);
      setRepairMessage(message);
      setRepairReady(false);
      throw new ActivationError(message);
    } catch (cause) {
      if (cause instanceof ActivationError) throw cause;
      if (!current()) throw new ActivationError(repairFailure("EACTIVATION_REPAIR_CONTEXT"));
      const message = repairFailure();
      setRepairMessage(message);
      setRepairReady(false);
      throw new ActivationError(message);
    } finally {
      if (current()) setRepairBusy(false);
    }
  }, []);
  const keepActivationOpen = useCallback(() => {
    // Saving the first registration refreshes config before the form can
    // show its confirmation. Keep that form open until the operator continues.
    setMode((current) => current === "overview" ? "activating" : current);
  }, []);
  if (!connectionReady || (!registrationReady && !repairReady)) return <div className="space-y-3">
    <p className="text-sm text-muted-foreground">{registrationFailure}</p>
    {canOfferRepair && <>
      {!repairChosen ? <Button variant="outline" size="sm" onClick={() => setRepairChosen(true)}>Repair or re-register terminal</Button> : <>
        <p className="text-sm text-muted-foreground">If retrying the saved registration cannot restore it, you can use a new activation code. Check the saved local database first, or explicitly continue with the saved online database while previous local work is preserved for recovery. Your saved setup is kept until a new registration is verified and saved.</p>
        {repairMessage && <p role="alert" className="text-sm text-destructive">{repairMessage}</p>}
        {needsDatabase && <Button variant="outline" size="sm" disabled={repairBusy} onClick={() => { void checkRepair(true).catch(() => {}); }}>Connect saved local database</Button>}
        {canContinueOnline && window.pos?.terminalRepairContinueOnline && <Button variant="outline" size="sm" disabled={repairBusy} onClick={() => { void checkRepair(false, true).catch(() => {}); }}>Continue online and re-register</Button>}
        <Button size="sm" disabled={repairBusy} onClick={() => { void checkRepair().catch(() => {}); }}>{repairBusy ? "Checking previous setup…" : "Check before re-registering"}</Button>
      </>}
    </>}
  </div>;
  return <div className="space-y-3">
    {localRecoveryPending && <p role="status" className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">Using the saved online database. Previous local work is preserved and still needs recovery; it has not been marked synchronized. Local SQL remains held apart from this registration.</p>}
    {config && mode !== "activating" && <>
      <p className="text-xs text-muted-foreground">Saved registration on this device. Online validation is separate.</p>
      <TerminalRegistrationDetails details={{
        tokenId: config.tokenId,
        deviceName: config.deviceName,
        locationId: config.locationId,
        locationName: config.deviceUse === "management" && !config.locationId ? "Management" : config.locationName,
        backendUrl: config.backendUrl,
        supabaseUrl: config.supabaseUrl,
      }} />
      {mode === "overview" && <Button variant="outline" size="sm" onClick={() => setMode("review")}>Review activation options</Button>}
    </>}
    {(!config || mode !== "overview") && <TerminalActivation
      embedded
      beforeActivation={repairChosen ? checkRepair : undefined}
      onActivationStarted={keepActivationOpen}
      onActivated={() => window.location.assign("/")}
    />}
  </div>;
}

export function RecoveryHub({ section }: { section?: RecoverySection } = {}) {
  const terminalApp = isTerminalApp();
  const profile = useRecoveryProfile();
  const { config, cloud } = profile;
  const connectionReady = !profile.loading && profile.connectionReady;
  const registrationReady = !profile.loading && profile.registrationReady;
  const ready = connectionReady && registrationReady;
  const management = config?.deviceUse === "management" && !config.locationId;
  const branch = management ? "Management" : config?.locationName || config?.locationId || null;
  const unread = profile.loading ? "Checking saved settings…" : "Could not read saved settings";
  const registrationFailure = profile.registrationMessage ?? "Saved registration has not been verified yet. Retry its recovery before changing activation.";

  // A terminal that cannot sign anybody in cannot be asked for a supervisor
  // sign-in before it is repaired. Passing the recovery code therefore opens
  // the whole of this screen — connection, activation, local database, branch,
  // branch and hardware. The audit trail, backups and app control are
  // not here: they are not repairs and still need a real administrator.

  return (
    <div className="space-y-3">
      {ready && <ModeBanner />}
      {!ready && <div role="status" className="space-y-2 rounded-lg border border-border p-3 text-sm">
        <p>{profile.loading ? "Restoring this device's saved registration and connection settings…" : connectionReady
          ? "Your saved connection settings are available below. The saved terminal registration still needs recovery; it has not been removed."
          : "Saved settings could not be read. They have not been removed. Retry before changing this device's setup."}</p>
        {!profile.loading && connectionReady && profile.registrationMessage && <p>{profile.registrationMessage}</p>}
        {profile.error && <Button variant="outline" size="sm" onClick={profile.retry}>{connectionReady ? "Retry saved registration" : "Retry saved settings"}</Button>}
      </div>}

      {terminalApp && (
        <Card
          icon={ShieldCheck}
          title="Terminal activation"
          blurb="Link this machine to a location with an activation code or phone pairing."
          health={!registrationReady ? "info" : config ? "ok" : "todo"}
          status={!registrationReady ? "Registration recovery pending" : config ? "Saved registration" : "Not activated"}
          defaultOpen={section === "activation" || (registrationReady && !config)}
        >
          <ActivationSettings config={config} connectionReady={connectionReady} registrationReady={registrationReady} registrationCode={profile.registrationCode} registrationFailure={registrationFailure} />
        </Card>
      )}

      <Card
        icon={KeyRound}
        title="Database & cloud connection"
        blurb="Database URL, publishable key and POS backend address for this device."
        health={!connectionReady ? "info" : cloud ? "ok" : "todo"}
        status={!connectionReady ? unread : cloud ? "Configured" : "Missing"}
        defaultOpen={section === "connection" || (connectionReady && cloud === false)}
      >
        {connectionReady ? <CloudConnectionPanel recoveryUnlocked /> : <p className="text-sm text-muted-foreground">{unread}</p>}
      </Card>

      <Card
        icon={Building2}
        title="Branch binding"
        blurb="Which store or warehouse this terminal books its sales and stock to."
        health={!registrationReady ? "info" : branch ? "ok" : "todo"}
        status={!registrationReady ? "Registration recovery pending" : branch ?? "Not bound"}
      >
        <p className="text-sm text-muted-foreground">
          {!registrationReady ? "The saved registration must be restored before its branch binding can be shown." : management
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
