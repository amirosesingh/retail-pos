import { QueryClient, QueryObserver } from "@tanstack/query-core";
import { expect, it, vi } from "vitest";
import { refreshResumedQueries } from "../query-resume";
it("reuses fresh foreground data, refreshes changed data, and catches up on reconnect", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 300_000, gcTime: 0 } } });
  const read = vi.fn(async () => ({ value: read.mock.calls.length }));
  const options = { queryKey: ["report"], queryFn: read };
  await client.fetchQuery(options);
  const observer = new QueryObserver(client, options);
  const off = observer.subscribe(() => {});
  try {
    await refreshResumedQueries(client, false);
    expect(read).toHaveBeenCalledTimes(1);
    await client.invalidateQueries({ queryKey: ["report"], refetchType: "none" });
    await refreshResumedQueries(client, false);
    expect(read).toHaveBeenCalledTimes(2);
    await refreshResumedQueries(client, true);
    expect(read).toHaveBeenCalledTimes(3);
  } finally { off(); client.clear(); }
});
