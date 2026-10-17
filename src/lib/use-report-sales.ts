import { subscribeSalesChange } from "./sync-engine";
import { useEffect, useMemo, useState } from "react";
import { loadSalesPage } from "@/core/api/pos-db";
import type { Sale } from "@/core/types/pos-types";
import { uniqueSales } from "./sale-identity";
import { canonicalBranchId } from "./branch-id";

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
  const reportZone = effectiveTimeZone();
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
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = subscribeSalesChange(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        setRevision((value) => value + 1);
      }, 100);
    });
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => {
      off();
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [enabled]);
  const [loaded, setLoaded] = useState<{ key: string; rows: Sale[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const storeKey = storeIds.filter(Boolean).sort().join("|");

  const rangeKey = JSON.stringify([storeKey, from, to, reportZone]);

  useEffect(() => {
    let cancelled = false;
    if (!enabled) return;
    const ids = storeKey ? storeKey.split("|") : [""];
    const start = dayStart(from);
    const end = dayEnd(to);
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
            const page = await loadSalesPage(storeId, cursor, 500);
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
        if (!cancelled) setLoading(false);
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
  return { sales, loading: loading && !sameScope, refreshing: loading && sameScope, error };
}
