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

import { hydrateTerminalConfig } from "@/core/activation/terminal-tokens";
import { applyPendingWebBundle, startWebBundleChecks } from "@/platforms/mobile/web-bundle-updates";
import { TillLoader } from "@/components/shared/TillLoader";

export function NativeBoot({ children }: { children: React.ReactNode }) {
  // Emergency access must open even when start-up work would stall on a dead
  // backend: the repair screen needs none of it.
  const [recovery] = useState(() => onRecoveryScreen());
  const [ready, setReady] = useState(recovery);


  useEffect(() => {
    if (ready) return;
    let cancelled = false;
    // Restore terminal identity first because older activation records also
    // contain the cloud pair that was current when the till was registered.
    // The separately saved connection profile is the current authority, so it
    // must be applied last and win when an operator has since changed project.
    void hydrateNativeStorage()
      .catch(() => {})
      .then(() => hydrateTerminalConfig())
      .then(() => hydrateConnectionProfile())
      // Read and remove the legacy bundle while its pointer still exists.
      .then(() => applyPendingWebBundle())
      // Keep only what a terminal needs: caches and leftover installers go.
      .then(() => runDeviceCleanup())
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    // Never leave the phone on the splash if a plugin hangs.
    const watchdog = window.setTimeout(() => {
      if (!cancelled) setReady(true);
    }, 6000);
    return () => {
      cancelled = true;
      window.clearTimeout(watchdog);
    };
  }, [ready]);

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
  if (!ready) return <TillLoader message="Starting the till…" />;
  return <>{children}</>;
}
