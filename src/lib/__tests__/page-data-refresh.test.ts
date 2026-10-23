import { afterEach, expect, it, vi } from "vitest";
const hooks = vi.hoisted(() => ({
  change: null as null | ((change: { table: string }) => void),
  wake: null as null | (() => void), offData: vi.fn(), offCatchup: vi.fn(),
}));
vi.mock("../sync-engine", () => ({ subscribeDataChange: (fn: typeof hooks.change) => {
  hooks.change = fn; return hooks.offData;
} }));
vi.mock("../session-presence", () => ({ hasSignedInIdentity: () => true }));
vi.mock("@/core/activation/connection-health", () => ({ APP_RESUME_EVENT: "resume" }));
vi.mock("../background-refresh", async importOriginal => ({
  ...await importOriginal<typeof import("../background-refresh")>(),
  subscribeBackgroundRefresh: (fn: () => void) => { hooks.wake = fn; return hooks.offCatchup; },
}));
import { subscribePageDataRefresh } from "../page-data-refresh";
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
it("keeps a foreground catch-up behind the initial load", async () => {
  let finish!: () => void;
  const read = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const stop = subscribePageDataRefresh(read, ["sales"], { initial: true });
  hooks.wake!();
  expect(read).toHaveBeenCalledTimes(1);
  finish(); await Promise.resolve();
  expect(read).toHaveBeenCalledTimes(2);
  stop(); finish(); await Promise.resolve();
});
it("batches related changes, ignores unrelated tables and serializes in-flight reads", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("document", { visibilityState: "visible" });
  vi.stubGlobal("navigator", { onLine: true });
  let finish!: () => void;
  const read = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const stop = subscribePageDataRefresh(read, ["sales"]);
  hooks.change!({ table: "products" }); await vi.advanceTimersByTimeAsync(100);
  expect(read).not.toHaveBeenCalled();
  hooks.change!({ table: "sales" }); hooks.change!({ table: "sales" });
  await vi.advanceTimersByTimeAsync(100);
  expect(read).toHaveBeenCalledTimes(1);
  hooks.wake!(); hooks.wake!();
  expect(read).toHaveBeenCalledTimes(1);
  finish(); await Promise.resolve();
  expect(read).toHaveBeenCalledTimes(2);
  stop(); finish(); await Promise.resolve();
  expect(hooks.offData).toHaveBeenCalledOnce();
  expect(hooks.offCatchup).toHaveBeenCalledOnce();
});
it("pauses hidden change reads and catches up on resume", async () => {
  vi.useFakeTimers();
  const doc = { visibilityState: "hidden" };
  vi.stubGlobal("document", doc);
  vi.stubGlobal("navigator", { onLine: true });
  const read = vi.fn(async () => {});
  const stop = subscribePageDataRefresh(read, ["sales"]);
  hooks.change!({ table: "sales" }); await vi.advanceTimersByTimeAsync(100);
  expect(read).not.toHaveBeenCalled();
  doc.visibilityState = "visible";
  hooks.wake!(); await Promise.resolve();
  expect(read).toHaveBeenCalledOnce();
  hooks.change!({ table: "sales" }); stop();
  await vi.advanceTimersByTimeAsync(100);
  expect(read).toHaveBeenCalledOnce();
});
