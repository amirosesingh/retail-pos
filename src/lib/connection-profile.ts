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

const REGISTRATION_RECOVERY_MESSAGES = {
  EACTIVATION_RECOVERY_BINDING: "The saved registration could not be matched to this device's previous terminal binding. The saved setup has been kept.",
  EACTIVATION_RECOVERY_PROOF: "The original saved registration proof could not be recovered. The saved setup has been kept.",
  EACTIVATION_RECOVERY_VERIFY: "The POS website could not verify the saved registration. Check the connection and retry registration recovery.",
  EACTIVATION_RECOVERY_PROJECT: "The saved registration belongs to a different database connection. Review the saved connection before retrying registration recovery.",
  EACTIVATION_CONTEXT_CHANGED: "The saved registration or connection changed during recovery. Retry with this device's current settings.",
  EACTIVATION_STORE: "Windows could not read the saved registration or its previous binding. The saved setup has been kept. Retry registration recovery.",
  EAPP_CLOSING: "Registration recovery paused while the app closes. Reopen the app and retry.",
  EREGISTRATION_UNKNOWN: "The saved terminal registration could not be restored. The saved setup has been kept. Retry registration recovery.",
} as const;

export type RegistrationRecoveryCode = keyof typeof REGISTRATION_RECOVERY_MESSAGES;
const recoveryCode = (value: unknown): RegistrationRecoveryCode =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(REGISTRATION_RECOVERY_MESSAGES, value)
    ? value as RegistrationRecoveryCode : "EREGISTRATION_UNKNOWN";

/** Only fixed recovery reasons reach startup UI; native diagnostic text stays private. */
export const registrationRestoreMessage = (code: unknown): string => REGISTRATION_RECOVERY_MESSAGES[recoveryCode(code)];

/** Connection values were read; registration remains unverified, not absent. */
export class RegistrationRestoreError extends Error {
  readonly code = "EREGISTRATION_RESTORE";
  readonly registrationCode: RegistrationRecoveryCode;
  constructor(cause?: unknown) {
    let code: unknown;
    try { code = (cause as { code?: unknown } | null)?.code; } catch { /* Foreign error accessors are not diagnostics. */ }
    const safeCode = recoveryCode(code);
    super(registrationRestoreMessage(safeCode));
    this.name = "RegistrationRestoreError";
    this.registrationCode = safeCode;
  }
}

export const isRegistrationRestoreError = (error: unknown): error is RegistrationRestoreError =>
  error instanceof RegistrationRestoreError;

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
    let registrationFailed = false;
    let registrationError: unknown;
    try { await hydrateTerminalConfig(); }
    catch (error) { registrationFailed = true; registrationError = error; }
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
    // Recovery must be able to show/fix a readable connection even when an old
    // registration needs online proof verification. Ordinary startup still
    // rejects, so a failed identity read never permits sign-in or trading.
    if (registrationFailed) throw new RegistrationRestoreError(registrationError);
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
