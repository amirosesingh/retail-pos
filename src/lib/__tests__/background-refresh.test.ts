import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../session-presence", () => ({ hasSignedInIdentity: () => signedIn }));
vi.mock("@/core/activation/connection-health", () => ({ APP_RESUME_EVENT: "app:resume" }));
import { createRefreshQueue, requestBackgroundRefresh, subscribeBackgroundRefresh } from "../background-refresh";
let signedIn = true;
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("background refresh", () => {
  it("coalesces overlapping events, runs a trailing read and stops on unmount", async () => {
    let finish!: () => void;
    const read = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const queue = createRefreshQueue(read);
    const first = queue.refresh();
    void queue.refresh(); void queue.refresh();
    expect(read).toHaveBeenCalledTimes(1);
    finish(); await Promise.resolve();
    expect(read).toHaveBeenCalledTimes(2);
    queue.stop(); void queue.refresh(); finish(); await first;
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("retains recovery after a failed read", async () => {
    const error = vi.fn();
    const read = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const queue = createRefreshQueue(read, error);
    await queue.refresh(); await queue.refresh();
    expect(error).toHaveBeenCalledTimes(1); expect(read).toHaveBeenCalledTimes(2);
  });
  it("refreshes on a hint, resume and timer, but stays quiet when hidden, offline or signed out", () => {
    vi.useFakeTimers(); signedIn = true;
    const win = new EventTarget(); const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
    vi.stubGlobal("window", Object.assign(win, { setInterval, clearInterval }));
    vi.stubGlobal("document", doc); vi.stubGlobal("navigator", { onLine: true });
    const refresh = vi.fn(); const off = subscribeBackgroundRefresh(refresh);
    requestBackgroundRefresh(); win.dispatchEvent(new Event("app:resume")); vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(3);
    doc.visibilityState = "hidden"; vi.advanceTimersByTime(60_000);
    doc.visibilityState = "visible"; Object.assign(navigator, { onLine: false }); requestBackgroundRefresh();
    Object.assign(navigator, { onLine: true }); signedIn = false; requestBackgroundRefresh();
    expect(refresh).toHaveBeenCalledTimes(3);
    signedIn = true; off(); requestBackgroundRefresh(); vi.advanceTimersByTime(60_000);
    expect(refresh).toHaveBeenCalledTimes(3);
  });
  it("allows Electron catch-up from SQL Server without internet", () => {
    vi.useFakeTimers(); signedIn = true;
    const win = new EventTarget();
    vi.stubGlobal("window", Object.assign(win, { setInterval, clearInterval }));
    vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
    vi.stubGlobal("navigator", { onLine: false });
    const refresh = vi.fn(); const off = subscribeBackgroundRefresh(refresh, 300_000, true);
    requestBackgroundRefresh(); expect(refresh).toHaveBeenCalledTimes(1); off();
  });
});
