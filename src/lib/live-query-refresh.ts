import { isCancelledError, type Query, type QueryClient } from "@tanstack/react-query";
import { canonicalBranchId } from "./branch-id";
import { queryReadsChangedTables } from "./live-query-tables";

type Change = { table: string; storeId?: string | null };
type Policy = { allowOffline?: boolean; intervalMs?: number; storeIds?: readonly string[]; salesHints?: boolean };
type Options = { canRefresh?: () => boolean; online?: () => boolean; onError?: (error: unknown) => void };
type Job = { running: boolean; dirty: boolean; active: boolean; interval: number; nextDue: number; generation: number };

/** Metadata changes scheduling only; query keys and readers retain authorization. */
function policy(query: Query): Policy {
  const value = query.meta?.liveRefresh;
  return value && typeof value === "object" ? value as Policy : {};
}

export function isLiveQuery(query: Query): boolean {
  return Array.isArray(query.meta?.tables);
}

/** One owner for observed queries; imperative/raw-state readers keep their owner. */
export function createLiveQueryRefresh(
  client: QueryClient,
  { canRefresh = () => true, online = () => true, onError = (_error: unknown) => {} }: Options = {},
) {
  let stopped = false;
  let changeTimer: ReturnType<typeof setTimeout> | undefined;
  let lifecycleTimer: ReturnType<typeof setTimeout> | undefined;
  let reconcileTimer: ReturnType<typeof setTimeout> | undefined;
  const changed = new Set<Query>();
  const lifecycle = new Map<Query, { updates: number; reconnect: boolean }>();
  const jobs = new WeakMap<Query, Job>();
  const jobFor = (query: Query) => {
    let job = jobs.get(query);
    if (!job) {
      job = { running: false, dirty: false, active: false, interval: 0, nextDue: Infinity, generation: 0 };
      jobs.set(query, job);
    }
    return job;
  };
  const eligible = (query: Query) => !stopped && canRefresh() &&
    client.getQueryCache().get(query.queryHash) === query && query.isActive() && !query.isDisabled() &&
    (online() || (policy(query).allowOffline === true && query.options.networkMode === "always"));
  const read = (query: Query) => client.refetchQueries(
    { type: "active", predicate: candidate => candidate === query },
    { cancelRefetch: false, throwOnError: true },
  );

  // A commit during an existing read may be newer than its snapshot. Finish that
  // read, then do one trailing pass; lifecycle/poll hints never request a tail.
  const committed = async (query: Query) => {
    const job = jobFor(query);
    if (!job.dirty || job.running || !eligible(query)) return;
    job.running = true;
    const generation = job.generation;
    try {
      if (query.state.fetchStatus === "fetching") await query.promise;
      while (job.dirty && generation === job.generation && eligible(query)) {
        job.dirty = false;
        try { await read(query); }
        catch (error) {
          if (isCancelledError(error)) { job.dirty = false; return; }
          if (!stopped) onError(error);
        }
      }
    } catch (error) {
      if (isCancelledError(error)) job.dirty = false;
      else if (!stopped) onError(error);
    }
    finally {
      job.running = false;
      if (job.dirty && generation === job.generation && client.getQueryCache().get(query.queryHash) === query) query.invalidate();
    }
  };
  const catchup = async (query: Query) => {
    const job = jobFor(query);
    if (!eligible(query) || job.running) return;
    if (job.dirty) { void committed(query); return; }
    if (query.state.fetchStatus === "fetching") return;
    job.running = true;
    const generation = job.generation;
    try { await read(query); }
    catch (error) {
      // Explicit mode/session cancellation is a fence, not a request to retry.
      if (isCancelledError(error)) job.dirty = false;
      else if (!stopped) onError(error);
    }
    finally {
      job.running = false;
      if (job.dirty && generation === job.generation) void committed(query);
    }
  };

  const changedQuery = (query: Query, change: Change) => {
    const stores = policy(query).storeIds;
    if (change.storeId && stores && !stores.some(id => canonicalBranchId(id) === canonicalBranchId(change.storeId))) return;
    // Inactive/disabled ranges must reread when enabled, without fetching now.
    query.invalidate();
    jobFor(query).dirty = true;
    changed.add(query);
    if (changeTimer !== undefined) return;
    changeTimer = setTimeout(() => {
      changeTimer = undefined;
      const batch = [...changed]; changed.clear();
      for (const candidate of batch) void committed(candidate);
    }, 100);
  };
  const intervalFor = (query: Query) => {
    const value = policy(query).intervalMs;
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 300_000;
  };
  // One next-due timer preserves a 60s subscriber's cadence even when it mounts
  // between the root's former poll ticks. Read completion does not postpone it.
  const scheduleReconcile = () => {
    if (reconcileTimer !== undefined) clearTimeout(reconcileTimer);
    if (stopped) return;
    let nextDue = Infinity;
    for (const query of client.getQueryCache().getAll()) {
      if (!isLiveQuery(query)) continue;
      const job = jobFor(query);
      if (!query.isActive() || query.isDisabled()) { job.active = false; continue; }
      const interval = intervalFor(query);
      if (!job.active || interval !== job.interval) job.nextDue = Date.now() + interval;
      job.active = true; job.interval = interval;
      nextDue = Math.min(nextDue, job.nextDue);
    }
    if (!Number.isFinite(nextDue)) return;
    reconcileTimer = setTimeout(() => {
      reconcileTimer = undefined;
      for (const query of client.getQueryCache().getAll()) {
        if (!isLiveQuery(query) || !query.isActive()) continue;
        const job = jobFor(query);
        if (Date.now() < job.nextDue) continue;
        job.nextDue = Date.now() + intervalFor(query);
        void catchup(query);
      }
      scheduleReconcile();
    }, Math.max(0, nextDue - Date.now()));
  };
  const offCache = client.getQueryCache().subscribe(event => {
    if (event.type === "updated" && event.action.type === "setState" && event.action.state.fetchStatus === "idle") {
      // TanStack restores state synchronously on explicit cancellation and can
      // resolve the fetch with previous data instead of throwing CancelledError.
      // Retire that job before its promise settles; the mode/session owner may
      // deliberately start a new read, but our old dirty tail must not do so.
      const job = jobs.get(event.query);
      if (job) { job.generation += 1; job.dirty = false; }
      changed.delete(event.query);
      lifecycle.delete(event.query);
    }
    if (event.type === "updated" && event.action.type === "fetch") {
      // An ordinary mount/explicit refresh started after the hint already reads
      // that commit. A hint arriving after fetch starts still requests its tail.
      const job = jobs.get(event.query);
      if (job && !job.running) job.dirty = false;
    }
    if (["added", "removed", "observerAdded", "observerRemoved", "observerOptionsUpdated"].includes(event.type)) scheduleReconcile();
  });
  scheduleReconcile();

  return {
    change(change: Change) {
      if (stopped) return;
      const tables = new Set([change.table]);
      for (const query of client.getQueryCache().getAll()) {
        if (!queryReadsChangedTables(query.meta, tables)) continue;
        changedQuery(query, change);
      }
    },
    salesChange(change?: Change) {
      if (stopped) return;
      for (const query of client.getQueryCache().getAll()) {
        if (isLiveQuery(query) && policy(query).salesHints) changedQuery(query, change ?? { table: "sales" });
      }
    },
    resume(reconnect = false) {
      if (stopped) return;
      for (const query of client.getQueryCache().getAll()) {
        if (!isLiveQuery(query) || !query.isActive()) continue;
        const pending = lifecycle.get(query);
        if (pending) pending.reconnect ||= reconnect;
        else lifecycle.set(query, { updates: query.state.dataUpdateCount, reconnect });
      }
      if (lifecycleTimer !== undefined) return;
      lifecycleTimer = setTimeout(() => {
        lifecycleTimer = undefined;
        const batch = [...lifecycle]; lifecycle.clear();
        for (const [query, hint] of batch) {
          // TanStack's native focus/reconnect may have already completed the read.
          if (query.state.dataUpdateCount > hint.updates && !jobFor(query).dirty) continue;
          if (hint.reconnect || query.isStale() || jobFor(query).dirty) void catchup(query);
        }
      }, 150);
    },
    reconcile(force = false) {
      if (stopped) return;
      for (const query of client.getQueryCache().getAll()) {
        if (!isLiveQuery(query)) continue;
        if (force || jobFor(query).dirty || Date.now() >= jobFor(query).nextDue)
          void catchup(query);
      }
    },
    stop() {
      stopped = true;
      offCache();
      changed.clear(); lifecycle.clear();
      if (changeTimer !== undefined) clearTimeout(changeTimer);
      if (lifecycleTimer !== undefined) clearTimeout(lifecycleTimer);
      if (reconcileTimer !== undefined) clearTimeout(reconcileTimer);
    },
  };
}
