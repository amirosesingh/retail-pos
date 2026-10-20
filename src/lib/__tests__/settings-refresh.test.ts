import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  change: null as null | ((change: { table: string; reason: string }) => void),
  signedIn: true,
}));
vi.mock("../sync-engine", () => ({ subscribeSettingsChange: (fn: typeof state.change) => {
  state.change = fn; return () => { state.change = null; };
} }));
vi.mock("../session-presence", () => ({ hasSignedInIdentity: () => state.signedIn }));
vi.mock("@/core/activation/connection-health", () => ({ APP_RESUME_EVENT: "resume" }));
import { subscribeSettingsRefresh } from "../settings-refresh";
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); state.signedIn = true; });
function setup() {
  vi.useFakeTimers();
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const win = Object.assign(new EventTarget(), { setInterval, clearInterval });
  vi.stubGlobal("document", doc); vi.stubGlobal("window", win);
  vi.stubGlobal("navigator", { onLine: false });
  return { doc, win };
}
it("batches settings hints and serializes reads even for offline SQL", async () => {
  setup();
  let finish!: () => void;
  const read = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const stop = subscribeSettingsRefresh(read, change => change.table === "settings_scoped");
  state.change!({ table: "other", reason: "edit" });
  await vi.advanceTimersByTimeAsync(100);
  expect(read).not.toHaveBeenCalled();
  for (let i = 0; i < 10; i++) state.change!({ table: "settings_scoped", reason: "edit" });
  await vi.advanceTimersByTimeAsync(100);
  expect(read).toHaveBeenCalledOnce();
  state.change!({ table: "settings_scoped", reason: "edit" });
  await vi.advanceTimersByTimeAsync(100);
  expect(read).toHaveBeenCalledOnce();
  finish(); await Promise.resolve();
  expect(read).toHaveBeenCalledTimes(2);
  stop(); finish(); await Promise.resolve();
});
it("pauses hidden polling and hints, catches up once on return and cleans up", async () => {
  const { doc, win } = setup();
  const read = vi.fn(async () => {});
  const stop = subscribeSettingsRefresh(read);
  doc.visibilityState = "hidden";
  state.change!({ table: "settings_scoped", reason: "edit" });
  await vi.advanceTimersByTimeAsync(120_000);
  expect(read).not.toHaveBeenCalled();
  doc.visibilityState = "visible";
  doc.dispatchEvent(new Event("visibilitychange"));
  win.dispatchEvent(new Event("focus")); win.dispatchEvent(new Event("resume"));
  await vi.advanceTimersByTimeAsync(150);
  expect(read).toHaveBeenCalledOnce();
  state.signedIn = false;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(read).toHaveBeenCalledOnce();
  state.signedIn = true;
  state.change!({ table: "settings_scoped", reason: "edit" }); stop();
  win.dispatchEvent(new Event("focus"));
  await vi.advanceTimersByTimeAsync(120_000);
  expect(read).toHaveBeenCalledOnce();
  expect(state.change).toBeNull();
});
it("retains a settings change arriving during the initial scope read", async () => {
  setup();
  let finish!: () => void;
  const read = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const stop = subscribeSettingsRefresh(read, undefined, { initial: true });
  state.change!({ table: "settings_scoped", reason: "edit" });
  await vi.advanceTimersByTimeAsync(100);
  expect(read).toHaveBeenCalledOnce();
  finish(); await Promise.resolve();
  expect(read).toHaveBeenCalledTimes(2);
  stop(); finish(); await Promise.resolve();
});
