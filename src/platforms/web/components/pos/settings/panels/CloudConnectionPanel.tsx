/**
 * Database & Cloud Connection — the ONE place a device's connection details
 * are entered.
 *
 * Three settings live here and nowhere else:
 *   1. Central database URL
 *   2. API key (publishable)
 *   3. POS backend address — the web address of your POS site, used for
 *      cashier sign-in, sync and the secure membership gateway
 *
 * Together they are one connection profile: they are tested together and
 * saved together (`saveConnectionProfile`), so a device can never end up with
 * one customer's address and another customer's key.
 *
 * Storage is unchanged and still platform-sealed: Windows keeps the pair in
 * the OS vault (DPAPI via safeStorage), Android in the Keystore
 * (EncryptedSharedPreferences); the backend address, which is not a secret,
 * goes to the shell's own configuration store.
 *
 * On the web build the deployment supplies the database values through its
 * hosting variables, so the panel shows them read-only.
 */
import { useCallback, useEffect, useState } from "react";
import {
  CloudCog,
  Loader2,
  Lock,
  PlugZap,
  Server,
  ShieldCheck,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isTerminalApp } from "@/platform-config/platform";
import { useAuthOptional } from "@/lib/pos-auth";
import {
  cloudKeyStatus,
  connectionProfile,
  removeCloudCredentials,
  saveConnectionProfile,
  subscribeCloudKeys,
  testConnectionProfile,
  type CloudKeyStatus,
  type CloudProbe,
} from "@/lib/secure-cloud-config";
import { type BackendTestResult } from "@/lib/backend-config";
import { publicSupabaseConfig } from "@/lib/external-supabase-config";

function keyHint(value: string): string {
  if (!value) return "";
  return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : "configured";
}

