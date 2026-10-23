import { subscribeBackgroundRefresh } from "./background-refresh";
import { subscribeSalesChange } from "./sync-engine";
import { useEffect, useMemo, useRef, useState } from "react";
import { loadSalesPage } from "@/core/api/pos-db";
import type { Sale } from "@/core/types/pos-types";
import { uniqueSales } from "./sale-identity";
import { canonicalBranchId } from "./branch-id";
import { useAuth } from "./pos-auth";
import { sessionEpoch } from "./session-epoch";

import { effectiveTimeZone, inPosDayRange, reportScanStart as dayStart, reportScanEnd as dayEnd } from "./time-zone";

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
): { sales: Sale[]; loading: boolean; refreshing: boolean; error: string } {
  const { ready, user } = useAuth();
  enabled = enabled && ready && Boolean(user);
  const reportZone = effectiveTimeZone();
  const storeKey = storeIds.filter(Boolean).map(canonicalBranchId).sort().join("|");
  const seedRows = useMemo(() => {
    const start = dayStart(from);
    const end = dayEnd(to);
    const stores = new Set(storeIds.filter(Boolean).map(canonicalBranchId));
    return seed.filter((sale) => {
      const at = Date.parse(sale.createdAt);
      return (
        at >= start && at <= end && inPosDayRange(sale.createdAt, from, to, reportZone) && (!stores.size || stores.has(canonicalBranchId(sale.storeId)))
      );
    });
  }, [seed, storeIds, from, to, reportZone]);
  const [revision, setRevision] = useState(0);
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
    const offCatchup = subscribeBackgroundRefresh(refresh, 300_000);
    return () => {
      off();
      if (timer) clearTimeout(timer);
      offCatchup();
    };
  }, [enabled, storeKey]);
  const [loaded, setLoaded] = useState<{ key: string; rows: Sale[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const rangeKey = JSON.stringify([user?.staffId, sessionEpoch(), storeKey, from, to, reportZone]);

  useEffect(() => {
    let cancelled = false;
    if (!enabled) return;
    const ids = storeKey ? storeKey.split("|") : [""];
    const start = dayStart(from);
    const end = dayEnd(to);
    const work = { running: true, queued: false };
    refreshState.current = work;
    setLoading(true);
    setError("");

    void (async () => {
      try {
        const found: Sale[] = [];
        for (const storeId of ids) {
          if (cancelled) return;
          let cursor: { ts: string; id: string } | null = null;
          for (;;) {
            if (cancelled) return;
            const page = await loadSalesPage(storeId, cursor, 500, {
              from: new Date(start).toISOString(), to: new Date(end).toISOString(),
            });
            if (cancelled) return;
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
        if (!cancelled) setLoaded({ key: rangeKey, rows: found });
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
    };
  }, [from, to, storeKey, rangeKey, revision, enabled, reportZone]);

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
