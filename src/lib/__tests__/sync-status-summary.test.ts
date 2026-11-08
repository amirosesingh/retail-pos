import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { browserSyncSummary, isNativeDatabaseSnapshot, nativeSyncSummary, type NativeSyncSnapshot } from "../sync-status-summary";
import { readBrowserOutboxStatus } from "../browser-sync-outbox";
const boundary = vi.hoisted(() => ({ cloud: vi.fn(), write: vi.fn() }));
vi.mock("@/integrations/supabase/external-client", () => ({ supabaseExternal: { from: boundary.cloud, channel: boundary.cloud } }));
vi.mock("../business-storage", () => ({ readBusinessValue: () => null, writeBusinessValue: boundary.write }));
import { checkSync } from "../system-health";

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const native = (patch: NativeSyncSnapshot = {}): NativeSyncSnapshot => ({
  pending: 0, failed: 0, conflicts: 0, running: false, paused: false,
  phase: "idle", lastError: null, lastPushAt: "2026-11-01T01:00:00.000Z", lastPullAt: "2026-11-01T01:01:00.000Z",
  ...patch,
});

describe("native journal status presentation", () => {
  it("does not claim completion for zero queued rows while history recovery is failing", () => {
    const summary = nativeSyncSummary(native({ lastError: "ECHANGEGAP: history checkpoint expired", lastPushAt: null, lastPullAt: null }));
    expect(summary).toMatchObject({ state: "degraded", label: "Needs attention", pending: 0 });
    expect(summary.detail).toContain("ECHANGEGAP");
    expect(summary.detail).not.toMatch(/everything.*uploaded|up to date/i);
  });

  it.each([{ failed: 2 }, { conflicts: 1 }, { lastError: "Bootstrap HTTP503" }])("keeps failures visible independently of pending count: %j", patch => {
    expect(nativeSyncSummary(native(patch))).toMatchObject({ state: "degraded", label: "Needs attention" });
  });

  it("does not use an empty initial snapshot, pull-only success or an unavailable IPC read as upload proof", () => {
    expect(nativeSyncSummary({})).toMatchObject({ state: "checking", pending: null });
    expect(nativeSyncSummary(native({ lastPushAt: null }))).toMatchObject({ state: "checking", label: "Upload not confirmed" });
    expect(nativeSyncSummary(native(), {}, true)).toMatchObject({ state: "degraded", label: "Status unavailable", pending: null });
    expect(nativeSyncSummary(null)).toMatchObject({ state: "degraded", label: "Status unavailable" });
  });

  it.each([undefined, null, -1, "", true, Number.NaN])("does not turn an unconfirmed counter into a zero-success result: %j", pending => {
    expect(nativeSyncSummary(native({ pending }))).toMatchObject({ state: "checking", pending: null });
  });

  it("requires valid error/conflict counters as well as an upload timestamp before showing clear", () => {
    expect(nativeSyncSummary(native({ failed: undefined }))).toMatchObject({ state: "checking" });
    expect(nativeSyncSummary(native({ conflicts: Number.NaN }))).toMatchObject({ state: "checking" });
    expect(nativeSyncSummary(native({ lastPushAt: "not a timestamp" }))).toMatchObject({ state: "checking" });
    expect(nativeSyncSummary(native())).toMatchObject({ state: "checking", label: "Database status not confirmed" });
  });

  it("shows paused, running, pending and local preparation states without completion claims", () => {
    expect(nativeSyncSummary(native({ paused: true }))).toMatchObject({ state: "degraded", label: "Paused" });
    expect(nativeSyncSummary(native({ running: true, phase: "pushing" }))).toMatchObject({ state: "checking", label: "Sending updates" });
    expect(nativeSyncSummary(native({ running: true, phase: "pulling" }))).toMatchObject({ state: "checking", label: "Receiving updates" });
    expect(nativeSyncSummary(native({ pending: 12 }))).toMatchObject({ state: "degraded", label: "Waiting to upload", pending: 12 });
    expect(nativeSyncSummary(native(), { connected: false })).toMatchObject({ state: "degraded", label: "Local SQL unavailable" });
    expect(nativeSyncSummary(native(), { connected: true, tradingReady: false })).toMatchObject({ state: "checking", label: "Preparing local database" });
  });

  it("does not hide existing native work when local SQL is disabled or the browser has no batches", () => {
    expect(nativeSyncSummary(native(), { enabled: false })).toMatchObject({ label: "Local sync disabled" });
    expect(nativeSyncSummary(native({ pending: 3 }), { enabled: false })).toMatchObject({ state: "degraded", pending: 3 });
    expect(nativeSyncSummary(native({ lastError: "Upload failed" }), { state: "disabled" })).toMatchObject({ state: "degraded", label: "Needs attention" });
    expect(nativeSyncSummary(null, { enabled: false }, true).detail).toContain("has not been checked");
  });

  it("uses scoped queue wording after a confirmed successful upload and changes no input facts", () => {
    const snapshot = Object.freeze(native());
    const database = Object.freeze({ connected: true, enabled: true, tradingReady: true });
    const before = JSON.stringify({ snapshot, database });
    const summary = nativeSyncSummary(snapshot, database);
    expect(summary).toMatchObject({ state: "ok", label: "Journal queue clear", pending: 0 });
    expect(summary.detail).toContain("does not verify historical data completeness");
    expect(JSON.stringify({ snapshot, database })).toBe(before);
  });
});

