import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { createScopedSettingsReader, scopedSettingsReadKey, type ScopedSettingsReadStatus } from "../scoped-settings-read";
import { createScopedReadFlight } from "../data-read-attempt";
import { createRefreshQueue } from "../background-refresh";
import { __resetSessionEpoch, bumpSessionEpoch } from "../session-epoch";

const mocks = vi.hoisted(() => ({ query: vi.fn(), bridge: vi.fn(), client: vi.fn() }));
vi.mock("@/core/api/db-router", () => ({ dbRouter: { query: mocks.query } }));
vi.mock("@/core/local-db/local-db", () => ({ localDb: mocks.bridge }));
vi.mock("@/integrations/supabase/external-client", () => ({ authenticatedExternalClientSnapshot: mocks.client }));
import { emptyBranchSettings, loadBranchSettings } from "../branch-settings";
const require = createRequire(import.meta.url);
const privilege = require("../../../electron/ipc-privilege.cjs");
const session = require("../../../electron/admin-session.cjs");

const ids = { CLUSTER: "cluster-a", BRANCH: "branch-a", TERMINAL: "terminal-a" };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(confirmed = false) {
  const read = vi.fn<() => Promise<unknown>>().mockResolvedValue({ saved: true });
  const writes = { pending: false, revision: 0 };
  const current = { value: true };
  const accept = vi.fn();
  const states: ScopedSettingsReadStatus[] = [];
  const reader = createScopedSettingsReader({ read, writes, isCurrent: () => current.value, accept, status: next => states.push(next), confirmed });
  return { read, writes, current, accept, states, reader };
}
beforeEach(() => { __resetSessionEpoch(); vi.useFakeTimers(); mocks.query.mockReset().mockResolvedValue([]); mocks.bridge.mockReset().mockReturnValue(null); mocks.client.mockReset(); });
afterEach(() => { __resetSessionEpoch(); session.clear(); vi.clearAllTimers(); vi.useRealTimers(); });

