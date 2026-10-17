/**
 * Phone start-up gate.
 *
 * Android runs live-only, so start-up clears any business data left on the
 * device and restores the handful of interface preferences. Android code
 * updates arrive only in signed APKs; legacy unsigned web bundles are purged.
 * On web and desktop this renders its children straight away.
 */
import { useEffect, useState } from "react";

import { isNative } from "@/platform-config/platform";
import { onRecoveryScreen } from "@/lib/recovery-route";
import { hydrateNativeStorage } from "@/platforms/mobile/mobile-storage";
import { runDeviceCleanup } from "@/platforms/mobile/device-cleanup";
import { hydrateConnectionProfile } from "@/lib/connection-profile";
import { hasRequiredPlatformConfig } from "@/lib/platform-config-ready";

import { applyPendingWebBundle, startWebBundleChecks } from "@/platforms/mobile/web-bundle-updates";
import { TillLoader } from "@/components/shared/TillLoader";

export function NativeBoot({ children }: { children: React.ReactNode }) {
  // Emergency access must open even when start-up work would stall on a dead
  // backend: the repair screen needs none of it.
  const [recovery] = useState(() => onRecoveryScreen());
  const [ready, setReady] = useState(recovery);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState(false);
  const [slow, setSlow] = useState(false);


  useEffect(() => {
    if (ready) return;
    let cancelled = false;
    setError(false);
    setSlow(false);
    // Restore terminal identity first because older activation records also
    // contain the cloud pair that was current when the till was registered.
    // The separately saved connection profile is the current authority, so it
    // must be applied last and win when an operator has since changed project.
    void hydrateNativeStorage()
      .then(() => hydrateConnectionProfile())
      // Read and remove the legacy bundle while its pointer still exists.
      .then(() => applyPendingWebBundle())
      // Keep only what a terminal needs: caches and leftover installers go.
      .then(() => {
        if (!cancelled) {
          setReady(true);
          void runDeviceCleanup().catch(() => {});
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    // A slow plugin means unknown configuration, never a fresh installation.
    const watchdog = window.setTimeout(() => {
      if (!cancelled) setSlow(true);
    }, 6000);
    return () => {
      cancelled = true;
      window.clearTimeout(watchdog);
    };
  }, [ready, attempt]);

  // Run the updater compatibility hook only on a configured terminal. It now
  // removes legacy unsigned downloads and performs no network activity.
  useEffect(() => {
    if (!ready || recovery || !isNative()) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    void hasRequiredPlatformConfig().then((state) => {
      if (cancelled || !state.ready) return;
      stop = startWebBundleChecks();
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [ready, recovery]);



  // The splash reports what the till is actually loading against: green for the
  // central database, amber for this device's own copy, blue while syncing.
  if (error) return <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
    <p>Could not restore your saved device settings. Your connection and registration have not been removed.</p>
    <button className="rounded-lg bg-primary px-5 py-2 text-primary-foreground" onClick={() => setAttempt(value => value + 1)}>Retry</button>
  </div>;
  if (!ready) return <TillLoader message={slow ? "Still restoring your saved device settings…" : "Starting the till…"} />;
  return <>{children}</>;
}