describe("durable browser queue status presentation", () => {
  it("shows all persisted pending batches independently of whether a retry is due", () => {
    expect(browserSyncSummary({ state: "ready", pending: 37 }, true)).toMatchObject({ state: "degraded", pending: 37 });
    expect(browserSyncSummary({ state: "ready", pending: 37 }, false)).toMatchObject({ state: "degraded", label: "Offline", pending: 37 });
  });

  it("does not describe unknown storage as an empty uploaded queue", () => {
    const summary = browserSyncSummary({ state: "unavailable", pending: null }, true);
    expect(summary).toMatchObject({ state: "degraded", pending: null });
    expect(summary.detail).toContain("not confirmed");
  });

  it("distinguishes a fresh device from a verified empty persisted queue without claiming all data uploaded", () => {
    for (const state of ["ready", "uninitialized"] as const) {
      const summary = browserSyncSummary({ state, pending: 0 }, true);
      expect(summary).toMatchObject({ state: "ok", pending: 0 });
      expect(summary.detail).not.toMatch(/everything.*uploaded|up to date/i);
    }
    expect(browserSyncSummary({ state: "ready", pending: 0 }, false)).toMatchObject({ state: "degraded", label: "Offline" });
  });
});

/** A diagnostic IndexedDB boundary: only count is implemented, so a payload
 * read or any writer cannot accidentally pass as a status-only operation. */
function browserStorage(mode: "ready" | "fresh" | "blocked" | "error" | "missing store" | "hang" = "ready", pending = 37) {
  type Handler = (() => void) | null;
  const writes = { put: vi.fn(), delete: vi.fn(), clear: vi.fn(), getAll: vi.fn(), openCursor: vi.fn() };
  const countRequest: { result: number; onsuccess: Handler; onerror: Handler } = { result: pending, onsuccess: null, onerror: null };
  const transaction = { oncomplete: null as Handler, onabort: null as Handler, onerror: null as Handler,
    abort: vi.fn(() => { void Promise.resolve().then(() => transaction.onabort?.()); }),
    objectStore: vi.fn(() => ({ ...writes, count: vi.fn(() => countRequest) })) };
  const db = { onversionchange: null as Handler, close: vi.fn(),
    objectStoreNames: { contains: vi.fn(() => mode !== "missing store") },
    transaction: vi.fn(() => { void Promise.resolve().then(() => { countRequest.onsuccess?.(); transaction.oncomplete?.(); }); return transaction; }) };
  const request = { result: db, transaction: { abort: vi.fn(() => { void Promise.resolve().then(() => request.onerror?.()); }) },
    onsuccess: null as Handler, onerror: null as Handler, onblocked: null as Handler, onupgradeneeded: null as Handler };
  const factory = { open: vi.fn(() => {
    void Promise.resolve().then(() => {
      if (mode === "fresh") request.onupgradeneeded?.();
      else if (mode === "blocked") request.onblocked?.();
      else if (mode === "error") request.onerror?.();
      else if (mode !== "hang") request.onsuccess?.();
    });
    return request;
  }) };
  vi.stubGlobal("indexedDB", factory);
  return { factory, request, db, transaction, countRequest, writes };
}

