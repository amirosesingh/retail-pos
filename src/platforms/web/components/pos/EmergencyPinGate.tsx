/**
 * PIN gate in front of Emergency Access.
 *
 * Recovery Settings never open straight away: the operator has to type the
 * one-minute recovery code first. Verification happens entirely on this
 * device — no internet, no cloud, no database, nobody signed in — and the
 * unlock lasts for this screen only, never persisted.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Delete, LifeBuoy, Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { logger } from "@/lib/audit-log";
import { isTerminalApp } from "@/platform-config/platform";
import {
  EMERGENCY_CODE_LENGTH,
  emergencyPinAvailable,
  verifyEmergencyPin,
} from "@/lib/emergency-pin";
import {
  lockoutRemaining,
  notePinFailure,
  attemptsLeft,
  clearPinFailures,
  type LockoutScope,
} from "@/lib/pin-lockout";

/**
 * The desktop till refuses connection, identity and database changes until
 * somebody unlocks it. On this screen the recovery code *is* the unlock: the
 * desktop process re-checks the same code against its own clock and opens a
 * short repair session, so the operator is never asked for a supervisor sign-in
 * halfway through fixing a terminal that cannot sign anybody in.
 */
type RecoveryBridge = {
  recoveryUnlock?: (code: string) => Promise<{ ok: boolean }>;
  recoveryLock?: () => Promise<unknown>;
};

const recoveryBridge = (): RecoveryBridge | undefined =>
  typeof window === "undefined"
    ? undefined
    : (window as unknown as { sqlAdmin?: RecoveryBridge }).sqlAdmin;

/**
 * Recovery keeps its own guessing counter. A cashier who mistyped their PIN
 * must never lock this terminal out of the screen that repairs its connection,
 * and a wrong recovery code must never lock the till keypad.
 */
const SCOPE: LockoutScope = "recovery";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"];

export function EmergencyPinGate({ children }: { children: ReactNode }) {
  const gated = isTerminalApp();
  const [unlocked, setUnlocked] = useState(!gated);
  const [available, setAvailable] = useState(true);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(0);
  // A verification still in flight when this screen closes must not write to a
  // gone component, and reopening must never inherit its result.
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    setPin("");
    setError("");
    setBusy(false);
    return () => {
      alive.current = false;
      // Leaving recovery closes the repair session on the desktop till.
      void recoveryBridge()?.recoveryLock?.();
    };
  }, []);

  useEffect(() => {
    if (!gated) return;
    void emergencyPinAvailable().then(setAvailable).catch(() => setAvailable(false));
  }, [gated]);

  useEffect(() => {
    if (!gated || unlocked) return;
    const tick = () => setLocked(lockoutRemaining(SCOPE));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [gated, unlocked]);

  if (unlocked) return <>{children}</>;

  const submit = async (code: string) => {
    if (busy || locked > 0) return;
    setBusy(true);
    setError("");
    const ok = await verifyEmergencyPin(code).catch(() => false);
    if (!alive.current) return;
    setBusy(false);
    setPin("");
    // Every attempt is written to the local trail and travels with the next
    // sync, so a stream of guesses on a till is visible to management even
    // though the screen itself never needs a connection.
    if (ok) {
      const bridge = recoveryBridge();
      const desktop = bridge?.recoveryUnlock
        ? await bridge.recoveryUnlock(code).catch(() => ({ ok: false }))
        : { ok: true };
      if (!desktop.ok) {
        setError("The protected repair session could not be opened. Try again.");
        return;
      }
      clearPinFailures(SCOPE);
      logger.log("security", "Emergency access unlocked", "recovery", { outcome: "granted" });
      setUnlocked(true);
      return;
    }
    const wait = notePinFailure(SCOPE);
    logger.log("security", "Emergency access refused", "recovery", {
      outcome: "refused",
      attemptsLeft: attemptsLeft(SCOPE),
      lockedForMs: wait,
    });
    setLocked(wait);
    setError(
      wait > 0
        ? "Too many attempts. Try again in a few minutes."
        : `Incorrect code. ${attemptsLeft(SCOPE)} attempt(s) left.`,
    );
  };

  const press = (key: string) => {
    if (key === "back") {
      setPin((p) => p.slice(0, -1));
      return;
    }
    if (!key) return;
    const next = (pin + key).slice(0, EMERGENCY_CODE_LENGTH);
    setPin(next);
    if (next.length === EMERGENCY_CODE_LENGTH) void submit(next);
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col items-center justify-center gap-5 bg-background p-6 text-center">
      <div className="flex items-center gap-2 text-foreground">
        <LifeBuoy className="size-5 text-warning" />
        <h1 className="text-lg font-semibold">Emergency access</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Enter the recovery code for this device to open its connection settings.
      </p>

      {!available ? (
        <p className="rounded-md border border-border p-3 text-sm text-muted-foreground">
          Recovery codes are not available on this device.
        </p>
      ) : (
        <>
          <div
            className="font-mono text-xl tracking-[0.2em] text-foreground"
            aria-label="Recovery code entry"
          >
            {pin.padEnd(EMERGENCY_CODE_LENGTH, "·")}
          </div>

          <div className="grid w-full grid-cols-3 gap-2">
            {KEYS.map((key, i) => (
              <Button
                key={`${key}-${i}`}
                variant={key === "back" ? "outline" : "secondary"}
                disabled={!key || busy || locked > 0}
                className={key ? "h-14 text-lg" : "pointer-events-none h-14 opacity-0"}
                onClick={() => press(key)}
              >
                {key === "back" ? <Delete className="size-5" /> : key}
              </Button>
            ))}
          </div>

          {locked > 0 && (
            <p className="text-sm text-destructive">
              Locked for {Math.ceil(locked / 1000)}s
            </p>
          )}
          {error && locked === 0 && <p className="text-sm text-destructive">{error}</p>}
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Lock className="size-3" />
            The code changes every minute
          </p>
        </>
      )}
    </main>
  );
}
