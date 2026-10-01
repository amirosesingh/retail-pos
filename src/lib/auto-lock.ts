/**
 * Idle auto-lock for the till.
 *
 * After a set number of seconds with no touch, tap or key, the screen returns
 * to the sign-in keypad. The shift stays open — only the person is signed out.
 * The delay is set per machine in Settings and is measured in seconds so a
 * busy counter can be locked down very tightly.
 */
import { useEffect, useRef } from "react";

const KEY = "pos.autoLock.seconds";
const LAST_ACTIVITY_KEY = "pos.autoLock.lastActivityAt";
const SESSION_IDLE_MINUTES_KEY = "pos.session.idleMinutes";
export const DEFAULT_AUTO_LOCK_SECONDS = 180;
const ACTIVITY_WRITE_THROTTLE_MS = 1_000;
const SERVER_ACTIVITY_THROTTLE_MS = 30_000;
const ACTIVITY_EVENT = "pos:auto-lock-activity";
const OPERATION_EVENT = "pos:auto-lock-operation";
const MAX_OPERATION_GRACE_MS = 2 * 60_000;

let lastLocalActivityAt = 0;
let lastServerActivityAt = 0;
let operationGraceUntil = 0;

const listeners = new Set<() => void>();

/** Seconds of inactivity before locking. 0 means the screen never locks. */
export function autoLockSeconds(): number {
  if (typeof window === "undefined") return DEFAULT_AUTO_LOCK_SECONDS;
  const raw = window.localStorage.getItem(KEY);
  if (raw === null) return DEFAULT_AUTO_LOCK_SECONDS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 86_400) : DEFAULT_AUTO_LOCK_SECONDS;
}

export function setAutoLockSeconds(seconds: number) {
  if (typeof window === "undefined") return;
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.min(Math.round(seconds), 86_400) : 0;
  window.localStorage.setItem(KEY, String(safe));
  for (const l of listeners) l();
}

/** Effective server session limit captured at sign-in, expressed for useAutoLock. */
export function sessionIdleSeconds(): number {
  if (typeof window === "undefined") return DEFAULT_AUTO_LOCK_SECONDS;
  const minutes = Number(window.localStorage.getItem(SESSION_IDLE_MINUTES_KEY));
  return Number.isFinite(minutes) && minutes > 0
    ? Math.min(Math.round(minutes * 60), 86_400)
    : DEFAULT_AUTO_LOCK_SECONDS;
}

export function setSessionIdleMinutes(minutes: number): void {
  if (typeof window === "undefined") return;
  if (Number.isFinite(minutes) && minutes > 0)
    window.localStorage.setItem(SESSION_IDLE_MINUTES_KEY, String(Math.round(minutes)));
  else window.localStorage.removeItem(SESSION_IDLE_MINUTES_KEY);
}

/**
 * The idle delay actually applied: the synchronized terminal setting when it
 * is confirmed, otherwise the per-machine compatibility fallback.
 */
export function effectiveLockSeconds(ruleSeconds?: number): number {
  if (typeof ruleSeconds === "number" && Number.isFinite(ruleSeconds) && ruleSeconds >= 0)
    return Math.min(Math.round(ruleSeconds), 86_400);
  return autoLockSeconds();
}

