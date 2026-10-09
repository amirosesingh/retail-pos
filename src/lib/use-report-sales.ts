import { subscribeSalesChange } from "./sync-engine";
import { useEffect, useMemo, useState } from "react";
import { loadSalesPage } from "@/core/api/pos-db";
import type { Sale } from "@/core/types/pos-types";
import { uniqueSales } from "./sale-identity";
import { canonicalBranchId } from "./branch-id";

const dayStart = (value: string) => Date.parse(`${value}T00:00:00`);
const dayEnd = (value: string) => Date.parse(`${value}T23:59:59.999`);

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
): { sales: Sale[]; loading: boolean; error: string } {
  const seedRows = useMemo(() => {
    const start = dayStart(from);
    const end = dayEnd(to);
    const stores = new Set(storeIds.filter(Boolean).map(canonicalBranchId));
    return seed.filter((sale) => {
      const at = Date.parse(sale.createdAt);
      return at >= start && at <= end && (!stores.size || stores.has(canonicalBranchId(sale.storeId)));
    });
  }, [seed, storeIds, from, to]);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = subscribeSalesChange(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setRevision(value => value + 1), 400);
    });
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => { off(); if (timer) clearTimeout(timer); window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh); };
  }, []);
  const [loaded, setLoaded] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const storeKey = storeIds.filter(Boolean).sort().join("|");

  useEffect(() => {
    let cancelled = false;
    const ids = storeKey ? storeKey.split("|") : [""];
    const start = dayStart(from);
    const end = dayEnd(to);
    setLoaded([]);
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
            for (const sale of page.rows) {
              const at = Date.parse(sale.createdAt);
              if (at >= start && at <= end) found.push(sale);
            }
            const oldest = page.rows.at(-1);
            if (!page.hasMore || !page.cursor || !oldest || Date.parse(oldest.createdAt) < start) break;
            if (cursor?.ts === page.cursor.ts && cursor.id === page.cursor.id) break;
            cursor = page.cursor;
          }
        }
        if (!cancelled) setLoaded(found);
      } catch (reason) {
        if (!cancelled) setError((reason as Error).message || "Could not load the full report history");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [from, to, storeKey, revision]);

  const sales = useMemo(() => {
    // Live committed state wins over an older page snapshot (for example a refund).
    return uniqueSales([...loaded, ...seedRows]).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [seedRows, loaded]);

  return { sales, loading, error };
}
