import { afterEach, expect, it, vi } from "vitest";
import { beginDataReadAttempt, createBootstrapRecovery, createReconnectUrgency, createScopedReadFlight, dataReadIdentity, dataSnapshotReady, needsBootstrapBranchResolution, snapshotRefreshReady } from "../data-read-attempt";
import { withReadDeadline } from "../read-retry";
afterEach(() => vi.useRealTimers());
it("recovers a transient bootstrap after fresh health success without requiring an offline transition", () => {
  let now = 1000;
  const recovery = createBootstrapRecovery(() => now);
  const retry = vi.fn();
  recovery.failed({ status: 503 }, 7);
  const health = (cloud: boolean, at = now, generation = 7) => {
    if (recovery.healthy({ cloud, at }, generation)) retry();
  };
  now = 20_000; health(true);
  expect(retry).not.toHaveBeenCalled();
  now = 31_000; health(false); health(true, 1000); health(true, now, 8);
  expect(retry).not.toHaveBeenCalled();
  health(true); health(true);
  expect(retry).toHaveBeenCalledOnce();
});
it("caps automatic bootstrap recovery when public health succeeds but protected reads still fail", () => {
  let now = 0;
  const recovery = createBootstrapRecovery(() => now);
  for (let cycle = 0; cycle < 4; cycle++) {
    recovery.failed({ code: "57014" }, cycle);
    now += 30_000;
    expect(recovery.healthy({ cloud: true, at: now }, cycle)).toBe(cycle < 2);
  }
  recovery.reset(); // Explicit manual retry or a new person/branch gets a new budget.
  recovery.failed(new DOMException("Read expired", "TimeoutError"), 9);
  now += 30_000;
  expect(recovery.healthy({ cloud: true, at: now }, 9)).toBe(true);
});
it("never automatically retries permission, account, validation or schema failures", () => {
  let now = 0;
  const recovery = createBootstrapRecovery(() => now);
  for (const error of [
    { status: 401 }, { status: 403 }, { code: "42501" }, { code: "23503" },
    new Error("Account disabled"), new Error("Access denied"), { status: 404 },
    { code: "PGRST002", status: 403 }, { code: "PGRST301" }, { code: "PGRST116" },
  ]) {
    recovery.failed({ status: 503 }, 1);
    recovery.failed(error, 1); // A definitive rejection must replace the transient hint.
    now += 30_000;
    expect(recovery.healthy({ cloud: true, at: now }, 1)).toBe(false);
  }
});
it("recovers raw PostgREST connection/pool/schema-cache failures even when the SDK omits HTTP status", () => {
  for (const code of ["PGRST000", "PGRST001", "PGRST002", "PGRST003"]) {
    let now = 0;
    const recovery = createBootstrapRecovery(() => now);
    recovery.failed({ code, message: "Database service unavailable", details: null, hint: null }, 2);
    now = 30_000;
    expect(recovery.healthy({ cloud: true, at: now }, 2)).toBe(true);
  }
});
it("reset or a superseding branch generation cannot retry an earlier failed bootstrap", () => {
  let now = 0;
  const recovery = createBootstrapRecovery(() => now);
  recovery.failed({ status: 503 }, 4);
  now = 30_000;
  expect(recovery.healthy({ cloud: true, at: now }, 5)).toBe(false);
  recovery.reset();
  expect(recovery.healthy({ cloud: true, at: now }, 4)).toBe(false);
});
it("preserves reconnect urgency when focus replaces its debounce timer", async () => {
  vi.useFakeTimers();
  const urgency = createReconnectUrgency();
  const read = vi.fn();
  let timer: ReturnType<typeof setTimeout>;
  const wake = (reconnect: boolean) => {
    urgency.note(reconnect);
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (60_000 >= (urgency.take() ? 5000 : 300_000)) read();
    }, 200);
  };
  wake(true);
  await vi.advanceTimersByTimeAsync(100);
  wake(false);
  await vi.advanceTimersByTimeAsync(200);
  expect(read).toHaveBeenCalledOnce();
  wake(false);
  await vi.advanceTimersByTimeAsync(200);
  expect(read).toHaveBeenCalledOnce();
});
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
it("coalesces concurrent reads only while the exact scoped request is pending", async () => {
  const flights = createScopedReadFlight<string>();
  let resolve!: (value: string) => void;
  const load = vi.fn(() => new Promise<string>(done => { resolve = done; }));
  const first = flights.read("staff:online:A:1", load);
  const second = flights.read("staff:online:A:1", load);
  await Promise.resolve();
  expect(first).toBe(second);
  expect(load).toHaveBeenCalledOnce();
  resolve("fresh snapshot");
  expect(await second).toBe("fresh snapshot");
  const next = vi.fn(async () => "new database value");
  expect(await flights.read("staff:online:A:1", next)).toBe("new database value");
  expect(next).toHaveBeenCalledOnce();
});
it("never shares pending snapshots across people, branches or retry generations", async () => {
  const flights = createScopedReadFlight<string>();
  const loads = [vi.fn(async () => "A"), vi.fn(async () => "B"), vi.fn(async () => "other"), vi.fn(async () => "retry")];
  const result = await Promise.all([
    flights.read("staff:online:A:1", loads[0]),
    flights.read("staff:online:B:1", loads[1]),
    flights.read("other:online:A:1", loads[2]),
    flights.read("staff:online:A:2", loads[3]),
  ]);
  expect(result).toEqual(["A", "B", "other", "retry"]);
  for (const load of loads) expect(load).toHaveBeenCalledOnce();
});
it("does not cache a rejected request or prevent a later retry", async () => {
  const flights = createScopedReadFlight<string>();
  await expect(flights.read("A", async () => { throw new Error("database timeout"); })).rejects.toThrow("database timeout");
  expect(await flights.read("A", async () => "recovered")).toBe("recovered");
});
it("keeps foreground and reconciliation requests behind the matching initial snapshot", async () => {
  const identity = dataReadIdentity("staff", "online", "A");
  const read = vi.fn(async () => "snapshot");
  const flights = createScopedReadFlight<string>();
  for (const phase of ["loading", "stalled", "failed"])
    expect(snapshotRefreshReady(true, phase, identity, identity)).toBe(false);
  expect(snapshotRefreshReady(true, "ready", identity, null)).toBe(false);
  expect(snapshotRefreshReady(true, "ready", identity, dataReadIdentity("staff", "online", "B"))).toBe(false);
  expect(snapshotRefreshReady(false, "ready", identity, identity)).toBe(false);
  const ready = snapshotRefreshReady(true, "ready", identity, identity);
  expect(ready).toBe(true);
  const results = await Promise.all([ready && flights.read(identity!, read), ready && flights.read(identity!, read)]);
  expect(results).toEqual(["snapshot", "snapshot"]);
  expect(read).toHaveBeenCalledOnce();
});
it("defers only an unscoped online bootstrap and keeps the resolved branch stable", async () => {
  let branch: string | null = null;
  const catalogue = vi.fn(async (_branch: string | null) => "catalogue");
  const directory = vi.fn(async () => "A");
  const bootstrap = async () => {
    if (needsBootstrapBranchResolution("online", branch, true)) { branch = await directory(); return; }
    return catalogue(branch);
  };
  await bootstrap();
  expect(catalogue).not.toHaveBeenCalled();
  const identity = dataReadIdentity("staff", "online", branch);
  await bootstrap();
  expect(directory).toHaveBeenCalledOnce();
  expect(catalogue).toHaveBeenCalledExactlyOnceWith("A");
  expect(dataReadIdentity("staff", "online", branch)).toBe(identity);
  expect(needsBootstrapBranchResolution("online", "A", true)).toBe(false);
  expect(needsBootstrapBranchResolution("local", null, true)).toBe(false);
  expect(needsBootstrapBranchResolution("online", null, false)).toBe(false);
});
