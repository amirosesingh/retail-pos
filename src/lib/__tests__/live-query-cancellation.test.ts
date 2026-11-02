import { QueryClient, QueryObserver } from "@tanstack/query-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLiveQueryRefresh } from "../live-query-refresh";

const cleanups: Array<() => void> = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.useRealTimers();
});

async function fixture() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 300_000, gcTime: 0 } },
  });
  const finish: Array<(rows: string[]) => void> = [];
  const read = vi.fn(({ signal }: { signal: AbortSignal }) => {
    if (read.mock.calls.length === 1) return Promise.resolve(["branch-a initial"]);
    return new Promise<string[]>((resolve, reject) => {
      finish.push(resolve);
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
  });
  const options = {
    queryKey: ["report", "operator-1", "branch-a"],
    queryFn: read,
    meta: { tables: ["sales"] },
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  };
  await client.fetchQuery(options);
  const observer = new QueryObserver(client, options);
  const off = observer.subscribe(() => {});
  const refresh = createLiveQueryRefresh(client);
  cleanups.push(() => { refresh.stop(); off(); client.clear(); });
  return { client, observer, options, read, finish, refresh };
}

describe("live refresh explicit cancellation boundaries", () => {
  it("does not resurrect a cancelled committed read, while deliberate later invalidation still works", async () => {
    const { client, options, read, finish, refresh } = await fixture();
    refresh.change({ table: "sales" });
    await vi.advanceTimersByTimeAsync(100);
    expect(read).toHaveBeenCalledTimes(2);

    refresh.change({ table: "sales" });
    await client.cancelQueries({ queryKey: options.queryKey, exact: true });
    await vi.advanceTimersByTimeAsync(100);
    expect(read).toHaveBeenCalledTimes(2);
    expect(client.getQueryState(options.queryKey)?.fetchStatus).toBe("idle");

    const explicit = client.invalidateQueries({ queryKey: options.queryKey, exact: true });
    expect(read).toHaveBeenCalledTimes(3);
    finish[1](["deliberate refresh"]);
    await explicit;
    expect(client.getQueryData(options.queryKey)).toEqual(["deliberate refresh"]);
  });

  it("does not replay dirty work after a reconnect catch-up is explicitly cancelled", async () => {
    const { client, options, read, refresh } = await fixture();
    refresh.resume(true);
    await vi.advanceTimersByTimeAsync(150);
    expect(read).toHaveBeenCalledTimes(2);
    refresh.change({ table: "sales" });

    await client.cancelQueries({ queryKey: options.queryKey, exact: true });
    await vi.advanceTimersByTimeAsync(100);
    expect(read).toHaveBeenCalledTimes(2);
    expect(client.getQueryState(options.queryKey)?.fetchStatus).toBe("idle");
  });

  it("stops queued tails when the coordinator is disposed", async () => {
    const { client, options, read, finish, refresh } = await fixture();
    refresh.change({ table: "sales" });
    await vi.advanceTimersByTimeAsync(100);
    refresh.change({ table: "sales" });
    refresh.stop();
    finish[0](["last completed read"]);
    await vi.advanceTimersByTimeAsync(500);

    expect(read).toHaveBeenCalledTimes(2);
    expect(client.getQueryState(options.queryKey)?.fetchStatus).toBe("idle");
  });

  it("cannot recreate a removed query from a pending dirty job", async () => {
    const { client, options, read, refresh } = await fixture();
    refresh.change({ table: "sales" });
    await vi.advanceTimersByTimeAsync(100);
    refresh.change({ table: "sales" });
    client.removeQueries({ queryKey: options.queryKey, exact: true });
    await vi.advanceTimersByTimeAsync(500);

    expect(read).toHaveBeenCalledTimes(2);
    expect(client.getQueryState(options.queryKey)).toBeUndefined();
  });

  it("leaves the old operator and branch inactive when the observer changes scope", async () => {
    const { client, observer, options, read, refresh } = await fixture();
    refresh.change({ table: "sales" });
    await vi.advanceTimersByTimeAsync(100);
    refresh.change({ table: "sales" });

    const nextRead = vi.fn(async () => ["branch-b only"]);
    const nextKey = ["report", "operator-2", "branch-b"];
    observer.setOptions({ ...options, queryKey: nextKey, queryFn: nextRead });
    await vi.advanceTimersByTimeAsync(500);

    expect(read).toHaveBeenCalledTimes(2);
    expect(nextRead).toHaveBeenCalledOnce();
    expect(observer.getCurrentResult().data).toEqual(["branch-b only"]);
    expect(client.getQueryData(nextKey)).toEqual(["branch-b only"]);
  });

  it("does not start a queued tail after access is disabled", async () => {
    const { observer, options, read, finish, refresh } = await fixture();
    refresh.change({ table: "sales" });
    await vi.advanceTimersByTimeAsync(100);
    refresh.change({ table: "sales" });
    observer.setOptions({ ...options, enabled: false });
    finish[0](["existing result"]);
    await vi.advanceTimersByTimeAsync(500);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
