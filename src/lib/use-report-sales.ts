import { subscribeBackgroundRefresh } from "./background-refresh";
import { subscribeSalesChange } from "./sync-engine";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { PAGE_DATA_CACHE, pageDataScope } from "./page-data-cache";
import { loadSalesPage, rowToSale } from "@/core/api/pos-db";
import { isManagementDevice } from "./management-device";
import { readManagementReport } from "./management-report-client";
import { effectiveDatabaseMode } from "@/core/local-db/db-mode";
import type { Sale } from "@/core/types/pos-types";
import { uniqueSales } from "./sale-identity";
import { canonicalBranchId } from "./branch-id";
import { useAuth } from "./pos-auth";

import { effectiveTimeZone, inPosDayRange, reportScanStart as dayStart, reportScanEnd as dayEnd } from "./time-zone";

const reportReaders = new WeakMap<QueryClient, Map<string, number>>();
function retainReportRead(client: QueryClient, key: string) {
  let readers = reportReaders.get(client);
  if (!readers) { readers = new Map(); reportReaders.set(client, readers); }
  readers.set(key, (readers.get(key) ?? 0) + 1);
  return () => {
    const remaining = (readers!.get(key) ?? 1) - 1;
    if (remaining > 0) readers!.set(key, remaining);
    else {
      readers!.delete(key);
      void client.cancelQueries({ queryKey: ["report-sales", key], exact: true });
    }
  };
}

/**
 * Date-bounded, keyset-paged report history.
 *
 * The register keeps only recent bills in memory for speed. Reports walk SQL
 * pages only as far back as the selected date, deduplicate the live seed and
 * discard the previous range when filters change.
 */
