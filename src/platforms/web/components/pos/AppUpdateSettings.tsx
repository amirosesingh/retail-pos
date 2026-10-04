import {
  CheckCircle2,
  ClipboardCopy,
  DownloadCloud,
  Globe,
  Loader2,
  Monitor,
  PlugZap,
  RefreshCw,
  Smartphone,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { APP_VERSION, useAppUpdates } from "@/lib/app-updates";
import { useAndroidUpdates } from "@/platforms/mobile/android-updates";
import { isAndroid, isNative } from "@/platform-config/platform";
import { MANIFEST_URL } from "@/lib/update-manifest";
import { usePos } from "@/lib/pos-store";

/* ── One UI style tiles ──────────────────────────────────────────────── */

export function TileGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      {title && (
        <h3 className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
      )}
      <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {children}
      </div>
    </section>
  );
}

export function TileRow({
  label,
  value,
  hint,
  icon,
  children,
}: {
  label: string;
  value?: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-[56px] items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50">
      {icon && <span className="shrink-0 text-primary">{icon}</span>}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
        {children}
      </div>
      {value !== undefined && (
        <div className="shrink-0 text-right text-sm text-muted-foreground">{value}</div>
      )}
    </div>
  );
}

/* ── Update centre ───────────────────────────────────────────────────── */

const LABELS: Record<string, string> = {
  idle: "Not checked yet",
  checking: "Checking for updates…",
  available: "A newer version is available",
  current: "You are on the latest version",
  downloading: "Downloading update…",
  ready: "Update ready — restart to install",
  error: "Update check failed",
  unavailable: "This build installs updates from the web server",
};

/**
 * One update card for every platform. All three shells read the same
 * self-hosted manifest; only the install action differs.
 */
export function AppUpdateSettings() {
  const [platform, setPlatform] = useState<"web" | "android" | "windows">("web");

  useEffect(() => {
    setPlatform(isNative() && isAndroid() ? "android" : "web");
  }, []);

  if (platform === "android") return <AndroidUpdateCard />;
  return <DesktopUpdateCard />;
}

/** Plain words for the point where an update gave up. */
const STAGE_LABELS: Record<string, string> = {
  check: "Could not reach the update folder",
  download: "The download did not finish",
  verify: "The downloaded file failed its safety check",
  install: "The installer could not start",
};

