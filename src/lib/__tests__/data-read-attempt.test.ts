import { afterEach, expect, it, vi } from "vitest";
import { beginDataReadAttempt, dataReadIdentity, dataSnapshotReady } from "../data-read-attempt";
import { withReadDeadline } from "../read-retry";
afterEach(() => vi.useRealTimers());
it("a retry invalidates a late snapshot even before React effect cleanup", async () => {
  const generation = { current: 0 };
  const first = beginDataReadAttempt(generation);
  let resolve!: (value: string) => void;
  const publish = vi.fn();
  const pending = new Promise<string>(done => { resolve = done; }).then(value => { if (first.current()) publish(value); });
  generation.current++;
  expect(first.current()).toBe(false);
  const retry = beginDataReadAttempt(generation);
  resolve("old branch snapshot"); await pending;
  expect(publish).not.toHaveBeenCalled();
  expect(retry.current()).toBe(true);
});
it("a composite timeout cannot later publish an empty or stale successful snapshot", async () => {
  vi.useFakeTimers();
  const attempt = beginDataReadAttempt({ current: 0 });
  let resolve!: (value: string[]) => void;
  const publish = vi.fn();
  const pending = new Promise<string[]>(done => { resolve = done; });
  const outcome = withReadDeadline(async () => {
    const rows = await pending;
    if (attempt.current()) publish(rows);
  }, 1000).catch(error => { attempt.invalidate(); return error; });
  await vi.advanceTimersByTimeAsync(1000);
  expect(await outcome).toMatchObject({ name: "TimeoutError" });
  resolve(["late product"]); await vi.advanceTimersByTimeAsync(1);
  expect(publish).not.toHaveBeenCalled();
});
it("cleanup and identity replacement invalidate only their own read attempt", () => {
  const generation = { current: 0 };
  const previous = beginDataReadAttempt(generation);
  const current = beginDataReadAttempt(generation);
  previous.invalidate();
  expect(current.current()).toBe(true);
  current.cancel();
  expect(current.current()).toBe(false);
});
it("does not call directory-only success or timed-out first startup a ready business snapshot", () => {
  const identity = dataReadIdentity("cashier", "local", "A");
  expect(dataSnapshotReady(true, true, identity, null)).toBe(false);
  expect(dataSnapshotReady(false, true, identity, identity)).toBe(false);
  expect(dataSnapshotReady(true, true, identity, identity)).toBe(true);
});
it("never reuses a snapshot for a different person, mode or selected branch", () => {
  const snapshot = dataReadIdentity("staff", "online", "A");
  expect(dataSnapshotReady(true, true, dataReadIdentity("staff", "online", "B"), snapshot)).toBe(false);
  expect(dataSnapshotReady(true, true, dataReadIdentity("other", "online", "A"), snapshot)).toBe(false);
  expect(dataSnapshotReady(true, true, dataReadIdentity("staff", "local", "A"), snapshot)).toBe(false);
  expect(dataReadIdentity("staff", "online", " a ")).toBe(snapshot);
});
it("fences a pending old-branch response synchronously before branch-switch cleanup", async () => {
  const generation = { current: 0 };
  const previous = beginDataReadAttempt(generation);
  let resolve!: () => void;
  const publish = vi.fn();
  const pending = new Promise<void>(done => { resolve = done; }).then(() => { if (previous.current()) publish(); });
  generation.current++;
  const current = beginDataReadAttempt(generation);
  resolve(); await pending;
  expect(publish).not.toHaveBeenCalled();
  expect(current.current()).toBe(true);
});
it("resolves an initially unknown branch into one stable scoped identity", () => {
  const unknown = dataReadIdentity("staff", "online", null);
  const resolved = dataReadIdentity("staff", "online", "A");
  expect(resolved).not.toBe(unknown);
  expect(dataReadIdentity("staff", "online", "A")).toBe(resolved);
  expect(dataSnapshotReady(true, true, resolved, unknown)).toBe(false);
});
