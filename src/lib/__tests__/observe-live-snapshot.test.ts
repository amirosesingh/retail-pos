import { expect, it, vi } from "vitest";
import { observeLiveSnapshot } from "../observe-live-snapshot";

it("does not let a delayed initial health response overwrite live readiness", async () => {
  let finish!: (value: string) => void;
  let publish!: (value: string) => void;
  const update = vi.fn();
  const off = vi.fn();
  const stop = observeLiveSnapshot(() => new Promise<string>(resolve => { finish = resolve; }), callback => { publish = callback; return off; }, update);
  publish("ready");
  finish("connecting");
  await Promise.resolve();
  expect(update.mock.calls).toEqual([["ready"]]);
  stop();
  publish("disconnected");
  expect(update).toHaveBeenCalledOnce();
  expect(off).toHaveBeenCalledOnce();
});

it("uses the initial snapshot when there is no newer event", async () => {
  const update = vi.fn();
  const stop = observeLiveSnapshot(async () => "ready", undefined, update);
  await Promise.resolve();
  expect(update).toHaveBeenCalledWith("ready");
  stop();
});