describe("read-only persisted browser outbox diagnostics", () => {
  it("counts the actual store in a readonly transaction without version/schema or payload access", async () => {
    const f = browserStorage();
    expect(await readBrowserOutboxStatus()).toEqual({ state: "ready", pending: 37 });
    expect(f.factory.open).toHaveBeenCalledExactlyOnceWith("retail-pos-browser-sync");
    expect(f.db.transaction).toHaveBeenCalledExactlyOnceWith("pending-batches", "readonly");
    expect(f.db.close).toHaveBeenCalledOnce();
    for (const writer of Object.values(f.writes)) expect(writer).not.toHaveBeenCalled();
  });

  it("aborts a fresh-database upgrade rather than creating storage", async () => {
    const f = browserStorage("fresh");
    expect(await readBrowserOutboxStatus()).toEqual({ state: "uninitialized", pending: 0 });
    expect(f.request.transaction.abort).toHaveBeenCalledOnce();
    expect(f.db.transaction).not.toHaveBeenCalled();
  });

  it.each(["blocked", "error", "missing store"] as const)("reports %s as unavailable, not zero", async mode => {
    browserStorage(mode);
    expect(await readBrowserOutboxStatus()).toEqual({ state: "unavailable", pending: null });
  });

  it("bounds a stalled local read and closes a late connection without reading records", async () => {
    vi.useFakeTimers();
    const f = browserStorage("hang");
    const read = readBrowserOutboxStatus();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await read).toEqual({ state: "unavailable", pending: null });
    f.request.onsuccess?.();
    expect(f.db.close).toHaveBeenCalledOnce();
    expect(f.db.transaction).not.toHaveBeenCalled();
  });

  it("closes a late connection after a blocked result instead of starting another transaction", async () => {
    const f = browserStorage("blocked");
    expect(await readBrowserOutboxStatus()).toEqual({ state: "unavailable", pending: null });
    f.request.onsuccess?.();
    expect(f.db.close).toHaveBeenCalledOnce(); expect(f.db.transaction).not.toHaveBeenCalled();
  });

  it.each(["count error", "version change"])("returns unavailable and aborts only its own readonly transaction on %s", async fault => {
    const f = browserStorage("hang");
    const read = readBrowserOutboxStatus();
    f.request.onsuccess?.();
    if (fault === "count error") f.countRequest.onerror?.(); else f.db.onversionchange?.();
    expect(await read).toEqual({ state: "unavailable", pending: null });
    expect(f.transaction.abort).toHaveBeenCalledOnce(); expect(f.db.close).toHaveBeenCalledOnce();
    for (const writer of Object.values(f.writes)) expect(writer).not.toHaveBeenCalled();
  });
});

