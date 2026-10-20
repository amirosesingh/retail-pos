import { Switch } from "@/components/ui/switch";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import { CapacitorUpdater } from "@capgo/capacitor-updater";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { iosOta, startIosOta, allowManualInstall } from "./runtime";
import { syncIosAppearance } from "./appearance";
import { RELEASE_CHANNEL } from "@/lib/release-channel";

export function IosOtaBoot({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      setReady(true);
      return;
    }
    void startIosOta()
      .then(() => setReady(true))
      .catch((e) => setError(String(e)));
    return syncIosAppearance();
  }, []);
  if (error)
    return (
      <>
        <div className="p-3 text-sm" role="alert">
          <p>Automatic updates are unavailable: {error}</p>
          <Button
            variant="outline"
            onClick={() => {
              if (
                window.confirm(
                  "Restore the interface included in the IPA? The app will reopen. Saved database settings are retained.",
                )
              ) {
                void CapacitorUpdater.reset({ toLastSuccessful: false }).catch((e) =>
                  setError(String(e)),
                );
              }
            }}
          >
            Restore built-in interface
          </Button>
        </div>
        {children}
      </>
    );
  return ready ? (
    children
  ) : (
    <p role="status" className="p-5">
      Opening Retail…
    </p>
  );
}
export function IosOtaSettings() {
  const state = useSyncExternalStore(iosOta.subscribe, iosOta.snapshot, iosOta.snapshot);
  const [prefs, setPrefs] = useState(iosOta.settings());
  const [error, setError] = useState("");
  const busy = ["checking", "downloading", "verifying", "installing"].includes(state.phase);
  const run = (action: () => Promise<unknown>) => {
    setError("");
    void action().catch((e) => setError(String(e)));
  };
  const confirm = () =>
    window.confirm(
      "Have you saved and finished all forms and transactions? Installing will reload the app.",
    );
  return (
    <section
      className="space-y-4 rounded-xl border bg-card p-4"
      aria-label="iPhone software updates"
    >
      <h2 className="text-base font-semibold">
        iPhone software updates{RELEASE_CHANNEL === "beta" ? " · Beta" : ""}
      </h2>
      <p className="text-xs text-muted-foreground">Installed: {state.installed}</p>
      {state.latest && (
        <>
          <p>Available: {state.latest.version}</p>
          <p className="whitespace-pre-wrap text-sm">{state.latest.notes}</p>
        </>
      )}
      <p role="status" className="text-sm">
        {state.phase}
      </p>
      {state.progress !== undefined && (
        <>
          <Progress value={state.progress} />
          <p>{state.progress}%</p>
        </>
      )}
      {(state.error || error) && (
        <p role="alert" className="text-sm text-destructive">
          {state.error || error}
        </p>
      )}
      {state.healthIssue && (
        <p role="status" className="text-sm">
          {state.healthIssue}
        </p>
      )}
      {state.deferred && <p className="text-sm">{state.deferred}</p>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => run(() => iosOta.check(true))}>
          {state.phase === "error" ? "Retry check" : "Check for updates"}
        </Button>
        {state.phase === "available" && (
          <Button onClick={() => run(() => iosOta.download())}>Download</Button>
        )}
        {state.phase === "ready" && (
          <Button
            onClick={() => {
              if (confirm()) {
                allowManualInstall();
                run(() => iosOta.install());
              }
            }}
          >
            Install and reopen
          </Button>
        )}
      </div>
      <div className="space-y-2 text-sm">
        {(
          [
            ["silentDownload", "Download automatically"],
            ["autoInstall", "Install automatically when safe"],
            ["healthMonitor", "Report application errors for recovery"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex items-center gap-2">
            <Switch
              aria-label={label}
              checked={prefs[key]}
              onCheckedChange={(checked) => {
                const next = { ...prefs, [key]: checked };
                run(async () => {
                  await iosOta.preferences(
                    next.silentDownload,
                    next.autoInstall,
                    next.healthMonitor,
                  );
                  setPrefs(next);
                });
              }}
            />
            {label}
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Automatic install is deferred outside this page or after editing a form. Native changes
        still need a new IPA.
      </p>
      <details>
        <summary className="text-sm">Recovery</summary>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              if (confirm()) {
                allowManualInstall();
                run(() => iosOta.restore(false, true));
              }
            }}
          >
            Restore previous working version
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              if (confirm()) {
                allowManualInstall();
                run(() => iosOta.restore(true, true));
              }
            }}
          >
            Restore built-in IPA interface
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Startup recovery detects initialization failures, not every later API or logic error. Your
          saved database connection is retained.
        </p>
      </details>
    </section>
  );
}
