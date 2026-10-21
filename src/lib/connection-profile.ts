/**
 * One restore step for the whole connection profile.
 *
 * A terminal's three connection values live in two different platform stores:
 * the cloud pair in the OS vault (DPAPI on Windows, Keystore on Android) and
 * the backend address in the shell's own configuration store. Both are read
 * asynchronously, so for the first moments of a launch the in-memory answer to
 * "is this device configured?" is simply *not known yet*.
 *
 * Before this module existed, each half was restored by a different part of
 * start-up, and readiness could be evaluated in between — which is how a
 * correctly configured till ended up looking unconfigured and was sent to the
 * setup screen. Everything now waits for `hydrateConnectionProfile()`.
 *
 * The function is memoised, idempotent and safe to await from several places.
 */
import { isTerminalApp } from "@/platform-config/platform";
import { hydrateBackendUrl } from "./backend-config";
import { initCloudConfigFromShell } from "./secure-cloud-config";
import { hydrateTerminalConfig } from "@/core/activation/terminal-tokens";
import { hydrateNativeStorage, flushNativeStorage } from "@/platforms/mobile/mobile-storage";

export type ProfileHydration = "idle" | "hydrating" | "hydrated";

let state: ProfileHydration = "idle";
let inFlight: Promise<void> | null = null;

/** Where the restore has got to. Synchronous, for gates that cannot await. */
export function connectionProfileState(): ProfileHydration {
  // The website's configuration comes from its hosting environment and is
  // already in the page, so there is nothing to restore.
  if (!isTerminalApp()) return "hydrated";
  return state;
}

export function isConnectionProfileHydrated(): boolean {
  return connectionProfileState() === "hydrated";
}

/**
 * Restore both halves of the profile from platform storage and apply them:
 * the cloud pair becomes the tenant override for every database call, the
 * backend address becomes `window.__POS_SERVER_URL__`.
 */
export function hydrateConnectionProfile(): Promise<void> {
  if (!isTerminalApp()) return Promise.resolve();
  if (state === "hydrated") return Promise.resolve();
  if (inFlight) return inFlight;
  state = "hydrating";
  inFlight = (async () => {
    // The root heartbeat can start before NativeBoot. It must join the same
    // Preferences restore before any activation decryption or key generation.
    await hydrateNativeStorage();
    // Terminal identity first. An older activation record also carries the
    // cloud pair that was current when the till was registered, and applying
    // it after the vault pair would silently point the till at the previous
    // project. Restoring it first lets the device's own saved connection win.
    await hydrateTerminalConfig();
    // Missing values resolve normally. Unreadable storage must keep the boot
    // gate closed. Settle both reads before allowing another restore attempt.
    for (let attempt = 0; ; attempt++) {
      const results = await Promise.allSettled([
        initCloudConfigFromShell(),
        hydrateBackendUrl(),
      ]);
      const failed = results.find(result => result.status === "rejected");
      if (!failed || failed.status !== "rejected") break;
      if (attempt === 2) throw failed.reason;
      await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
    }
  })()

    .catch((error) => {
      state = "idle";
      inFlight = null;
      throw error;
    })
    .then(() => {
      state = "hydrated";
      inFlight = null;
      for (const cb of listeners) {
        try {
          cb();
        } catch {
          /* a broken listener must not hold up start-up */
        }
      }
    });
  return inFlight;
}

/** Resolves once the saved profile is in memory, starting the restore if needed. */
export function awaitProfileHydrated(): Promise<void> {
  return hydrateConnectionProfile();
}

const listeners = new Set<() => void>();

/** Fires once, when the restore completes. */
export function subscribeProfileHydrated(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Test seam: forget that a restore ever happened (simulates a restart). */
export function __resetProfileHydrationForTests(): void {
  state = "idle";
  inFlight = null;
}

/** Finish durable device-setting changes before an intentional restart. */
export async function flushConnectionProfile(): Promise<void> {
  await flushNativeStorage();
}
