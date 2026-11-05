import { afterEach, beforeEach, expect, it, vi } from "vitest";

type EventRequest = { result?: unknown; onsuccess?: () => void; onerror?: () => void; onblocked?: () => void };
let mode: { open: "ok" | "blocked" | "stall"; read: "ok" | "stall"; write: "ok" | "stall" };
let opens: EventRequest[];
let reads: EventRequest[];
let transactions: Array<{ abort: ReturnType<typeof vi.fn>; oncomplete?: () => void; onabort?: () => void }>;
let persistent: Map<string, string>;
let session: Map<string, string>;
let legacy: Map<string, string>;
let close: ReturnType<typeof vi.fn>;

const storage = (values: Map<string, string>) => ({
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key),
});

beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers();
  mode = { open: "ok", read: "ok", write: "ok" };
  opens = []; reads = []; transactions = [];
  persistent = new Map(); session = new Map(); legacy = new Map(); close = vi.fn();
  const db = {
    close,
    transaction: vi.fn((_store: string, purpose: string) => {
      let aborted = false;
      const tx = {
        abort: vi.fn(() => { aborted = true; tx.onabort?.(); }),
        oncomplete: undefined as (() => void) | undefined,
        onabort: undefined as (() => void) | undefined,
        objectStore: () => ({
          get: (key: string) => {
            const request: EventRequest = { result: persistent.get(key) };
            reads.push(request);
            if (mode.read === "ok") queueMicrotask(() => request.onsuccess?.());
            return request;
          },
          put: (value: string, key: string) => {
            if (mode.write === "ok") queueMicrotask(() => {
              if (!aborted) { persistent.set(key, value); tx.oncomplete?.(); }
            });
          },
          delete: (key: string) => {
            if (mode.write === "ok") queueMicrotask(() => {
              if (!aborted) { persistent.delete(key); tx.oncomplete?.(); }
            });
          },
        }),
      };
      transactions.push(tx);
      expect(["readonly", "readwrite"]).toContain(purpose);
      return tx;
    }),
  };
  vi.stubGlobal("window", {});
  vi.stubGlobal("sessionStorage", storage(session)); vi.stubGlobal("localStorage", storage(legacy));
  vi.stubGlobal("indexedDB", { open: vi.fn(() => {
    const request: EventRequest = { result: db }; opens.push(request);
    if (mode.open === "ok") queueMicrotask(() => request.onsuccess?.());
    else if (mode.open === "blocked") queueMicrotask(() => request.onblocked?.());
    return request;
  }) });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const adapter = async () => (await import("@/integrations/supabase/auth-storage")).externalAuthStorage;

it("releases a blocked open and closes its eventual connection instead of resurrecting late credentials", async () => {
  const auth = await adapter(); mode.open = "blocked";
  expect(await auth.getItem("blocked")).toBeNull();
  opens[0].onsuccess?.();
  expect(close).toHaveBeenCalledOnce();
  expect(transactions).toHaveLength(0);
  expect(vi.getTimerCount()).toBe(0);
});

it("bounds a never-settling open while preserving the existing tab fallback", async () => {
  const auth = await adapter(); mode.open = "stall";
  const saving = auth.setItem("open-timeout", "verified-token");
  await vi.advanceTimersByTimeAsync(2500); await saving;
  expect(await auth.getItem("open-timeout")).toBe("verified-token");
  expect(session.get("open-timeout")).toBe("verified-token");
  opens[0].onsuccess?.(); expect(close).toHaveBeenCalledOnce();
  expect(transactions).toHaveLength(0);
});

it("aborts a stalled read and cannot replace a newer verified token with its late result", async () => {
  const auth = await adapter(); mode.read = "stall"; persistent.set("read-timeout", "old-token");
  const reading = auth.getItem("read-timeout");
  await vi.advanceTimersByTimeAsync(0);
  await auth.setItem("read-timeout", "new-token");
  await vi.advanceTimersByTimeAsync(2500);
  expect(await reading).toBe("new-token");
  reads[0].onsuccess?.();
  expect(await auth.getItem("read-timeout")).toBe("new-token");
  expect(transactions[0].abort).toHaveBeenCalledOnce();
});

it("aborts a stalled write, preserves the newest fallback, and allows later persistence", async () => {
  const auth = await adapter(); mode.write = "stall";
  const saving = auth.setItem("write-timeout", "first-token");
  await vi.advanceTimersByTimeAsync(0);
  mode.write = "ok"; await auth.setItem("write-timeout", "latest-token");
  await vi.advanceTimersByTimeAsync(2500); await saving;
  expect(await auth.getItem("write-timeout")).toBe("latest-token");
  expect(persistent.get("write-timeout")).toBe("latest-token");
  expect(transactions[0].abort).toHaveBeenCalledOnce();
  expect(session.has("write-timeout")).toBe(false);
});

it("an explicit removal fences a pending write and prevents stale IndexedDB restoration after a reload", async () => {
  const auth = await adapter(); mode.open = "stall"; persistent.set("removed", "older-token");
  const saving = auth.setItem("removed", "in-flight-token");
  const removing = auth.removeItem("removed");
  await vi.advanceTimersByTimeAsync(2500); await Promise.all([saving, removing]);
  expect(await auth.getItem("removed")).toBeNull();
  expect(session.get("pos.auth.removed:removed")).toBe("1");
  vi.resetModules(); mode.open = "ok";
  const reloaded = await adapter();
  expect(await reloaded.getItem("removed")).toBeNull();
  await reloaded.setItem("removed", "fresh-login");
  expect(await reloaded.getItem("removed")).toBe("fresh-login");
  expect(session.has("pos.auth.removed:removed")).toBe(false);
});

it("a timed-out write's tab fallback takes precedence over an older IndexedDB token after reload", async () => {
  const auth = await adapter(); persistent.set("fallback", "old-token"); mode.write = "stall";
  const saving = auth.setItem("fallback", "new-token");
  await vi.advanceTimersByTimeAsync(2500); await saving;
  vi.resetModules(); mode.open = "ok";
  expect(await (await adapter()).getItem("fallback")).toBe("new-token");
});
