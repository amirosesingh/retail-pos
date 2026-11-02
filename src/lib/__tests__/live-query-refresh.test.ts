import { QueryClient, QueryObserver, focusManager, onlineManager } from "@tanstack/query-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLiveQueryRefresh } from "../live-query-refresh";
import { refreshResumedQueries } from "../query-resume";

const cleanups: Array<() => void> = [];
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000_000); onlineManager.setOnline(true); });
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
  vi.useRealTimers();
});

async function fixture({ slow = false, enabled = true, allowOffline = false, intervalMs = 300_000,
  stores, salesHints = false }: { slow?: boolean; enabled?: boolean; allowOffline?: boolean; intervalMs?: number;
    stores?: string[]; salesHints?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 300_000, gcTime: 0 } } });
  client.mount();
  const pending: Array<(value: number) => void> = [];
  const aborted = vi.fn();
  const read = vi.fn(({ signal }: { signal: AbortSignal }) => {
    const number = read.mock.calls.length;
    if (!slow || number === 1) return Promise.resolve(number);
    return new Promise<number>((resolve, reject) => {
      pending.push(resolve);
      signal.addEventListener("abort", () => { aborted(); reject(new Error("aborted")); }, { once: true });
    });
  });
  const options = { queryKey: ["report", "operator-a", "branch-a", "sql"], queryFn: read, enabled,
    networkMode: allowOffline ? "always" as const : "online" as const,
    refetchOnWindowFocus: false, refetchOnReconnect: false,
    meta: { tables: ["sales", "sale_items"], liveRefresh: { allowOffline, intervalMs, storeIds: stores, salesHints } } };
  await client.fetchQuery(options);
  const observer = new QueryObserver(client, options);
  const off = observer.subscribe(() => {});
  let visible = true;
  let online = true;
  const errors = vi.fn();
  const refresh = createLiveQueryRefresh(client, { canRefresh: () => visible, online: () => online, onError: errors });
  cleanups.push(() => { refresh.stop(); off(); client.clear(); client.unmount(); });
  return { client, observer, options, read, pending, aborted, refresh, errors,
    setVisible: (value: boolean) => { visible = value; }, setOnline: (value: boolean) => { online = value; } };
}

