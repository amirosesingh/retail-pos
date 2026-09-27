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
export const DEFAULT_AUTO_LOCK_SECONDS = 180;
const ACTIVITY_WRITE_THROTTLE_MS = 5_000;

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
  window.localStorage.setItem(LAST_ACTIVITY_KEY, String(at));
}

/** Explicit logout/lock removes the previous person's activity marker. */
export function clearAutoLockActivity(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(LAST_ACTIVITY_KEY);
}

// Capture every genuine user interaction that can change application state.
// `input`/`change` also cover keyboard-less scanners and native form controls.
const EVENTS = [
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
      const remaining = remainingAutoLockMs(seconds, storedActivityAt());
      timer = window.setTimeout(() => {
        stopped = true;
        lockRef.current();
      }, remaining);
    };

    const activity = () => {
      const now = Date.now();
      // Mouse movement is noisy. Reset the live timer immediately but write
      // the durable marker at a bounded rate.
      if (now - lastWrittenAt >= ACTIVITY_WRITE_THROTTLE_MS) {
        markAutoLockActivity(now);
        lastWrittenAt = now;
      }
      window.clearTimeout(timer);
      const seconds = effectiveLockSeconds(ruleSeconds);
      if (!seconds || stopped) return;
      timer = window.setTimeout(() => {
        stopped = true;
        lockRef.current();
      }, seconds * 1000);
    };

    // No marker means a fresh sign-in. A restored login keeps its previous
    // marker and locks immediately if the idle allowance elapsed while away.
    if (!lastWrittenAt) {
      markAutoLockActivity();
      lastWrittenAt = storedActivityAt();
    }
    for (const e of EVENTS) window.addEventListener(e, activity, { passive: true });
    const offSetting = subscribeAutoLock(schedule);
    schedule();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      for (const e of EVENTS) window.removeEventListener(e, activity);
      offSetting();
    };
  }, [active, ruleSeconds]);
}
