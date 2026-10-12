import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { runInNewContext } from "node:vm";
import { afterEach, expect, it, vi } from "vitest";
const main = readFileSync("electron/main.cjs", "utf8");
function setup() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(),
  });
  const start = main.indexOf("function runProcess(cmd, args)");
  const source = main.slice(start, main.indexOf("\n/**", start));
  const run = runInNewContext(`${source}; runProcess`, {
    spawn: () => child,
    setTimeout,
    clearTimeout,
  });
  return { child, run };
}
afterEach(() => vi.useRealTimers());
it("returns a failure and terminates a stuck printer helper", async () => {
  vi.useFakeTimers();
  const { child, run } = setup();
  const result = run("printer", []);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(await result).toMatchObject({ ok: false });
  expect(child.kill).toHaveBeenCalledOnce();
});
it("waits for output completion and clears the timeout after a successful write", async () => {
  vi.useFakeTimers();
  const { child, run } = setup();
  const result = run("printer", []);
  child.emit("exit", 0);
  child.stdout.emit("data", "sent:Receipt");
  child.emit("close", 0);
  expect(await result).toEqual({ ok: true, stdout: "sent:Receipt" });
  await vi.advanceTimersByTimeAsync(20_000);
  expect(child.kill).not.toHaveBeenCalled();
});