describe("existing health-check transport integration", () => {
  it("reads the actual native error instead of the renderer's compatibility zero", async () => {
    browserStorage("ready", 0);
    const getStatus = vi.fn(async () => native({ lastError: "ECHANGEGAP", lastPushAt: null }));
    const getState = vi.fn(async () => ({ connected: true, enabled: true, tradingReady: true }));
    vi.stubGlobal("window", { pos: { sync: { getStatus }, database: { getState } } });
    vi.stubGlobal("navigator", { onLine: true });
    const summary = await checkSync();
    expect(summary).toMatchObject({ id: "sync", state: "degraded" });
    expect(summary.detail).toContain("ECHANGEGAP");
    expect(summary.detail).not.toMatch(/everything.*uploaded|up to date/i);
    expect(getStatus).toHaveBeenCalledOnce(); expect(getState).toHaveBeenCalledOnce();
    expect(boundary.cloud).not.toHaveBeenCalled(); expect(boundary.write).not.toHaveBeenCalled();
  });

  it("preserves pending native work and pending browser batches together during online fallback", async () => {
    browserStorage("ready", 6);
    vi.stubGlobal("window", { pos: { sync: { getStatus: async () => native({ pending: 3 }) }, database: { getState: async () => ({ enabled: true, connected: true }) } } });
    vi.stubGlobal("navigator", { onLine: true });
    const result = await checkSync();
    expect(result.state).toBe("degraded");
    expect(result.detail).toContain("3 journal changes"); expect(result.detail).toContain("6 saved browser upload batches");
  });

  it("does not claim success after a native IPC rejection or missing native status capability", async () => {
    browserStorage("ready", 0);
    vi.stubGlobal("navigator", { onLine: true });
    for (const sync of [{ getStatus: async () => { throw Error("IPC unavailable"); } }, {}]) {
      vi.stubGlobal("window", { pos: { sync, database: { getState: async () => ({ enabled: true }) } } });
      expect(await checkSync()).toMatchObject({ state: "degraded" });
    }
  });

  it("does not treat a missing database bridge as a confirmed native database", async () => {
    browserStorage("ready", 0);
    vi.stubGlobal("window", { pos: { sync: { getStatus: async () => native() } } });
    vi.stubGlobal("navigator", { onLine: true });
    expect(await checkSync()).toMatchObject({ state: "degraded" });
  });

  it.each([undefined, null, 42, "ready", [], {}])("rejects missing or malformed fulfilled database metadata: %j", async value => {
    browserStorage("ready", 0);
    vi.stubGlobal("window", { pos: { sync: { getStatus: async () => native() }, database: { getState: async () => value } } });
    vi.stubGlobal("navigator", { onLine: true });
    expect(await checkSync()).toMatchObject({ state: "degraded" });
  });

  it("bounds a stalled native status read without adding retries or leaving timers running", async () => {
    vi.useFakeTimers(); browserStorage("ready", 0);
    const getStatus = vi.fn(() => new Promise<NativeSyncSnapshot>(() => undefined));
    vi.stubGlobal("window", { pos: { sync: { getStatus }, database: { getState: async () => ({ enabled: true }) } } });
    vi.stubGlobal("navigator", { onLine: true });
    const read = checkSync();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await read).toMatchObject({ state: "degraded" });
    expect(getStatus).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });

  it("handles disabled native SQL and a fresh browser without inventing a configured local queue", async () => {
    browserStorage("fresh");
    vi.stubGlobal("window", { pos: { sync: { getStatus: async () => native({ lastPushAt: null }) }, database: { getState: async () => ({ enabled: false }) } } });
    vi.stubGlobal("navigator", { onLine: true });
    const result = await checkSync();
    expect(result.state).toBe("ok"); expect(result.detail).toContain("disabled");
    expect(result.detail).not.toMatch(/everything.*uploaded|up to date/i);
  });

  it("reports browser/mobile durable batches without requiring a native bridge", async () => {
    browserStorage("ready", 37);
    vi.stubGlobal("window", {});
    vi.stubGlobal("navigator", { onLine: true });
    expect(await checkSync()).toMatchObject({ state: "degraded", detail: "37 saved browser upload batches are waiting to upload." });
    expect(boundary.cloud).not.toHaveBeenCalled(); expect(boundary.write).not.toHaveBeenCalled();
  });

  it("recovers its presentation from a fresh snapshot without retrying work or using saved past errors", async () => {
    browserStorage("ready", 0);
    let snapshot = native({ lastError: "temporary error" });
    const api = { getStatus: vi.fn(async () => snapshot), runNow: vi.fn(), pause: vi.fn(), resume: vi.fn() };
    vi.stubGlobal("window", { pos: { sync: api, database: { getState: async () => ({ enabled: true, connected: true }) } } });
    vi.stubGlobal("navigator", { onLine: true });
    expect((await checkSync()).state).toBe("degraded");
    snapshot = native();
    expect((await checkSync()).state).toBe("ok");
    for (const action of [api.runNow, api.pause, api.resume, boundary.cloud, boundary.write]) expect(action).not.toHaveBeenCalled();
  });
});

/** Execute the actual TSX component's hooks and async handlers. The JSX tree is
 * an inspectable value; a separate Chrome fixture verifies real React rendering. */
