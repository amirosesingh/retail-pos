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
import { isWindowsShell } from "@/platform-config/features";
import { useSystemStatus } from "@/lib/system-status";
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
  const system = useSystemStatus();
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
                  ? "Enter the database details and POS website address. Test before saving."
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
            ? "Central database configured"
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
          <p className={`flex items-center gap-2 text-sm ${membership?.url && membership?.key ? "text-success" : "text-muted-foreground"}`}>
            {membership?.url && membership?.key ? <ShieldCheck className="size-4 shrink-0" /> : <ShieldAlert className="size-4 shrink-0" />}
            {membership?.url && membership?.key ? "Membership database configured" : "Membership database not configured"}
          </p>
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
      status?.configured ? "Connection settings are managed by hosting." : "Hosting configuration is required.",
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
          ? "min-w-0 space-y-3"
          : "min-w-0 space-y-3 rounded-lg border border-border bg-card p-3 sm:p-4"
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
          status?.configured ? "text-success" : "text-muted-foreground"
        }`}
      >
        {status?.configured ? (
          <ShieldCheck className="size-4 shrink-0" />
        ) : (
          <ShieldAlert className="size-4 shrink-0" />
        )}
        {status?.configured
          ? "Database configured"
          : "Database not configured"}
      </p>

      {isWindowsShell() ? <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
        <span className="font-medium">Saving to central database</span>
        <span className="ml-2 text-muted-foreground">Writes save to local SQL Server first; {system.pending ? `${system.pending} record${system.pending === 1 ? "" : "s"} waiting to upload` : system.syncing ? "synchronizing now" : "no uploads pending"}.</span>
      </div> : null}

      {!editable && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <Lock className="size-4 shrink-0" />
          <span>
            Database-management permission is required to edit this connection.
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
                ? "Saved securely — leave blank to keep it"
                : "sb_publishable_…"
            }
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Use a publishable key, never a service key. Saved details stay secure on this device.
      </p>

      {cloudResult && (
        <div className="space-y-0.5 break-words text-xs [overflow-wrap:anywhere]">
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
          {savedBackend ? "POS address configured." : "Use your company POS website address."}
        </p>
        {backendResult && (
          <p
            className={`break-words text-xs [overflow-wrap:anywhere] ${
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

      <div className="flex flex-wrap gap-2 [&>button]:min-h-10 [&>button]:flex-1 sm:[&>button]:flex-none">
        <Button variant="outline" onClick={() => void testAll()} disabled={!canTest}>
          {busy === "test" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <PlugZap className="size-4 shrink-0" />
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
              <Trash2 className="size-4 shrink-0" />
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
      ? savedBackend ? "Database and POS address saved." : "POS address missing."
      : savedBackend
        ? "POS backend saved; central database details are still required."
        : "Enter the database details and POS website address.",
  );
}