export function subscribeAutoLock(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Remaining idle allowance for a login that may have survived a reload. */
export function remainingAutoLockMs(
  seconds: number,
  lastActivityAt: number,
  now = Date.now(),
): number {
  if (!seconds) return Number.POSITIVE_INFINITY;
  if (!Number.isFinite(lastActivityAt) || lastActivityAt <= 0) return seconds * 1000;
  return Math.max(0, seconds * 1000 - Math.max(0, now - lastActivityAt));
}

function storedActivityAt(): number {
  if (typeof window === "undefined") return 0;
  const value = Number(window.localStorage.getItem(LAST_ACTIVITY_KEY));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** A successful interactive sign-in starts a fresh idle window. */
export function markAutoLockActivity(at = Date.now()): void {
  if (typeof window === "undefined") return;
  lastLocalActivityAt = Math.max(lastLocalActivityAt, at);
  window.localStorage.setItem(LAST_ACTIVITY_KEY, String(lastLocalActivityAt));
  window.dispatchEvent(new CustomEvent(ACTIVITY_EVENT, { detail: lastLocalActivityAt }));
}

/**
 * A real operator action refreshes the local clock immediately. Persistence of
 * that activity to the revocable server session is deliberately throttled:
 * polling, sync and token refresh never call this function and therefore can
 * never keep an abandoned till signed in.
 */
export function noteOperatorActivity(at = Date.now()): void {
  markAutoLockActivity(at);
  if (at - lastServerActivityAt < SERVER_ACTIVITY_THROTTLE_MS) return;
  lastServerActivityAt = at;
  void import("@/lib/pos-credentials")
    .then(({ loadSessionToken }) => loadSessionToken())
    .then((sessionToken) => {
      if (!sessionToken) return;
      return import("@/lib/user-sessions.functions").then(({ recordDeviceActivity }) =>
        recordDeviceActivity({ data: { sessionToken } }),
      );
    })
    .catch(() => undefined);
}

/** Keep auto-lock out of the unsafe middle of a user-initiated commit. */
export function beginAutoLockOperation(maxMs = MAX_OPERATION_GRACE_MS): () => void {
  if (typeof window === "undefined") return () => undefined;
  noteOperatorActivity();
  operationGraceUntil = Math.max(operationGraceUntil, Date.now() + Math.max(1, maxMs));
  window.dispatchEvent(new Event(OPERATION_EVENT));
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    operationGraceUntil = 0;
    window.dispatchEvent(new Event(OPERATION_EVENT));
  };
}

/** Explicit logout/lock removes the previous person's activity marker. */
export function clearAutoLockActivity(): void {
  if (typeof window === "undefined") return;
  lastLocalActivityAt = 0;
  lastServerActivityAt = 0;
  operationGraceUntil = 0;
  window.localStorage.removeItem(LAST_ACTIVITY_KEY);
  window.localStorage.removeItem(SESSION_IDLE_MINUTES_KEY);
}

// Capture every genuine user interaction that can change application state.
// `input`/`change` also cover keyboard-less scanners and native form controls.
export const OPERATOR_ACTIVITY_EVENTS = [
  "pointerdown",
  "pointermove",
  "keydown",
  "wheel",
  "touchstart",
  "input",
  "change",
  "submit",
] as const;

/**
 * Lock `onLock` in when the screen has been left alone. Nothing happens while
 * nobody is signed in, or while the delay is switched off.
 */
export function useAutoLock(active: boolean, onLock: () => void, ruleSeconds?: number) {
  const lockRef = useRef(onLock);
  lockRef.current = onLock;

  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    let timer = 0;
    let stopped = false;
    let lastWrittenAt = storedActivityAt();

    const schedule = () => {
      window.clearTimeout(timer);
      // The synchronized settings decide when they are the confirmed source; the
      // per-machine value is only a fallback while they have not arrived.
      const seconds = effectiveLockSeconds(ruleSeconds);
      if (!seconds || stopped) return;
      const now = Date.now();
      const remaining = remainingAutoLockMs(
        seconds,
        Math.max(storedActivityAt(), lastLocalActivityAt),
        now,
      );
      const operationRemaining = Math.max(0, operationGraceUntil - now);
      timer = window.setTimeout(
        () => {
          if (Date.now() < operationGraceUntil) {
            schedule();
            return;
          }
          if (
            remainingAutoLockMs(
              effectiveLockSeconds(ruleSeconds),
              Math.max(storedActivityAt(), lastLocalActivityAt),
            ) > 0
          ) {
            schedule();
            return;
          }
          stopped = true;
          lockRef.current();
        },
        Math.max(remaining, operationRemaining),
      );
    };

    const activity = () => {
      const now = Date.now();
      // Mouse movement is noisy. Reset the live timer immediately but write
      // the durable marker at a bounded rate.
      if (now - lastWrittenAt >= ACTIVITY_WRITE_THROTTLE_MS) {
        noteOperatorActivity(now);
        lastWrittenAt = now;
      } else {
        // Keep the exact in-memory deadline responsive without turning raw
        // pointer movement into storage or network write amplification.
        lastLocalActivityAt = now;
      }
      schedule();
    };

    // No marker means a fresh sign-in. A restored login keeps its previous
    // marker and locks immediately if the idle allowance elapsed while away.
    if (!lastWrittenAt) {
      markAutoLockActivity();
      lastWrittenAt = storedActivityAt();
    }
    for (const e of OPERATOR_ACTIVITY_EVENTS)
      window.addEventListener(e, activity, { passive: true });
    const onStoredActivity = (event: StorageEvent) => {
      if (event.key !== LAST_ACTIVITY_KEY || !event.newValue) return;
      const at = Number(event.newValue);
      if (Number.isFinite(at)) lastLocalActivityAt = Math.max(lastLocalActivityAt, at);
      schedule();
    };
    const onSharedActivity = () => schedule();
    const onResume = () => schedule();
    window.addEventListener("storage", onStoredActivity);
    window.addEventListener(ACTIVITY_EVENT, onSharedActivity);
    window.addEventListener(OPERATION_EVENT, onSharedActivity);
    window.addEventListener("focus", onResume);
    document.addEventListener("visibilitychange", onResume);
    const offSetting = subscribeAutoLock(schedule);
    schedule();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      for (const e of OPERATOR_ACTIVITY_EVENTS) window.removeEventListener(e, activity);
      window.removeEventListener("storage", onStoredActivity);
      window.removeEventListener(ACTIVITY_EVENT, onSharedActivity);
      window.removeEventListener(OPERATION_EVENT, onSharedActivity);
      window.removeEventListener("focus", onResume);
      document.removeEventListener("visibilitychange", onResume);
      offSetting();
    };
  }, [active, ruleSeconds]);
}