describe("one owner for live observed query refreshes", () => {
  it("coalesces one committed update's table and legacy sale hints for fast readers", async () => {
    const { read, refresh } = await fixture({ salesHints: true });
    refresh.change({ table: "sales" });
    refresh.change({ table: "sale_items" });
    refresh.salesChange({ table: "sales" });
    await vi.advanceTimersByTimeAsync(100);
    expect(read).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(200);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("does not cancel/restart a slow read for one hint, but preserves a newer commit's tail", async () => {
    const { read, refresh, pending, aborted } = await fixture({ slow: true });
    refresh.change({ table: "sales" });
    refresh.change({ table: "sale_items" });
    await vi.advanceTimersByTimeAsync(100);
    expect(read).toHaveBeenCalledTimes(2);
    expect(aborted).not.toHaveBeenCalled();

    refresh.change({ table: "sales" });
    refresh.change({ table: "sale_items" });
    await vi.advanceTimersByTimeAsync(100);
    expect(read).toHaveBeenCalledTimes(2);
    pending[0](2);
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(3);
    expect(aborted).not.toHaveBeenCalled();
    pending[1](3);
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("keeps fresh data through lifecycle bursts and catches up once after reconnect", async () => {
    const { client, read, refresh } = await fixture();
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    refresh.resume(); refresh.resume(); refresh.resume();
    await refreshResumedQueries(client, false);
    await vi.advanceTimersByTimeAsync(150);
    expect(read).toHaveBeenCalledOnce();

    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    refresh.resume(); refresh.resume(true); refresh.resume(true);
    await refreshResumedQueries(client, true);
    await vi.advanceTimersByTimeAsync(150);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("joins a pending read on lifecycle recovery without scheduling a needless tail", async () => {
    const { observer, read, pending, refresh } = await fixture({ slow: true });
    const running = observer.refetch();
    refresh.resume(true); refresh.resume();
    await vi.advanceTimersByTimeAsync(150);
    expect(read).toHaveBeenCalledTimes(2);
    pending[0](2);
    await running;
    await vi.advanceTimersByTimeAsync(200);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("retains hidden changes and drains them on foreground return", async () => {
    const { read, refresh, setVisible } = await fixture();
    setVisible(false);
    refresh.change({ table: "sales" });
    await vi.advanceTimersByTimeAsync(100);
    expect(read).toHaveBeenCalledOnce();
    setVisible(true);
    refresh.resume();
    await vi.advanceTimersByTimeAsync(150);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("does not discard a newer hidden commit when an earlier lifecycle read completed", async () => {
    const { observer, read, refresh, setVisible } = await fixture();
    setVisible(false);
    refresh.resume();
    await observer.refetch();
    refresh.change({ table: "sales" });
    await vi.advanceTimersByTimeAsync(100);
    expect(read).toHaveBeenCalledTimes(2);
    setVisible(true);
    refresh.resume();
    await vi.advanceTimersByTimeAsync(50);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("defers cloud reads while offline, retaining changes for reconnect", async () => {
    const { read, refresh, setOnline } = await fixture();
    setOnline(false);
    refresh.change({ table: "sales" });
    await vi.advanceTimersByTimeAsync(100);
    refresh.reconcile(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledOnce();
    setOnline(true);
    refresh.resume(true);
    await vi.advanceTimersByTimeAsync(150);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("continues opted-in SQL reads offline", async () => {
    const { read, refresh, setOnline } = await fixture({ allowOffline: true });
    setOnline(false);
    onlineManager.setOnline(false);
    refresh.change({ table: "sales" });
    await vi.advanceTimersByTimeAsync(100);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("invalidates a disabled range without reading, then consumes the hint in its normal mount read", async () => {
    const { observer, options, read, refresh } = await fixture({ enabled: false });
    refresh.change({ table: "sales" });
    await vi.advanceTimersByTimeAsync(100);
    expect(read).toHaveBeenCalledOnce();
    observer.setOptions({ ...options, enabled: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(2);
    refresh.reconcile(true);
    await vi.advanceTimersByTimeAsync(0);
    // This explicit reconciliation itself is one read, with no leftover dirty
    // tail from the event already consumed by enabling the observer.
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("limits store-specific legacy hints and data updates to the query's configured stores", async () => {
    const { read, refresh } = await fixture({ stores: ["branch-a"], salesHints: true });
    refresh.change({ table: "sales", storeId: "branch-b" });
    refresh.salesChange({ table: "sales", storeId: "branch-b" });
    refresh.change({ table: "products", storeId: "branch-a" });
    await vi.advanceTimersByTimeAsync(100);
    expect(read).toHaveBeenCalledOnce();
    refresh.change({ table: "sales", storeId: "branch-a" });
    refresh.salesChange({ table: "payment_transactions", storeId: "branch-a" });
    await vi.advanceTimersByTimeAsync(100);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("preserves 60-second sponsorship reconciliation separately from ordinary five-minute reads", async () => {
    const short = await fixture({ intervalMs: 60_000 });
    const ordinary = await fixture();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(short.read).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(short.read).toHaveBeenCalledTimes(2);
    expect(ordinary.read).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(240_000);
    expect(ordinary.read).toHaveBeenCalledTimes(2);
    expect(short.read).toHaveBeenCalledTimes(6);
  });

  it("starts a newly mounted query's cadence at mount, without waiting for an old root polling tick", async () => {
    const { client, refresh } = await fixture();
    await vi.advanceTimersByTimeAsync(30_000);
    const read = vi.fn(async () => 1);
    const options = { queryKey: ["sponsorship", "branch-a"], queryFn: read,
      meta: { tables: ["activity_events"], liveRefresh: { intervalMs: 60_000 } },
      refetchOnWindowFocus: false, refetchOnReconnect: false };
    const observer = new QueryObserver(client, options);
    const off = observer.subscribe(() => {});
    cleanups.push(off);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(read).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(2);
    refresh.stop();
  });

  it("recovers from a failed refresh on a later change without spinning", async () => {
    const { read, refresh, errors } = await fixture();
    read.mockRejectedValueOnce(new Error("unavailable"));
    refresh.change({ table: "sales" });
    await vi.advanceTimersByTimeAsync(100);
    expect(read).toHaveBeenCalledTimes(2);
    expect(errors).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(read).toHaveBeenCalledTimes(2);
    refresh.change({ table: "sales" });
    await vi.advanceTimersByTimeAsync(100);
    expect(read).toHaveBeenCalledTimes(3);
  });
});