export function CloudConnectionPanel({
  onConnected,
  presentation = "panel",
  recoveryUnlocked = false,
}: {
  onConnected?: () => void | Promise<void>;
  presentation?: "panel" | "dialog";
  /** The parent EmergencyPinGate has opened Electron's short repair session. */
  recoveryUnlocked?: boolean;
} = {}) {
  const auth = useAuthOptional();
  const [status, setStatus] = useState<CloudKeyStatus | null>(null);
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [savedBackend, setSavedBackend] = useState("");
  const [backend, setBackend] = useState("");
  const [cloudResult, setCloudResult] = useState<CloudProbe | null>(null);
  const [backendResult, setBackendResult] = useState<BackendTestResult | null>(null);
  const [busy, setBusy] = useState<"test" | "save" | "remove" | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [configurationOpen, setConfigurationOpen] = useState(false);

  const refresh = useCallback(async () => {
    const [next, profile] = await Promise.all([cloudKeyStatus(), connectionProfile()]);
    setStatus(next);
    // Read the same complete profile that saveConnectionProfile() writes.
    // This keeps the visible backend field tied to the exact persisted value
    // used by server-origin.ts instead of maintaining a second UI-only source.
    if (profile.supabaseUrl) setUrl((current) => current || profile.supabaseUrl);
    setSavedBackend(profile.backendUrl);
    setBackend((value) => value || profile.backendUrl);
  }, []);

  useEffect(() => {
    void refresh();
    return subscribeCloudKeys(() => void refresh());
  }, [refresh]);

  const terminal = isTerminalApp();

  const present = (
    content: React.ReactNode,
    summary: string,
    configured: boolean,
    detail?: string,
  ) => {
    if (presentation === "panel") return content;
    return (
      <>
        <section className="rounded-lg border border-border bg-card p-4">
          <header className="flex items-center gap-2">
            <CloudCog className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Database &amp; Cloud Connection</h2>
          </header>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p
                className={`flex items-center gap-2 text-sm ${
                  configured ? "text-success" : "text-destructive"
                }`}
              >
                {configured ? (
                  <ShieldCheck className="size-4 shrink-0" />
                ) : (
                  <ShieldAlert className="size-4 shrink-0" />
                )}
                {summary}
              </p>
              {detail ? <p className="mt-1 text-xs text-muted-foreground">{detail}</p> : null}
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setConfigurationOpen(true)}
            >
              <CloudCog className="size-4" />
              {terminal ? "Configure connection" : "View connection details"}
            </Button>
          </div>
        </section>
        <Dialog open={configurationOpen} onOpenChange={setConfigurationOpen}>
          <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Database &amp; Cloud Connection</DialogTitle>
              <DialogDescription>
                {terminal
                  ? "Test and save the central database, publishable key, and company POS domain as one connection profile. Membership credentials remain on that server."
                  : "Review the cloud connection supplied by this website’s hosting environment."}
              </DialogDescription>
            </DialogHeader>
            {content}
          </DialogContent>
        </Dialog>
      </>
    );
  };

  // Web build: the deployment carries its own publishable config, so the
  // values are shown for confirmation but cannot be typed over here.
  if (!terminal) {
    const membership = publicSupabaseConfig("membership");
    const content = (
      <section
        className={
          presentation === "dialog"
            ? "space-y-3"
            : "space-y-3 rounded-lg border border-border bg-card p-4"
        }
      >
        {presentation === "panel" ? (
          <header className="flex items-center gap-2">
            <CloudCog className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Database &amp; Cloud Connection</h2>
          </header>
        ) : null}
        <p
          className={`flex items-center gap-2 text-sm ${
            status?.configured ? "text-success" : "text-destructive"
          }`}
        >
          {status?.configured ? (
            <ShieldCheck className="size-4" />
          ) : (
            <ShieldAlert className="size-4" />
          )}
          {status?.configured
            ? `This website is connected to ${status.url}`
            : "Not configured — set the database address and publishable key in this site's hosting variables."}
        </p>
        <p className="text-xs text-muted-foreground">
          On the website these two values come from the hosting environment, and the site is its own
          backend, so there is nothing to enter here. On a Windows till or an Android terminal this
          same screen is where all three connection settings are typed in once.
        </p>
        <div className="space-y-3 border-t border-border pt-4">
          <div>
            <h3 className="text-sm font-semibold">Public membership project</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Add these values in Cloudflare Workers → Settings → Variables &amp; Secrets. They are
              deployment settings, not member-login details and not fields on the public join page.
            </p>
          </div>
          <dl className="grid gap-2 text-xs sm:grid-cols-2">
            <div className="rounded-md border border-border p-3">
              <dt className="font-medium">Project URL</dt>
              <dd className="mt-1 break-all text-muted-foreground">
                {membership?.url ?? "Missing — MEMBERSHIP_SUPABASE_URL"}
              </dd>
            </div>
            <div className="rounded-md border border-border p-3">
              <dt className="font-medium">Publishable key</dt>
              <dd className="mt-1 break-all text-muted-foreground">
                {membership?.key
                  ? `Configured (${keyHint(membership.key)})`
                  : "Missing — MEMBERSHIP_SUPABASE_PUBLISHABLE_KEY"}
              </dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">
            The membership backend&apos;s private credential belongs only in encrypted hosting
            secrets. It is intentionally never shown, stored, or accepted in the browser, Windows
            app, Android app, or public membership form.
          </p>
        </div>
      </section>
    );
    return present(
      content,
      status?.configured ? "Central database configured" : "Central database not configured",
      Boolean(status?.configured),
      status?.configured ? `Connected to ${status.url}` : "Hosting configuration is required.",
    );
  }

  // An unconfigured terminal has nothing to protect and nobody to sign in as:
  // first-run setup is open. Once a connection exists, the same granular
  // permission that opens Database Connection controls whether it can change.
  const firstRun = !status?.configured;
  const privileged = Boolean(auth?.isAdmin || auth?.can("can_manage_sync_backup"));
  const editable = firstRun || privileged || unlocked || recoveryUnlocked;

  // An empty key box means "keep the key already sealed on this device", so
  // changing only the backend address never asks for the key again.
  const candidate = () => ({
    supabaseUrl: url,
    supabaseKey: key.trim() ? key : null,
    backendUrl: backend,
  });

  /** Probes what is typed. Writes nothing: the working profile stays in force. */
  const testAll = async () => {
    setBusy("test");
    try {
      const res = await testConnectionProfile(candidate());
      setCloudResult(res.cloud);
      if (res.cloud.stage === "ok") toast.success(`Central database: ${res.cloud.detail}`);
      else if (res.cloud.stage === "no-schema")
        toast.warning(`Central database: ${res.cloud.detail}`);
      else toast.error(`Central database: ${res.cloud.detail}`);

      setBackendResult(res.backend);
      if (res.backend.url) setBackend(res.backend.url);
      if (res.backend.ok) toast.success(`POS backend: ${res.backend.detail}`);
      else if (res.backend.warn) toast.warning(`POS backend: ${res.backend.detail}`);
      else toast.error(`POS backend: ${res.backend.detail}`);
    } finally {
      setBusy(null);
    }
  };

  /** Test → commit → activate → reconnect. Only then is success reported. */
  const saveAll = async () => {
    setBusy("save");
    try {
      const res = await saveConnectionProfile(candidate());
      if (res.cloud) setCloudResult(res.cloud);
      if (res.backend) setBackendResult(res.backend);
      if (res.ok) {
        setKey("");
        toast.success(`${res.detail} Saved ✓ Activated ✓ Connected ✓`);
        await refresh();
        await onConnected?.();
        if (presentation === "dialog") setConfigurationOpen(false);
      } else {
        toast.error(
          res.stage === "save"
            ? `${res.detail} The previous connection is still in use.`
            : res.detail,
        );
      }
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("remove");
    try {
      const res = await removeCloudCredentials();
      if (res.ok) {
        setKey("");
        toast.success("Cloud keys removed — this device keeps trading locally");
        await refresh();
      } else {
        toast.error(res.error ?? "Could not remove the credentials");
      }
    } finally {
      setBusy(null);
    }
  };

  // A saved key counts as supplied: the operator only retypes it to replace it.
  const haveKey = key.trim().length > 0 || Boolean(status?.configured);
  const complete = url.trim().length > 0 && haveKey && backend.trim().length > 0;
  const canTest = editable && complete && busy === null;
  const canSave = editable && complete && busy === null;

  const content = (
    <section
      className={
        presentation === "dialog"
          ? "space-y-4"
          : "space-y-4 rounded-lg border border-border bg-card p-4"
      }
    >
      {presentation === "panel" ? (
        <header className="flex items-center gap-2">
          <CloudCog className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Database &amp; Cloud Connection</h2>
        </header>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Everything this device needs to reach your company is entered here, once. Changing it points
        the terminal at a different company, so it is tested before it is saved and the three values
        are always stored together.
      </p>

      <p
        className={`flex items-center gap-2 text-sm ${
          status?.configured ? "text-success" : "text-destructive"
        }`}
      >
        {status?.configured ? (
          <ShieldCheck className="size-4" />
        ) : (
          <ShieldAlert className="size-4" />
        )}
        {status?.configured
          ? `Connected to ${status.url} (key ${status.keyHint})${status.encrypted ? " — sealed with this device's secure storage" : ""}`
          : "Not configured — the device trades fully offline. Save the central database URL, API key and backend address to connect it."}
      </p>

      {!editable && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <Lock className="size-4" />
          <span>
            This terminal is already connected. Database-management permission is required to change
            where it reads and writes.
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setUnlocked(true)}
            disabled={!privileged}
          >
            {privileged ? "Unlock to change" : "Ask an administrator for database access"}
          </Button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="cloud-url">Central database URL</Label>
          <Input
            id="cloud-url"
            type="url"
            autoComplete="off"
            disabled={!editable}
            placeholder="https://your-project.supabase.co"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cloud-key">API key (publishable)</Label>
          <Input
            id="cloud-key"
            type="password"
            autoComplete="off"
            disabled={!editable}
            placeholder={
              status?.configured
                ? `Saved (${status.keyHint}) — leave blank to keep it`
                : "sb_publishable_…"
            }
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Both values come from the central project&apos;s API settings. They are encrypted with this
        device&apos;s hardware-backed storage and decrypted only in memory while sync runs. The key
        is never displayed again after saving.
      </p>

      {cloudResult && (
        <div className="space-y-0.5 text-xs">
          <p className={cloudResult.reachable ? "text-success" : "text-destructive"}>
            {cloudResult.reachable ? "✓" : "✕"} Address reachable
          </p>
          <p className={cloudResult.authenticated ? "text-success" : "text-destructive"}>
            {cloudResult.authenticated ? "✓" : "✕"} API key accepted
          </p>
          <p className={cloudResult.schemaReady ? "text-success" : "text-amber-600"}>
            {cloudResult.schemaReady ? "✓" : "!"} POS tables provisioned
          </p>
          <p className="text-muted-foreground">{cloudResult.detail}</p>
        </div>
      )}

      <div className="space-y-1 border-t border-border pt-4">
        <Label htmlFor="backend-url" className="flex items-center gap-2">
          <Server className="size-4 text-muted-foreground" />
          POS backend / website address
        </Label>
        <Input
          id="backend-url"
          type="url"
          autoComplete="off"
          disabled={!editable}
          placeholder="https://pos.example.com"
          value={backend}
          onChange={(e) => setBackend(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          {savedBackend
            ? `Sign-in and sync are sent to ${savedBackend}.`
            : "Not configured — this device cannot reach the POS backend for sign-in or sync."}{" "}
          Enter the company web address you open the POS on, for example{" "}
          <code>https://pos.example.com</code>. This is <strong>not</strong> the database address:
          the till performs a secure terminal handshake with your POS site. That server talks to
          both database projects with credentials that never reach Electron. Do not enter the
          membership project ID or service key on this PC.
        </p>
        {backendResult && (
          <p
            className={`text-xs ${
              backendResult.ok
                ? "text-success"
                : backendResult.warn
                  ? "text-amber-600"
                  : "text-destructive"
            }`}
          >
            {backendResult.ok ? "✓" : backendResult.warn ? "!" : "✕"} {backendResult.detail}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void testAll()} disabled={!canTest}>
          {busy === "test" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <PlugZap className="size-4" />
          )}
          Test connection
        </Button>
        <Button onClick={() => void saveAll()} disabled={!canSave}>
          {busy === "save" && <Loader2 className="size-4 animate-spin" />}
          Save &amp; connect
        </Button>
        {status?.configured && (
          <Button
            variant="ghost"
            onClick={() => void remove()}
            disabled={busy !== null || !editable}
          >
            {busy === "remove" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
            Remove saved connection
          </Button>
        )}
      </div>
    </section>
  );
  return present(
    content,
    status?.configured ? "Central database configured" : "Central database not configured",
    Boolean(status?.configured),
    status?.configured
      ? `${status.url}${savedBackend ? " • POS backend configured" : " • POS backend missing"}`
      : savedBackend
        ? "POS backend saved; central database details are still required."
        : "This terminal continues in offline mode until a connection profile is saved.",
  );
}
