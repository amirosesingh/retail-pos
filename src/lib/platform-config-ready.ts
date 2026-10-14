/**
 * One answer to "is this device configured?" for Android and Windows.
 *
 * A shipped APK or installer carries no customer: no project URL, no key, no
 * backend address. Everything comes from the device's own secure store — the
 * Electron OS vault or the Android Keystore — written by the setup screen
 * through `saveConnectionProfile()`. Until that exists the terminal is simply
 * UNCONFIGURED, which is a normal state, not an error: the app opens setup
 * instead of touching a backend.
 *
 * Nothing here reads web environment values, and nothing here goes to the
 * network. It is a pure local readiness check that every backend-dependent
 * start-up step consults first.
 */
import { isTerminalApp } from "@/platform-config/platform";
import { cloudKeyStatus, subscribeCloudKeys } from "@/lib/secure-cloud-config";
import { hasTerminalSupabaseOverride } from "@/lib/external-supabase-config";
import { backendUrl } from "@/lib/backend-config";
import {
  hydrateConnectionProfile,
  isConnectionProfileHydrated,
  subscribeProfileHydrated,
} from "@/lib/connection-profile";

export type ConfigReadinessState =
  /** web, or anything that is not a terminal build */
  | "not-applicable"
  /** the saved profile is still being read out of platform storage */
  | "hydrating"
  /** nothing at all has been configured on this device */
  | "missing"
  /** some of the three values are present, not all */
  | "incomplete"
  /** a test is running right now (set by the setup screen) */
  | "testing"
  /** everything is stored but the saved values did not answer */
  | "failed"
  /** stored, well-formed and usable */
  | "ready";

export type ConfigReadiness = {
  /** true when this platform may start backend-dependent work */
  ready: boolean;
  state: ConfigReadinessState;
  /** short, user-facing reason when the terminal is not ready */
  reason?: string;
  /** which of the three values this device already holds */
  have: { supabaseUrl: boolean; supabaseKey: boolean; backendUrl: boolean };
};

const NONE = { supabaseUrl: false, supabaseKey: false, backendUrl: false };

const looksLikeUrl = (value: string) => /^https:\/\/[^\s/]+\.[^\s/]+/i.test(value.trim());

/** Last settled answer, so synchronous callers never guess mid-restore. */
let lastReady = false;

/**
 * Local-only readiness. Web is always ready — its configuration is supplied by
 * the hosting environment (Cloudflare) and validated elsewhere.
 *
 * On a terminal the saved profile is restored first: an unconfigured verdict
 * is only honest once platform storage has actually been read.
 */
export async function hasRequiredPlatformConfig(): Promise<ConfigReadiness> {
  if (!isTerminalApp()) return { ready: true, state: "not-applicable", have: NONE };
  try {
    await hydrateConnectionProfile();
    const [status, backend] = await Promise.all([cloudKeyStatus(), backendUrl()]);
    const have = {
      supabaseUrl: Boolean(status.configured && status.url),
      supabaseKey: Boolean(status.configured),
      backendUrl: Boolean(backend),
    };
    const count = Object.values(have).filter(Boolean).length;

    if (count === 0)
      return settle({
        ready: false,
        state: "missing",
        reason: "This terminal has not been connected to a company yet.",
        have,
      });
    if (count < 3)
      return settle({
        ready: false,
        state: "incomplete",
        reason: have.backendUrl
          ? "The central database address and API key are still missing."
          : "The POS backend address is still missing.",
        have,
      });
    if (!looksLikeUrl(status.url))
      return settle({
        ready: false,
        state: "failed",
        reason: "The saved central database address is not a valid https:// URL.",
        have,
      });
    if (!looksLikeUrl(backend))
      return settle({
        ready: false,
        state: "failed",
        reason: "The saved POS backend address is not a valid https:// URL.",
        have,
      });
    return settle({ ready: true, state: "ready", have });
  } catch (error) {
    return settle({
      ready: false,
      state: "failed",
      reason: error instanceof Error ? error.message : "Saved configuration could not be read.",
      have: NONE,
    });
  }
}

function settle(result: ConfigReadiness): ConfigReadiness {
  lastReady = result.ready;
  return result;
}

/**
 * Synchronous best-effort answer for hot paths that cannot await.
 *
 * While the profile is still being restored this reports the last settled
 * answer rather than guessing from an empty in-memory override — an
 * unconfigured verdict during the restore window is what used to bounce a
 * working terminal into setup.
 */
export function platformConfigReadySync(): boolean {
  if (!isTerminalApp()) return true;
  if (!isConnectionProfileHydrated()) {
    void hydrateConnectionProfile().catch(() => {});
    return lastReady;
  }
  return lastReady || hasTerminalSupabaseOverride();
}

/** Re-run the check whenever the device's stored credentials change. */
export function subscribeConfigReady(fn: (state: ConfigReadiness) => void): () => void {
  const run = () => void hasRequiredPlatformConfig().then(fn).catch(() => {});
  run();
  const offKeys = subscribeCloudKeys(run);
  // The backend half arrives with the restore, not with a key change.
  const offHydrated = subscribeProfileHydrated(run);
  return () => {
    offKeys();
    offHydrated();
  };
}