function DesktopUpdateCard() {
  const {
    state,
    supported,
    check,
    download,
    downloadAndInstall,
    install,
    lastChecked,
    manifestChecking,
    manifestVersion,
    manifestNewer,
    releaseNotes,
    downloadUrl,
    diagnose,
    diagnosing,
    diagnosis,
    failureReport,
  } = useAppUpdates();
  const { activeShift } = usePos();
  const [copied, setCopied] = useState(false);

  const version = state.version || APP_VERSION;
  const busy = manifestChecking || state.status === "checking" || state.status === "downloading";

  const status = manifestChecking
    ? LABELS["checking"]
    : supported
      ? (LABELS[state.status] ?? state.status)
      : manifestNewer
        ? "A newer version is published"
        : manifestVersion
          ? LABELS["current"]
          : LABELS["unavailable"];

  return (
    <div className="space-y-4">
      <TileGroup title="Version">
        <TileRow
          icon={supported ? <Monitor className="size-4" /> : <Globe className="size-4" />}
          label="Installed version"
          hint={supported ? "Windows till" : "Browser build"}
          value={<span className="numeric font-semibold text-foreground">v{version}</span>}
        />
        <TileRow
          label="Latest published"
          hint="From the update server"
          value={
            <span className="numeric font-semibold text-foreground">
              {manifestVersion ? `v${manifestVersion}` : "—"}
            </span>
          }
        />
        <TileRow label="Update source" hint={MANIFEST_URL} />
      </TileGroup>

      <TileGroup title="Status">
        <TileRow
          icon={
            busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : manifestNewer || state.available ? (
              <DownloadCloud className="size-4" />
            ) : (
              <CheckCircle2 className="size-4" />
            )
          }
          label={status}
          hint={lastChecked ? `Last checked ${lastChecked.toLocaleString()}` : "Not checked yet"}
          value={
            state.available && state.status !== "current" ? (
              <span className="numeric text-primary">→ v{state.available}</span>
            ) : undefined
          }
        />
        {state.status === "downloading" && (
          <div className="px-4 py-3">
            <Progress value={state.percent} className="h-2" aria-label="Update download progress" />
          </div>
        )}
        {releaseNotes && (
          <TileRow label="Release notes" hint={releaseNotes} />
        )}
        {state.error && (
          <>
            <TileRow
              label={STAGE_LABELS[state.stage ?? ""] ?? "Last error"}
              hint={<span className="text-destructive">{state.error}</span>}
            />
            {(state.url || state.code || state.detail) && (
              <TileRow
                label="Details"
                hint={
                  <span className="break-all">
                    {[state.url, state.code, state.detail].filter(Boolean).join(" · ")}
                  </span>
                }
              />
            )}
          </>
        )}
        {diagnosis && (
          <TileRow
            label={diagnosis.ok ? "Connection test passed" : "Connection test failed"}
            hint={
              <span className="space-y-1">
                {diagnosis.checks.map((c) => (
                  <span key={c.url} className="block break-all">
                    {c.ok ? "OK" : "Failed"} · {c.url}
                    {c.status ? ` · HTTP ${c.status}` : ""}
                    {c.error ? ` · ${c.error}` : ""}
                  </span>
                ))}
              </span>
            }
          />
        )}
      </TileGroup>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          className="touch-target"
          disabled={busy}
          onClick={() => void check()}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Check for updates now
        </Button>
        {supported && state.status === "ready" && (
          <Button className="touch-target" onClick={() => void install()}>
            Restart and install
          </Button>
        )}
        {supported && state.status === "available" && (
          <>
            <Button
              variant="outline"
              className="touch-target"
              onClick={() => void download()}
            >
              Download only
            </Button>
            <Button
              className="touch-target"
              disabled={!!activeShift}
              title={activeShift ? "Close the active shift before installing an update" : undefined}
              onClick={() => void downloadAndInstall()}
            >
              Download and install
            </Button>
          </>
        )}
        {supported && (
          <Button
            variant="outline"
            className="touch-target"
            disabled={diagnosing}
            onClick={() => void diagnose()}
          >
            {diagnosing ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
            Test connection
          </Button>
        )}
        {failureReport && (
          <Button
            variant="outline"
            className="touch-target"
            onClick={() => {
              void navigator.clipboard?.writeText(failureReport);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            }}
          >
            <ClipboardCopy className="size-4" />
            {copied ? "Copied" : "Copy details"}
          </Button>
        )}
        {downloadUrl && (
          <Button
            variant={supported ? "outline" : "default"}
            asChild
            className="touch-target"
          >
            <a href={downloadUrl} target="_blank" rel="noreferrer">
              {supported ? "Download in browser" : `Download v${manifestVersion}`}
            </a>
          </Button>
        )}
      </div>


      <p className="px-1 text-xs text-muted-foreground">
        {supported
          ? activeShift
            ? "Download-only is available now. Installation stays blocked until the active shift is closed, so trading is not interrupted."
            : "Choose download-only to stage the verified installer, or download and install to restart now. Terminal registration and the local database are kept."
          : "The browser build always serves the newest files. Downloads here are for the Windows till installer."}
      </p>
    </div>
  );
}

/** Android till: signed APK updates from the configured server, no store involved. */
function AndroidUpdateCard() {
  const { state, available, check, install, installDownloaded } = useAndroidUpdates();

  const status = state.checking
    ? "Checking for updates…"
    : state.downloading
      ? `Downloading update… ${state.percent}%`
      : available
        ? "Update ready to install"
        : state.latest
          ? "You are on the latest version"
          : "Not checked yet";

  return (
    <div className="space-y-4">
      <TileGroup title="Version">
        <TileRow
          icon={<Smartphone className="size-4" />}
          label="Installed version"
          hint="Android till"
          value={<span className="numeric font-semibold text-foreground">v{state.installed}</span>}
        />
        <TileRow
          label="Latest published"
          hint="From the update server"
          value={
            <span className="numeric font-semibold text-foreground">
              {state.latest ? `v${state.latest}` : "—"}
            </span>
          }
        />
        <TileRow label="Update source" hint={MANIFEST_URL} />
      </TileGroup>

      <TileGroup title="Status">
        <TileRow
          icon={
            state.checking || state.downloading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : available ? (
              <DownloadCloud className="size-4" />
            ) : (
              <CheckCircle2 className="size-4" />
            )
          }
          label={status}
          hint={
            state.lastChecked ? `Last checked ${state.lastChecked.toLocaleString()}` : "Not checked yet"
          }
          value={
            available && state.latest ? (
              <span className="numeric text-primary">&rarr; v{state.latest}</span>
            ) : undefined
          }
        />
        {state.downloading && (
          <div className="px-4 py-3">
            <Progress value={state.percent} className="h-2" aria-label="Update download progress" />
          </div>
        )}
        {state.notes && <TileRow label="Release notes" hint={state.notes} />}
        {state.error && (
          <TileRow label="Last error" hint={<span className="text-destructive">{state.error}</span>} />
        )}
      </TileGroup>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          className="touch-target"
          disabled={state.checking || state.downloading}
          onClick={() => void check()}
        >
          {state.checking ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          Check for updates now
        </Button>
        {available && !state.readyUri && (
          <Button className="touch-target" disabled={state.downloading} onClick={() => void install()}>
            {state.downloading ? "Downloading…" : "Download and install"}
          </Button>
        )}
        {state.readyUri && (
          <Button className="touch-target" onClick={() => void installDownloaded()}>
            Update downloaded — tap to install
          </Button>
        )}
      </div>

      <p className="px-1 text-xs text-muted-foreground">
        Updates are delivered as Android-signed APK files. The app downloads the APK from your own
        server and opens Android&rsquo;s installer — no app store needed.
      </p>
    </div>
  );
}
