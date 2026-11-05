import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createTelemetry } = require("../../../electron/telemetry.cjs");

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function flush() {
  for (let index = 0; index < 12; index++) await Promise.resolve();
}

const counts = { recordsets: [[{ schema_version: 7 }], [{ pending: 5 }], [{ conflicts: 2 }], [{ failed: 3 }]] };
const instances: { stop(): void }[] = [];

function fixture() {
  const cancel = vi.fn(async () => {});
  const response = { body: { cancel }, ok: true, status: 200 };
  const fetcher = vi.fn(async (_url: string, _init: RequestInit) => response);
  vi.stubGlobal("fetch", fetcher);
  const activeJob = vi.fn(async () => ({ current_table: "products" }));
  const query = vi.fn(async () => counts);
  const request = vi.fn(() => ({ query }));
  const config = { backendUrl: "https://telemetry.invalid/" };
  const terminal = { tokenId: "synthetic-terminal", storeId: "synthetic-branch", terminalName: "Synthetic till", storeCode: "SYN" };
  const telemetry = createTelemetry({
    databaseService: { snapshot: () => ({ enabled: true, connected: true, state: "enabled_ready", profile: { database: "fixture" } }), manager: { pool: { request } } },
    syncCoordinator: { snapshot: () => ({ failed: 99, lastPushAt: "2026-11-02T01:00:00Z", lastPullAt: "2026-11-02T02:00:00Z", phase: "idle" }) },
    jobRepository: { active: activeJob }, configStore: { get: () => config.backendUrl },
    terminalStore: { read: () => terminal }, app: { getVersion: () => "0.0.0-test" },
  });
  instances.push(telemetry);
  return { telemetry, fetcher, cancel, response, activeJob, query, request, config, terminal };
}

const payload = (fetcher: ReturnType<typeof fixture>["fetcher"], index = 0) => JSON.parse(String(fetcher.mock.calls[index][1].body));

