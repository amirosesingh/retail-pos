import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const effects = vi.hoisted(() => ({ cleanup: undefined as undefined | (() => void) }));
vi.mock("react", () => ({
  useRef: (value: unknown) => ({ current: value }),
  useEffect: (effect: () => (() => void)) => { effects.cleanup = effect(); },
}));
import { clearAutoLockActivity, markAutoLockActivity, mayResumeOperatorSession, setSessionIdleMinutes, useAutoLock } from "../auto-lock";
function storage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) };
}
let win: EventTarget & { localStorage: ReturnType<typeof storage>; sessionStorage: ReturnType<typeof storage> };
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-20T08:00:00Z"));
  win = Object.assign(new EventTarget(), { localStorage: storage(), sessionStorage: storage(), setTimeout, clearTimeout });
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", new EventTarget());
  clearAutoLockActivity();
});
afterEach(() => { effects.cleanup?.(); effects.cleanup = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("operator session lifetime", () => {
  it("requires interactive sign-in in a new window while allowing a current reload", () => {
    expect(mayResumeOperatorSession()).toBe(false);
    markAutoLockActivity();
    setSessionIdleMinutes(30);
    expect(mayResumeOperatorSession()).toBe(true);
    win.sessionStorage = storage();
    expect(mayResumeOperatorSession()).toBe(false);
  });
  it("does not resume yesterday's session or one explicitly signed out", () => {
    markAutoLockActivity();
    setSessionIdleMinutes(30);
    vi.setSystemTime(Date.now() + 24 * 60 * 60_000);
    expect(mayResumeOperatorSession()).toBe(false);
    markAutoLockActivity();
    expect(mayResumeOperatorSession()).toBe(true);
    clearAutoLockActivity();
    expect(mayResumeOperatorSession()).toBe(false);
  });
  it("locks before the first waking input can renew an expired timer", () => {
    markAutoLockActivity();
    const lock = vi.fn();
    useAutoLock(true, lock, 180);
    const oldActivity = win.localStorage.getItem("pos.autoLock.lastActivityAt");
    // Advance the wall clock without delivering suspended timer callbacks.
    vi.setSystemTime(Date.now() + 86_400_000);
    win.dispatchEvent(new Event("pointermove"));
    expect(lock).toHaveBeenCalledTimes(1);
    expect(win.localStorage.getItem("pos.autoLock.lastActivityAt")).toBe(oldActivity);
    win.dispatchEvent(new Event("pointerdown"));
    expect(lock).toHaveBeenCalledTimes(1);
  });
});
