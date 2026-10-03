/**
 * Online kill-switch.
 *
 * While the till has a connection it re-checks its activation token every ten
 * seconds (and immediately when the app resumes, regains focus or reconnects).
 * If management revoked the token the machine wipes its saved credentials and
 * locks on a persistent revocation screen.
 *
 * With no connection nothing happens at all — offline selling must never be
 * interrupted by a check that cannot run.
 */
import { useEffect, useState } from "react";
import {
  clearTerminalConfig,
  fetchTokenStatus,
  hydrateTerminalConfig,
  isTerminalConfigHydrated,
  readTerminalConfig,
  restoreTerminalConfigFromDisk,
  stampHeartbeat,
  subscribeTerminalConfig,
  type TerminalConfig,
} from "@/core/activation/terminal-tokens";
import { clearActivationRecord, writeActivationRecord } from "@/core/activation/activation-record";

/** A revoked till stays usable for at most this long while it remains online. */
export const REVOCATION_CHECK_MS = 10 * 1000;
/** Gap before a single empty lookup is confirmed as a deleted record. */
export const MISSING_CONFIRM_MS = 8 * 1000;
const BLOCK_KEY = "pos.terminal.revoked";

/** Why the terminal is locked: management revoked it, or the record is gone. */
export type BlockReason = "revoked" | "missing";

const savedBlock = typeof window !== "undefined" ? window.localStorage.getItem(BLOCK_KEY) : null;
let blocked = savedBlock === "1" || savedBlock === "missing";
let blockReason: BlockReason = savedBlock === "missing" ? "missing" : "revoked";
const listeners = new Set<() => void>();

/** True once a revocation (or deletion) has been confirmed by the server. */
export const isTerminalRevoked = () => blocked;

/** Which of the two lock causes applies. Meaningless while not blocked. */
export const terminalBlockReason = (): BlockReason => blockReason;

function setBlocked(next: boolean, reason: BlockReason = "revoked") {
  if (blocked === next && blockReason === reason) return;
  blocked = next;
  blockReason = reason;
  if (typeof window !== "undefined") {
    if (next) window.localStorage.setItem(BLOCK_KEY, reason === "missing" ? "missing" : "1");
    else window.localStorage.removeItem(BLOCK_KEY);
  }
  for (const l of listeners) l();
}

export function subscribeRevocation(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function clearRevocation() {
  setBlocked(false);
}

export type TerminalVerdict = {
  /** "unknown" means no usable answer — never act on it */
  outcome: "ok" | "revoked" | "missing" | "unknown";
  stamp?: string | null;
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Ask the database what it thinks of this terminal.
 *
 * A lookup that succeeds but finds nothing means the registration row was
 * deleted — that ends the terminal just like a revocation. Because an empty
 * answer can also appear for a moment while the database reloads its API, one
 * empty result is retried before it counts.
 */
export async function terminalVerdict(
  tokenId: string,
  deps: {
    lookup?: typeof fetchTokenStatus;
    isOnline?: () => boolean;
    confirmDelayMs?: number;
  } = {},
): Promise<TerminalVerdict> {
  const lookup = deps.lookup ?? fetchTokenStatus;
  const isOnline = deps.isOnline ?? (() => typeof navigator === "undefined" || navigator.onLine);
  // No link, no verdict: the till keeps selling exactly as it was.
  if (!isOnline()) return { outcome: "unknown" };

  let remote: Awaited<ReturnType<typeof fetchTokenStatus>>;
  try {
    remote = await lookup(tokenId);
  } catch {
    return { outcome: "unknown" }; // transient error — try again on the next tick
  }

  if (!remote) {
    // Second opinion before locking a working shop floor.
    await wait(deps.confirmDelayMs ?? MISSING_CONFIRM_MS);
    if (!isOnline()) return { outcome: "unknown" };
    try {
      const again = await lookup(tokenId);
      if (!again) return { outcome: "missing" };
      remote = again;
    } catch {
      return { outcome: "unknown" };
    }
  }

  if (remote.status === "revoked") return { outcome: "revoked" };
  return { outcome: "ok", stamp: (remote as { stamp?: string | null }).stamp ?? null };
}

export type RevocationState = {
  config: TerminalConfig | null;
  /** the token was confirmed revoked or deleted — lock the screen */
  revoked: boolean;
  /** which of the two causes locked the terminal */
  reason: BlockReason;
  online: boolean;
  lastCheckedAt: string | null;
  /** still unsealing the saved activation — do not ask for a new code yet */
  hydrating: boolean;
  /**
   * The registration has been asked about once since launch. Until then the
   * shell waits, so a till switched off while its record was deleted locks on
   * the next power-on instead of up to five minutes later.
   */
  verified: boolean;
};

export function useRevocationCheck(): RevocationState {
  const [config, setConfig] = useState<TerminalConfig | null>(() => readTerminalConfig());
  const [revoked, setRevoked] = useState(isTerminalRevoked);
  const [reason, setReason] = useState<BlockReason>(terminalBlockReason);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [hydrating, setHydrating] = useState(() => !isTerminalConfigHydrated());
  const [verified, setVerified] = useState(false);

  useEffect(() => subscribeTerminalConfig(() => setConfig(readTerminalConfig())), []);
  useEffect(() => {
    void hydrateTerminalConfig().finally(() => {
      setConfig(readTerminalConfig());
      setHydrating(false);
    });
  }, []);
  // After an in-place desktop update the renderer storage can come back empty;
  // the shell keeps a copy of the activation on disk.
  useEffect(() => {
    void restoreTerminalConfigFromDisk();
  }, []);
  useEffect(() => {
    const off = subscribeRevocation(() => {
      setRevoked(isTerminalRevoked());
      setReason(terminalBlockReason());
    });
    return () => {
      off();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => setOnline(navigator.onLine);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  useEffect(() => {
    if (!config) return;
    let cancelled = false;
    let checking = false;

    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        const verdict = await terminalVerdict(config.tokenId);
        if (cancelled) return;
        setVerified(true);
        if (verdict.outcome === "unknown") return;
        setLastCheckedAt(new Date().toISOString());
        if (verdict.outcome === "revoked" || verdict.outcome === "missing") {
          // Persist the lock before clearing identity so the shell never falls
          // through to sign-in or activation during the state transition.
          setBlocked(true, verdict.outcome);
          clearTerminalConfig();
          clearActivationRecord();
          return;
        }
        setBlocked(false);
        void stampHeartbeat(config.tokenId);
        void writeActivationRecord({ tokenId: config.tokenId, stamp: verdict.stamp ?? null }).catch(
          () => {},
        );
      } finally {
        checking = false;
      }
    };

    void check();
    const timer = window.setInterval(() => void check(), REVOCATION_CHECK_MS);
    const checkNow = () => void check();
    const onVisible = () => {
      if (document.visibilityState !== "hidden") void check();
    };
    window.addEventListener("online", checkNow);
    window.addEventListener("focus", checkNow);
    window.addEventListener("pageshow", checkNow);
    window.addEventListener("pos:app-resume", checkNow);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("online", checkNow);
      window.removeEventListener("focus", checkNow);
      window.removeEventListener("pageshow", checkNow);
      window.removeEventListener("pos:app-resume", checkNow);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [config]);

  // With no saved activation there is nothing to verify.
  useEffect(() => {
    if (!config) setVerified(true);
  }, [config]);

  return { config, revoked, reason, online, lastCheckedAt, hydrating, verified };
}