describe("native telemetry lifecycle", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-02T03:00:00Z")); });
  afterEach(async () => {
    instances.splice(0).forEach(instance => instance.stop());
    await flush();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("coalesces the whole beat before start and sends the latest presence after a slow job read", async () => {
    const f = fixture();
    const job = deferred<{ current_table: string }>();
    f.activeJob.mockReturnValueOnce(job.promise);
    const first = f.telemetry.beat();
    expect(f.telemetry.beat()).toBe(first);
    await flush();
    expect(f.activeJob).toHaveBeenCalledOnce();
    expect(f.telemetry.setPresence({ sessionStatus: "signed_in", staffName: "Old", staffRole: "cashier" })).toEqual({ ok: true });
    f.telemetry.setPresence({ sessionStatus: "signed_in", staffName: "Latest", staffRole: "manager" });
    expect(f.query).not.toHaveBeenCalled();
    expect(f.fetcher).not.toHaveBeenCalled();
    job.resolve({ current_table: "sales" });
    await first;
    await flush();
    expect(f.query).toHaveBeenCalledOnce();
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(f.fetcher.mock.calls[0][0]).toBe("https://telemetry.invalid/api/v1/pos/sync");
    expect(payload(f.fetcher)).toEqual({ terminalToken: "synthetic-terminal", sqlServerTelemetry: {
      terminal_id: "synthetic-terminal", store_id: "synthetic-branch", terminal_name: "Synthetic till", branch_code: "SYN",
      session_status: "signed_in", staff_name: "Latest", staff_role: "manager", db_mode: "local", connection_status: "local",
      storage_engine: "sqlserver", pending_count: 5, conflict_count: 2, failed_count: 3,
      last_synced_at: "2026-11-02T02:00:00Z", last_push_at: "2026-11-02T01:00:00Z", last_pull_at: "2026-11-02T02:00:00Z",
      app_version: "0.0.0-test", platform: "win32", sql_server_state: "enabled_ready", database_name: "fixture", schema_version: 7,
      sync_phase: "idle", current_table: "sales", last_seen_at: "2026-11-02T03:00:00.000Z",
    } });
    expect(f.cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("absorbs periodic ticks during slow SQL without queuing an endless chain", async () => {
    const f = fixture();
    const sql = deferred<typeof counts>();
    f.query.mockReturnValueOnce(sql.promise);
    f.telemetry.start();
    f.telemetry.start();
    await flush();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(f.activeJob).toHaveBeenCalledOnce();
    expect(f.query).toHaveBeenCalledOnce();
    expect(f.fetcher).not.toHaveBeenCalled();
    f.telemetry.setPresence({ sessionStatus: "signed_in", staffName: "Latest" });
    sql.resolve(counts);
    await flush();
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(payload(f.fetcher).sqlServerTelemetry.staff_name).toBe("Latest");
    await vi.advanceTimersByTimeAsync(59_999);
    expect(f.fetcher).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
  });

  it("sends one latest sign-out after an in-flight HTTP request and absorbs identical calls", async () => {
    const f = fixture();
    const http = deferred<typeof f.response>();
    f.fetcher.mockReturnValueOnce(http.promise);
    f.telemetry.setPresence({ sessionStatus: "signed_in", staffName: "Cashier" });
    const first = f.telemetry.beat();
    await flush();
    f.telemetry.setPresence({ sessionStatus: "signed_in", staffName: "Manager" });
    f.telemetry.setPresence({ sessionStatus: "idle" });
    f.telemetry.setPresence({ sessionStatus: "idle" });
    for (let index = 0; index < 20; index++) expect(f.telemetry.beat()).toBe(first);
    expect(f.fetcher).toHaveBeenCalledOnce();
    http.resolve(f.response);
    await first;
    await flush();
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    expect(payload(f.fetcher, 1).sqlServerTelemetry).toMatchObject({ session_status: "idle", staff_name: null, staff_role: null });
    expect(f.query).toHaveBeenCalledTimes(2);
    await flush();
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps ownership through response cleanup and cancels HTTP error bodies", async () => {
    const f = fixture();
    const cleanup = deferred<void>();
    f.cancel.mockReturnValueOnce(cleanup.promise);
    f.fetcher.mockResolvedValueOnce({ ...f.response, ok: false, status: 503 });
    const first = f.telemetry.beat();
    await flush();
    expect(f.cancel).toHaveBeenCalledOnce();
    f.telemetry.setPresence({ sessionStatus: "signed_in", staffName: "After headers" });
    await flush();
    expect(f.fetcher).toHaveBeenCalledOnce();
    cleanup.resolve();
    await first;
    await flush();
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    expect(payload(f.fetcher, 1).sqlServerTelemetry.staff_name).toBe("After headers");
    expect(f.cancel).toHaveBeenCalledTimes(2);
  });

  it("does not create a trailing request from identical presence and ordinary beat calls", async () => {
    const f = fixture();
    const http = deferred<typeof f.response>();
    f.fetcher.mockReturnValueOnce(http.promise);
    const first = f.telemetry.beat();
    await flush();
    for (let index = 0; index < 5; index++) {
      f.telemetry.setPresence({ sessionStatus: "idle" });
      f.telemetry.beat();
    }
    http.resolve(f.response);
    await first;
    await flush();
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(f.activeJob).toHaveBeenCalledOnce();
  });

  it("fences a late job read on stop and retains presence for a later start", async () => {
    const f = fixture();
    const job = deferred<{ current_table: string }>();
    f.activeJob.mockReturnValueOnce(job.promise);
    f.telemetry.start();
    const first = f.telemetry.beat();
    await flush();
    f.telemetry.stop();
    f.telemetry.setPresence({ sessionStatus: "signed_in", staffName: "Restarted" });
    await f.telemetry.beat();
    job.resolve({ current_table: "stale" });
    await first;
    expect(f.query).not.toHaveBeenCalled();
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    f.telemetry.start();
    await flush();
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(payload(f.fetcher).sqlServerTelemetry.staff_name).toBe("Restarted");
  });

  it.each(["job", "sql"])("waits for old %s reads to settle before restarting without overlapping SQL", async stage => {
    const f = fixture();
    const gate = deferred<never>();
    if (stage === "job") f.activeJob.mockReturnValueOnce(gate.promise);
    else f.query.mockReturnValueOnce(gate.promise);
    f.telemetry.start();
    const first = f.telemetry.beat();
    await flush();
    f.telemetry.stop();
    f.telemetry.start();
    f.telemetry.start();
    f.telemetry.setPresence({ sessionStatus: "signed_in", staffName: "Current generation" });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(f.activeJob).toHaveBeenCalledOnce();
    expect(f.query).toHaveBeenCalledTimes(stage === "job" ? 0 : 1);
    expect(f.fetcher).not.toHaveBeenCalled();
    gate.reject(new Error("old local read failed"));
    await first;
    await flush();
    expect(f.activeJob).toHaveBeenCalledTimes(2);
    expect(f.query).toHaveBeenCalledTimes(stage === "job" ? 1 : 2);
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(payload(f.fetcher).sqlServerTelemetry.staff_name).toBe("Current generation");
    expect(vi.getTimerCount()).toBe(1);
  });

  it("aborts HTTP on stop, drops its trailing presence request and can restart", async () => {
    const f = fixture();
    f.fetcher.mockImplementationOnce(async (_url, init) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
    }));
    f.telemetry.start();
    const first = f.telemetry.beat();
    await flush();
    f.telemetry.setPresence({ sessionStatus: "signed_in", staffName: "Latest" });
    f.telemetry.stop();
    expect(f.fetcher.mock.calls[0][1].signal!.aborted).toBe(true);
    await first;
    await vi.advanceTimersByTimeAsync(180_000);
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    f.telemetry.start();
    await flush();
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    expect(payload(f.fetcher, 1).sqlServerTelemetry.staff_name).toBe("Latest");
  });

  it("keeps an aborted old run owned until it settles and fences its finalizer from the new deadline", async () => {
    const f = fixture();
    const oldHttp = deferred<typeof f.response>();
    f.fetcher.mockReturnValueOnce(oldHttp.promise).mockImplementationOnce(async (_url, init) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
    }));
    f.telemetry.start();
    const first = f.telemetry.beat();
    await flush();
    f.telemetry.stop();
    f.telemetry.start();
    await flush();
    expect(f.fetcher).toHaveBeenCalledOnce();
    oldHttp.resolve(f.response);
    await first;
    await flush();
    expect(f.cancel).toHaveBeenCalledOnce();
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    const restartedSignal = f.fetcher.mock.calls[1][1].signal!;
    expect(restartedSignal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(restartedSignal.aborted).toBe(true);
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
  });

  it.each(["headers", "body"])("bounds slow %s and recovers on the next beat without an immediate retry", async stage => {
    const f = fixture();
    f.fetcher.mockImplementationOnce(async (_url, init) => {
      const untilAbort = () => new Promise<never>((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
      });
      if (stage === "headers") return untilAbort();
      return { ...f.response, body: { cancel: vi.fn(untilAbort) } };
    });
    const first = f.telemetry.beat();
    await flush();
    const signal = f.fetcher.mock.calls[0][1].signal!;
    await vi.advanceTimersByTimeAsync(29_999);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal.aborted).toBe(true);
    await first;
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    await f.telemetry.beat();
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    expect(f.cancel).toHaveBeenCalledOnce();
  });

  it("bounds a cancellation promise that ignores abort and observes its late rejection", async () => {
    const f = fixture();
    const cleanup = deferred<void>();
    f.cancel.mockReturnValueOnce(cleanup.promise);
    const first = f.telemetry.beat();
    await flush();
    const signal = f.fetcher.mock.calls[0][1].signal!;
    expect(f.cancel).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(signal.aborted).toBe(true);
    await first;
    expect(vi.getTimerCount()).toBe(0);
    cleanup.reject(new Error("late stream cancellation failure"));
    await flush();
    await f.telemetry.beat();
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["resolve", "reject"])("restarts after stopping uncooperative body cleanup and ignores its late %s", async outcome => {
    const f = fixture();
    const cleanup = deferred<void>();
    f.cancel.mockReturnValueOnce(cleanup.promise);
    f.telemetry.start();
    const first = f.telemetry.beat();
    await flush();
    const signal = f.fetcher.mock.calls[0][1].signal!;
    f.telemetry.setPresence({ sessionStatus: "signed_in", staffName: "Restart latest" });
    f.telemetry.stop();
    f.telemetry.start();
    await first;
    await flush();
    expect(signal.aborted).toBe(true);
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    expect(payload(f.fetcher, 1).sqlServerTelemetry.staff_name).toBe("Restart latest");
    if (outcome === "resolve") cleanup.resolve();
    else cleanup.reject(new Error("old cleanup failed after restart"));
    await flush();
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
  });

  it.each(["job", "sql", "fetch", "cleanup"])("keeps %s failures non-blocking and releases ownership for recovery", async stage => {
    const f = fixture();
    const error = new Error("synthetic failure");
    if (stage === "job") f.activeJob.mockRejectedValueOnce(error);
    if (stage === "sql") f.query.mockRejectedValueOnce(error);
    if (stage === "fetch") f.fetcher.mockRejectedValueOnce(error);
    if (stage === "cleanup") f.cancel.mockRejectedValueOnce(error);
    await expect(f.telemetry.beat()).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    await expect(f.telemetry.beat()).resolves.toBeUndefined();
    expect(f.cancel).toHaveBeenCalledTimes(stage === "cleanup" ? 2 : 1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("skips unconfigured telemetry before local reads and accepts empty response bodies", async () => {
    const f = fixture();
    f.config.backendUrl = "";
    await f.telemetry.beat();
    expect(f.activeJob).not.toHaveBeenCalled();
    expect(f.fetcher).not.toHaveBeenCalled();
    f.config.backendUrl = "https://telemetry.invalid";
    f.fetcher.mockResolvedValueOnce(new Response(null, { status: 204 }) as unknown as typeof f.response);
    await expect(f.telemetry.beat()).resolves.toBeUndefined();
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
