import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { runInNewContext } from "node:vm";
import { afterEach, expect, it, vi } from "vitest";
const main = readFileSync("electron/main.cjs", "utf8");
function setup(readiness: Promise<boolean>) {
  const contents = Object.assign(new EventEmitter(), {
    setWindowOpenHandler: vi.fn(),
    executeJavaScript: vi.fn(() => readiness),
    print: vi.fn((_options, callback) => callback(true)),
  });
  const window = { webContents: contents, isDestroyed: () => false, destroy: vi.fn(), loadURL: vi.fn(async () => {}) };
  const create = vi.fn(function (_options: { webPreferences: { backgroundThrottling: boolean } }) { return window; });
  const start = main.indexOf("function printSilent(");
  const source = main.slice(start, main.indexOf("\n/**", start));
  const print = runInNewContext(`${source}; printSilent`, { BrowserWindow: create, PAGE_SIZES: { "80mm": { width: 80000, height: 297000 } }, setTimeout, clearTimeout });
  return { print, contents, window, create };
}
afterEach(() => vi.useRealTimers());
it("waits for rendering before sending a hidden direct-print job", async () => {
  let complete!: (ready: boolean) => void;
  const run = setup(new Promise(resolve => { complete = resolve; }));
  const result = run.print("<body>Receipt 123</body>", "Printer", "80mm", false);
  run.contents.emit("did-finish-load");
  expect(run.contents.print).not.toHaveBeenCalled();
  expect(run.create.mock.calls[0][0].webPreferences.backgroundThrottling).toBe(false);
  complete(true);
  expect(await result).toEqual({ ok: true });
  expect(run.contents.print.mock.calls[0][0]).toMatchObject({ silent: true, deviceName: "Printer" });
  expect(run.window.destroy).toHaveBeenCalledOnce();
});
it("refuses a blank document instead of sending a blank sheet", async () => {
  const run = setup(Promise.resolve(false));
  const result = run.print("<body></body>", "Printer", "80mm", false);
  run.contents.emit("did-finish-load");
  expect(await result).toMatchObject({ ok: false, error: expect.stringContaining("no visible content") });
  expect(run.contents.print).not.toHaveBeenCalled();
});
it("times out a stuck renderer without sending a late duplicate print", async () => {
  vi.useFakeTimers();
  let complete!: (ready: boolean) => void;
  const run = setup(new Promise(resolve => { complete = resolve; }));
  const result = run.print("<body>Receipt</body>", "Printer", "80mm", false);
  run.contents.emit("did-finish-load");
  await vi.advanceTimersByTimeAsync(60_000);
  expect(await result).toMatchObject({ ok: false });
  complete(true);
  await Promise.resolve();
  expect(run.contents.print).not.toHaveBeenCalled();
  expect(run.window.destroy).toHaveBeenCalledOnce();
});