export function useReportSales(
  seed: Sale[],
  storeIds: string[],
  from: string,
  to: string,
  enabled = true,
  source: "auto" | "cloud" = "auto",
): { sales: Sale[]; loading: boolean; refreshing: boolean; error: string } {
  const { ready, user } = useAuth();
  const queryClient = useQueryClient();
  enabled = enabled && ready && Boolean(user);
  const reportZone = effectiveTimeZone();
  const managementReplica = source === "auto" && isManagementDevice();
  const offlineRead = source === "auto" && (managementReplica || effectiveDatabaseMode() === "local");
  const storeKey = storeIds.filter(Boolean).map(canonicalBranchId).sort().join("|");
  const seedRows = useMemo(() => {
    if (source === "cloud" || managementReplica) return [];
    const start = dayStart(from);
    const end = dayEnd(to);
    const stores = new Set(storeIds.filter(Boolean).map(canonicalBranchId));
    return seed.filter((sale) => {
      const at = Date.parse(sale.createdAt);
      return (
        at >= start && at <= end && inPosDayRange(sale.createdAt, from, to, reportZone) && (!stores.size || stores.has(canonicalBranchId(sale.storeId)))
      );
    });
  }, [seed, storeIds, from, to, reportZone, source, managementReplica]);
  const [revision, setRevision] = useState(0);
  const completedRevision = useRef(0);
  const refreshState = useRef({ running: false, queued: false });
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (refreshState.current.running) refreshState.current.queued = true;
      else setRevision(value => value + 1);
    };
    const scopedStores = new Set(storeKey ? storeKey.split("|") : []);
    const off = subscribeSalesChange((change) => {
      // A sale in another branch cannot change this report. Management's
      // unscoped view (empty storeKey) still accepts every branch hint.
      if (change?.storeId && scopedStores.size && !scopedStores.has(canonicalBranchId(change.storeId))) return;
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        refresh();
      }, 100);
    });
    // Sales-change hints stay immediate; a full historical reconciliation is
    // only a fallback for missed events, not a once-per-minute table download.
    const offCatchup = subscribeBackgroundRefresh(refresh, 300_000, offlineRead);
    return () => {
      off();
      if (timer) clearTimeout(timer);
      offCatchup();
    };
  }, [enabled, storeKey, offlineRead]);
  const rangeKey = JSON.stringify([pageDataScope(user), storeKey, from, to, reportZone, source, managementReplica]);
  const cachedRows = enabled ? queryClient.getQueryData<Sale[]>(["report-sales", rangeKey]) : undefined;
  const [loaded, setLoaded] = useState<{ key: string; rows: Sale[] } | null>(cachedRows ? { key: rangeKey, rows: cachedRows } : null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!enabled) return;
    const releaseRead = retainReportRead(queryClient, rangeKey);
    const ids = storeKey ? storeKey.split("|") : [""];
    const start = dayStart(from);
    const end = dayEnd(to);
    const work = { running: true, queued: false };
    refreshState.current = work;
    setLoading(true);
    setError("");

    void (async () => {
      try {
        const found = await queryClient.fetchQuery({
          queryKey: ["report-sales", rangeKey],
          meta: { tables: ["sales", "sale_items", "payment_transactions"] },
          ...PAGE_DATA_CACHE,
          retry: false,
          networkMode: offlineRead ? "always" : "online",
          // A change hint or reconciliation must recheck authority-backed rows;
          // navigating back to a fresh unchanged range can reuse its snapshot.
          staleTime: revision > completedRevision.current ? 0 : PAGE_DATA_CACHE.staleTime,
          queryFn: async ({ signal }) => {
            const found: Sale[] = [];
            if (managementReplica && storeKey) {
              let cursor: { ts: string; id: string } | null = null;
              for (;;) {
                if (signal.aborted) throw new Error("Report read cancelled");
                const page = await readManagementReport({ kind: "sales", storeIds: ids, from, to, zone: reportZone, limit: 500, cursor });
                if (!page) {
                  if (cursor) throw new Error("The management replica changed during this report. Reconnect and refresh.");
                  break; // No complete local replica: use the existing cloud read.
                }
                found.push(...(page.rows ?? []).map(rowToSale));
                if (!page.hasMore || !page.cursor) return found;
                if (cursor?.ts === page.cursor.ts && cursor.id === page.cursor.id) throw new Error("The management report cursor did not advance.");
                cursor = page.cursor;
              }
            }
            for (const storeId of ids) {
              let cursor: { ts: string; id: string } | null = null;
              for (;;) {
                if (signal.aborted) throw new Error("Report read cancelled");
                const page = await loadSalesPage(storeId, cursor, 500, {
                  from: new Date(start).toISOString(), to: new Date(end).toISOString(), source,
                });
                if (signal.aborted) throw new Error("Report read cancelled");
                for (const sale of page.rows) {
                  const at = Date.parse(sale.createdAt);
                  if (at >= start && at <= end && inPosDayRange(sale.createdAt, from, to, reportZone) &&
                    (!storeKey || ids.some(id => canonicalBranchId(id) === canonicalBranchId(sale.storeId)))) found.push(sale);
                }
                const oldest = page.rows.at(-1);
                if (!page.hasMore || !page.cursor || !oldest || Date.parse(oldest.createdAt) < start)
                  break;
                if (cursor?.ts === page.cursor.ts && cursor.id === page.cursor.id) break;
                cursor = page.cursor;
              }
            }
            return found;
          },
        });
        if (!cancelled) {
          // Consume this refresh only after success. Keeping revision > 0 as a
          // permanent force flag made every later range revisit bypass cache.
          completedRevision.current = revision;
          setLoaded({ key: rangeKey, rows: found });
        }
      } catch (reason) {
        if (!cancelled)
          setError((reason as Error).message || "Could not load the full report history");
      } finally {
        if (!cancelled) {
          work.running = false;
          setLoading(false);
          if (work.queued) setRevision(value => value + 1);
        }
      }
    })();
    return () => {
      cancelled = true;
      releaseRead();
    };
  }, [from, to, storeKey, rangeKey, revision, enabled, reportZone, queryClient, source, managementReplica, offlineRead]);

  const sales = useMemo(() => {
    // Live committed state wins over an older page snapshot (for example a refund).
    const rows = loaded?.key === rangeKey ? loaded.rows : [];
    return uniqueSales([...rows, ...seedRows]).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }, [seedRows, loaded, rangeKey]);

  const sameScope = loaded?.key === rangeKey;
  return { sales: enabled ? sales : [], loading: enabled && loading && !sameScope, refreshing: enabled && loading && sameScope, error: enabled ? error : "" };
}