describe("initial scoped settings readiness", () => {
  it("keeps native cashier scope reads separate from settings editing in the installed IPC gate", () => {
    session.grant("staff", "cashier-a", { can_process_sale: true, can_access_pos_settings: false }, "pos", "branch-a");
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const ipc = { handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler) };
    privilege.install(ipc, { isFirstRun: () => false, isManagementDevice: () => false });
    const read = vi.fn(() => ({ ok: true, rows: [] }));
    ipc.handle("business:query", read);
    ipc.handle("settings:set", vi.fn());
    for (const table of ["settings_overrides", "settings_locks"])
      expect(handlers.get("business:query")?.({}, table, {})).toEqual({ ok: true, rows: [] });
    expect(read).toHaveBeenCalledTimes(2);
    expect(handlers.get("settings:set")?.({}, "pos.settings", {})).toMatchObject({ ok: false });
  });

  it("waits for all overrides and locks, including a genuinely empty saved scope", async () => {
    const lock = deferred<unknown[]>();
    mocks.query.mockImplementation((table: string) => table === "settings_locks" ? lock.promise : Promise.resolve([]));
    const f = fixture();
    f.read.mockImplementation(() => loadBranchSettings(ids, true));
    const pending = f.reader.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.states).toEqual([{ phase: "loading", error: null }]);
    expect(f.accept).not.toHaveBeenCalled();
    lock.resolve([]); await pending;
    expect(f.accept).toHaveBeenCalledExactlyOnceWith(emptyBranchSettings);
    expect(f.states.at(-1)).toEqual({ phase: "ready", error: null });
  });

  it("allows the existing scoped reader for a cashier without any settings-edit permission check", async () => {
    const f = fixture();
    f.read.mockImplementation(() => loadBranchSettings(ids, true));
    await f.reader.refresh();
    expect(mocks.query.mock.calls).toEqual([
      ["settings_overrides", expect.objectContaining({ match: { scope: "CLUSTER", scope_id: "cluster-a" } })],
      ["settings_overrides", expect.objectContaining({ match: { scope: "BRANCH", scope_id: "branch-a" } })],
      ["settings_overrides", expect.objectContaining({ match: { scope: "TERMINAL", scope_id: "terminal-a" } })],
      ["settings_locks", expect.objectContaining({ columns: "section,locked" })],
    ]);
    expect(f.states.at(-1)?.phase).toBe("ready");
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it("uses the selected branch's existing local routed read without waiting for central authority", async () => {
    mocks.bridge.mockReturnValue({ query: vi.fn() });
    const f = fixture();
    f.read.mockImplementation(() => loadBranchSettings(ids, true));
    await f.reader.refresh();
    expect(mocks.query).toHaveBeenCalledTimes(4);
    expect(mocks.client).not.toHaveBeenCalled();
    expect(f.states.at(-1)?.phase).toBe("ready");
  });

  it("shows a definitive read denial and never treats substituted defaults as verified", async () => {
    mocks.query.mockRejectedValue(Object.assign(new Error("denied"), { code: "42501" }));
    const f = fixture();
    f.read.mockImplementation(() => loadBranchSettings(ids, true));
    await f.reader.refresh();
    expect(f.accept).not.toHaveBeenCalled();
    expect(f.states.at(-1)).toMatchObject({ phase: "failed", error: expect.stringContaining("could not be loaded") });
  });

  it("shows the 15-second deadline while the raw read stays pending, then recovers on its late answer", async () => {
    const stalled = deferred<unknown>();
    const f = fixture(); f.read.mockReturnValueOnce(stalled.promise);
    const pending = f.reader.refresh();
    const settled = vi.fn(); void pending.then(settled);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(f.states.at(-1)).toMatchObject({ phase: "failed", error: expect.stringContaining("too long") });
    expect(f.accept).not.toHaveBeenCalled();
    expect(settled).not.toHaveBeenCalled();
    expect(f.reader.refresh()).toBe(pending);
    expect(f.read).toHaveBeenCalledTimes(1);
    stalled.resolve({ late: true }); await pending;
    expect(f.states.at(-1)).toEqual({ phase: "ready", error: null });
    expect(f.accept).toHaveBeenCalledExactlyOnceWith({ late: true });
  });

  it("coalesces direct concurrent refreshes so an older read cannot overwrite a newer answer", async () => {
    const f = fixture(); const first = deferred<unknown>(); f.read.mockReturnValueOnce(first.promise);
    const a = f.reader.refresh(); const b = f.reader.refresh();
    expect(a).toBe(b);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.read).toHaveBeenCalledTimes(1);
    first.resolve({ version: 1 }); await a;
    f.read.mockResolvedValueOnce({ version: 2 }); await f.reader.refresh();
    expect(f.accept.mock.calls).toEqual([[{ version: 1 }], [{ version: 2 }]]);
  });

  it("shares the provider's raw composite after a timeout/recreated Retry, then permits a fresh settled read", async () => {
    const locks = deferred<unknown[]>();
    mocks.query.mockImplementation((table: string) => table === "settings_locks" ? locks.promise : Promise.resolve([]));
    const flights = createScopedReadFlight<typeof emptyBranchSettings>();
    const writes = { pending: false, revision: 0 };
    const key = scopedSettingsReadKey("cashier-a|local", ids);
    const raw = vi.fn(() => loadBranchSettings(ids, true));
    const accepted = vi.fn();
    const observe = () => createScopedSettingsReader({
      read: () => flights.read(JSON.stringify([key, writes.revision]), raw), writes,
      isCurrent: () => true, accept: accepted, status: vi.fn(),
    });
    const old = observe(); const oldRead = old.refresh();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(mocks.query).toHaveBeenCalledTimes(4);
    old.stop();
    const next = observe(); const nextRead = next.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(raw).toHaveBeenCalledTimes(1);
    expect(mocks.query).toHaveBeenCalledTimes(4);
    locks.resolve([]); await Promise.all([oldRead, nextRead]);
    expect(accepted).toHaveBeenCalledExactlyOnceWith(emptyBranchSettings);
    await next.refresh();
    expect(raw).toHaveBeenCalledTimes(2);
    expect(mocks.query).toHaveBeenCalledTimes(8);
  });

  it("keeps one real trailing remote change queued through the UI deadline until raw settlement", async () => {
    const f = fixture(); const first = deferred<unknown>(); f.read.mockReturnValueOnce(first.promise);
    const queue = createRefreshQueue(f.reader.refresh);
    const initial = queue.refresh();
    await vi.advanceTimersByTimeAsync(15_000);
    await queue.refresh(); await queue.refresh(); await queue.refresh();
    expect(f.read).toHaveBeenCalledTimes(1);
    first.resolve({ initial: true }); await initial;
    expect(f.read).toHaveBeenCalledTimes(2);
    expect(f.accept.mock.calls).toEqual([[{ initial: true }], [{ saved: true }]]);
    queue.stop();
  });

  it("retains a genuine hint through timeout and in-place Retry, then reads the fresh trailing value serially", async () => {
    const first = deferred<unknown>();
    const raw = vi.fn<() => Promise<unknown>>().mockReturnValueOnce(first.promise).mockResolvedValue({ fresh: true });
    const flights = createScopedReadFlight<unknown>();
    const f = fixture(); const key = scopedSettingsReadKey("cashier-a|local", ids);
    f.read.mockImplementation(() => flights.read(JSON.stringify([key, f.writes.revision]), raw));
    const queue = createRefreshQueue(f.reader.refresh);
    const initial = queue.refresh();
    await vi.advanceTimersByTimeAsync(0);
    await queue.refresh(); // A genuine change arrives during the first read.
    await vi.advanceTimersByTimeAsync(15_000);
    expect(f.states.at(-1)?.phase).toBe("failed");
    f.reader.retryStatus(); await queue.retry();
    expect(f.states.at(-1)).toEqual({ phase: "loading", error: null });
    expect(raw).toHaveBeenCalledTimes(1);
    first.resolve({ priorToHint: true }); await initial;
    expect(raw).toHaveBeenCalledTimes(2);
    expect(f.accept.mock.calls).toEqual([[{ priorToHint: true }], [{ fresh: true }]]);
    expect(f.states.at(-1)).toEqual({ phase: "ready", error: null });
    queue.stop();
  });

  it("routes Retry after a completed failure through the same queue so the next hint still gets a trailing read", async () => {
    const second = deferred<unknown>();
    const raw = vi.fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockReturnValueOnce(second.promise)
      .mockResolvedValue({ fresh: true });
    const flights = createScopedReadFlight<unknown>();
    const f = fixture(); const key = scopedSettingsReadKey("cashier-a|local", ids);
    f.read.mockImplementation(() => flights.read(JSON.stringify([key, f.writes.revision]), raw));
    const queue = createRefreshQueue(f.reader.refresh);
    await queue.refresh();
    expect(f.states.at(-1)?.phase).toBe("failed");
    f.reader.retryStatus(); const retry = queue.retry();
    await vi.advanceTimersByTimeAsync(0);
    await queue.refresh();
    expect(raw).toHaveBeenCalledTimes(2);
    second.resolve({ beforeNewHint: true }); await retry;
    expect(raw).toHaveBeenCalledTimes(3);
    expect(f.accept.mock.calls).toEqual([[{ beforeNewHint: true }], [{ fresh: true }]]);
    queue.stop();
  });

  it("rearms the UI deadline without creating a trailing query when Retry has no genuine hint", async () => {
    const f = fixture(); const first = deferred<unknown>(); f.read.mockReturnValue(first.promise);
    const queue = createRefreshQueue(f.reader.refresh); const initial = queue.refresh();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(f.states.at(-1)?.phase).toBe("failed");
    f.reader.retryStatus(); await queue.retry();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(f.states.at(-1)?.phase).toBe("loading");
    await vi.advanceTimersByTimeAsync(1);
    expect(f.states.at(-1)?.phase).toBe("failed");
    first.resolve({ late: true }); await initial;
    expect(f.read).toHaveBeenCalledTimes(1);
    expect(f.accept).toHaveBeenCalledExactlyOnceWith({ late: true });
    queue.stop();
  });

  it("does not treat a late permission failure as a successful answer", async () => {
    const f = fixture(); const first = deferred<unknown>(); f.read.mockReturnValue(first.promise);
    const pending = f.reader.refresh();
    await vi.advanceTimersByTimeAsync(15_000);
    first.reject(Object.assign(new Error("denied"), { code: "42501" })); await pending;
    expect(f.accept).not.toHaveBeenCalled();
    expect(f.states.at(-1)).toMatchObject({ phase: "failed", error: expect.stringContaining("could not be loaded") });
  });

  it.each([false, true])("preserves confirmed same-scope settings after a background failure (already confirmed: %s)", async confirmed => {
    const f = fixture(confirmed);
    if (!confirmed) await f.reader.refresh();
    const count = f.states.length;
    f.read.mockRejectedValue(new Error("disconnected"));
    await f.reader.refresh();
    expect(f.states).toHaveLength(count);
    expect(f.states.every(state => state.phase !== "failed")).toBe(true);
  });

  it("does not regress confirmed settings to loading during a background read", async () => {
    const f = fixture(); await f.reader.refresh();
    const pending = deferred<unknown>(); f.read.mockReturnValue(pending.promise);
    const refresh = f.reader.refresh();
    expect(f.states.at(-1)?.phase).toBe("ready");
    pending.resolve({ updated: true }); await refresh;
    expect(f.accept).toHaveBeenLastCalledWith({ updated: true });
  });

  it.each(["identity changed", "effect stopped"])("discards an older completion when %s", async reason => {
    const f = fixture(); const pending = deferred<unknown>(); f.read.mockReturnValue(pending.promise);
    const refresh = f.reader.refresh(); await vi.advanceTimersByTimeAsync(0);
    if (reason === "identity changed") f.current.value = false;
    else f.reader.stop();
    pending.resolve({ stale: true }); await refresh;
    expect(f.accept).not.toHaveBeenCalled();
    expect(f.states).toEqual([{ phase: "loading", error: null }]);
  });

  it("does not overwrite a settings edit begun during the read", async () => {
    const f = fixture(); const pending = deferred<unknown>(); f.read.mockReturnValue(pending.promise);
    const refresh = f.reader.refresh(); await vi.advanceTimersByTimeAsync(0);
    f.writes.revision++; pending.resolve({ stale: true }); await refresh;
    expect(f.accept).not.toHaveBeenCalled();
    expect(f.states.at(-1)?.phase).toBe("failed");
  });

  it("a new write revision gets a separate raw read, while the older revision cannot publish", async () => {
    const f = fixture(); const first = deferred<unknown>(); const flights = createScopedReadFlight<unknown>();
    const raw = vi.fn<() => Promise<unknown>>().mockReturnValueOnce(first.promise).mockResolvedValue({ newest: true });
    const key = scopedSettingsReadKey("cashier-a|local", ids);
    f.read.mockImplementation(() => flights.read(JSON.stringify([key, f.writes.revision]), raw));
    const initial = f.reader.refresh(); await vi.advanceTimersByTimeAsync(0);
    f.writes.revision++;
    const newer = createScopedSettingsReader({ read: f.read, writes: f.writes, isCurrent: () => true, accept: f.accept, status: next => f.states.push(next) });
    await newer.refresh(); expect(raw).toHaveBeenCalledTimes(2);
    first.resolve({ stale: true }); await initial;
    expect(f.accept).toHaveBeenCalledExactlyOnceWith({ newest: true });
  });

  it("cannot confirm or accept old settings after the same account signs in again", async () => {
    const oldKey = scopedSettingsReadKey("cashier-a|local", ids);
    const f = fixture(); const first = deferred<unknown>(); f.read.mockReturnValue(first.promise);
    const pending = f.reader.refresh(); await vi.advanceTimersByTimeAsync(0);
    bumpSessionEpoch();
    expect(scopedSettingsReadKey("cashier-a|local", ids)).not.toBe(oldKey);
    first.resolve({ oldSession: true }); await pending;
    expect(f.accept).not.toHaveBeenCalled();
    expect(f.states).toEqual([{ phase: "loading", error: null }]);
  });

  it("does not start a read if the rendered epoch was already replaced before its effect begins", async () => {
    const read = vi.fn().mockResolvedValue({ stale: true });
    bumpSessionEpoch();
    const reader = createScopedSettingsReader({ read, writes: { pending: false, revision: 0 }, epoch: 0,
      isCurrent: () => true, accept: vi.fn(), status: vi.fn() });
    await reader.refresh();
    expect(read).not.toHaveBeenCalled();
  });

  it("does not read over a pending settings write and retains a current confirmed view", async () => {
    const f = fixture(true); f.writes.pending = true;
    await f.reader.refresh();
    expect(f.read).not.toHaveBeenCalled(); expect(f.states).toEqual([]);
  });

  it("reports an unconfirmed scope blocked by pending edits instead of spinning forever", async () => {
    const f = fixture(); f.writes.pending = true;
    await f.reader.refresh();
    expect(f.states.at(-1)).toMatchObject({ phase: "failed", error: expect.stringContaining("Pending settings") });
    f.writes.pending = false; await f.reader.refresh();
    expect(f.states.at(-1)?.phase).toBe("ready");
  });

  it("separates users, database modes, branches, clusters and terminal scopes before the first effect", () => {
    const key = scopedSettingsReadKey("person-a|online", ids);
    const candidates = [
      scopedSettingsReadKey("person-b|online", ids), scopedSettingsReadKey("person-a|local", ids),
      scopedSettingsReadKey("person-a|online", { ...ids, BRANCH: "branch-b" }),
      scopedSettingsReadKey("person-a|online", { ...ids, CLUSTER: "cluster-b" }),
      scopedSettingsReadKey("person-a|online", { ...ids, TERMINAL: "terminal-b" }),
      scopedSettingsReadKey(null, ids),
    ];
    for (const next of candidates) expect(next).not.toBe(key);
    expect(scopedSettingsReadKey("person-a|online", { ...ids })).toBe(key);
  });
});