function panelHarness(databaseRead: unknown, syncResult: unknown = { ok: true }, options: { branchId?: string; sync?: unknown } = {}) {
  const ts = createRequire(import.meta.url)("typescript") as typeof import("typescript");
  const source = readFileSync("src/platforms/windows/components/LocalDatabaseOperations.tsx", "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  type Element = { type: unknown; props: { children?: unknown; role?: string; onClick?: () => Promise<void>; className?: string } };
  let cursor = 0;
  const values: unknown[] = [], effects: (() => void)[] = [];
  const react = {
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in values)) values[index] = typeof initial === "function" ? initial() : initial;
      return [values[index], (next: unknown) => { values[index] = typeof next === "function" ? next(values[index]) : next; }];
    },
    useRef(initial: unknown) { const index = cursor++; return values[index] ??= { current: initial }; },
    useCallback(callback: unknown) { cursor++; return callback; },
    useEffect(effect: () => void) { const index = cursor++; if (!(index in values)) { values[index] = true; effects.push(effect); } },
  };
  let databaseCallback: ((next: unknown) => void) | undefined;
  let releaseHealth!: (value: unknown) => void;
  const health = new Promise(resolve => { releaseHealth = resolve; });
  const api = {
    database: { getState: async () => databaseRead, health: () => health, schemaStatus: async () => ({ ok: true }),
      subscribe: (callback: (next: unknown) => void) => { databaseCallback = callback; return () => undefined; } },
    jobs: { getActive: async () => null, subscribe: () => () => undefined },
    sync: { getStatus: async () => options.sync ?? native(), getFailures: async () => ({}), runNow: async () => syncResult, subscribe: () => () => undefined },
  };
  const exports: { LocalDatabaseOperations?: (props: { branchId?: string }) => Element | null } = {};
  runInNewContext(compiled, {
    exports, window: { pos: api }, require: (name: string) => {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx: (type: unknown, props: Element["props"]) => ({ type, props }), jsxs: (type: unknown, props: Element["props"]) => ({ type, props }) };
      if (name === "@/lib/sync-status-summary") return { nativeSyncSummary, isNativeDatabaseSnapshot };
      if (name === "@/lib/branch-id") return { sameBranchId: (left: unknown, right: unknown) => left === right };
      if (name === "@/lib/time-zone") return { formatDateTime: String };
      if (name === "@/core/activation/terminal-tokens") return { mirrorTerminalConfigToDesktop: async () => undefined };
      return new Proxy({}, { get: (_target, key) => String(key) });
    },
  });
  const render = () => { cursor = 0; return exports.LocalDatabaseOperations!({ branchId: options.branchId }); };
  const first = render();
  effects.splice(0).forEach(effect => effect());
  const settle = async () => { releaseHealth({ ok: true }); for (let index = 0; index < 10; index++) await Promise.resolve(); };
  const status = (tree: unknown): string | null => {
    if (Array.isArray(tree)) return tree.map(status).find(value => value !== null) ?? null;
    if (!tree || typeof tree !== "object") return null;
    const element = tree as Element;
    return element.props?.role === "status" ? String(element.props.children) : status(element.props?.children);
  };
  const findText = (tree: unknown, value: string): Element | undefined => {
    if (Array.isArray(tree)) return tree.map(node => findText(node, value)).find(Boolean);
    if (!tree || typeof tree !== "object") return undefined;
    const node = tree as Element;
    return node.props?.children === value ? node : findText(node.props?.children, value);
  };
  return { first, render, settle, status, findText, emitDatabase: (next: unknown) => databaseCallback!(next) };
}

describe("actual local panel database freshness", () => {
  const ready = { enabled: true, connected: true, tradingReady: true, state: "enabled_ready" };

  it("shows a grouped settings pilot only for the current branch", async () => {
    const sync = { ...native(), groupedSettingsPilot: { status: "REVIEW_REQUIRED", branchId: "branch-a", position: { seq: "7" } } };
    const sameBranch = panelHarness(ready, undefined, { branchId: "branch-a", sync });
    const otherBranch = panelHarness(ready, undefined, { branchId: "branch-b", sync });
    await Promise.all([sameBranch.settle(), otherBranch.settle()]);
    expect(sameBranch.findText(sameBranch.render(), "Store settings sync pilot")).toBeDefined();
    expect(otherBranch.findText(otherBranch.render(), "Store settings sync pilot")).toBeUndefined();
  });

  it("reports pending protected history after manual sync without a green completion", async () => {
    const panel = panelHarness(ready, { ok: true, historyPending: true });
    await panel.settle();
    await panel.findText(panel.render(), "Sync now")!.props.onClick!();
    const tree = panel.render();
    const message = panel.findText(tree, "Protected history is still pending.");
    expect(message?.props.className).toContain("text-muted-foreground");
    expect(panel.findText(tree, "Synchronization completed.")).toBeUndefined();
  });

  it("does not restore a stale connected snapshot after a newer disconnect event", async () => {
    const panel = panelHarness(ready);
    panel.emitDatabase({ ...ready, connected: false });
    expect(panel.status(panel.render())).toBe("Local SQL unavailable");
    await panel.settle();
    expect(panel.status(panel.render())).toBe("Local SQL unavailable");
  });

  it("does not reopen the panel after a newer database-disabled event", async () => {
    const panel = panelHarness(ready);
    panel.emitDatabase({ enabled: false, state: "disabled" });
    expect(panel.render()).toBeNull();
    await panel.settle();
    expect(panel.render()).toBeNull();
  });

  it("does not overwrite a newer valid event with an older missing database result", async () => {
    const panel = panelHarness(undefined);
    panel.emitDatabase(ready);
    await panel.settle();
    expect(panel.status(panel.render())).toBe("Journal queue clear");
  });

  it("keeps a fulfilled missing database result unknown even when sync counters look healthy", async () => {
    const panel = panelHarness(undefined);
    await panel.settle();
    expect(panel.status(panel.render())).toBe("Status unavailable");
  });
});
