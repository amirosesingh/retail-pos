import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadStockActivityPage } from "@/lib/stock-activity-client";
import type { StockActivityPage, StockActivityRequest } from "@/lib/stock-activity-query";
import { stockActivityAtCutoff, type StockActivityRecord } from "@/lib/stock-activity-history";
import { stockInstant } from "@/lib/stock-as-of";
import { sessionEpoch } from "@/lib/session-epoch";

const activityPageSize = 25;
const evidencePages = 10;

type ActivityPageState = {
  key: string;
  pages: StockActivityPage[];
  page: StockActivityPage | null;
  number: number;
  loading: boolean;
  error: string;
};

function emptyPage(key: string, loading: boolean): ActivityPageState {
  return { key, pages: [], page: null, number: 1, loading, error: "" };
}

export function useStockReportActivityPage(
  identity: string,
  branchId: string | undefined,
  cutoff: string | undefined,
  side: StockActivityRequest["side"],
  productId?: string,
) {
  const key = JSON.stringify([identity, branchId, cutoff, side, productId]);
  const current = useRef(key);
  current.current = key;
  const generation = useRef(0);
  const enabled = Boolean(branchId && cutoff);
  const [state, setState] = useState(() => emptyPage(key, enabled));

  const load = useCallback(async (cursor?: NonNullable<StockActivityRequest["cursor"]>, number = 1) => {
    if (!branchId || !cutoff) return;
    const sequence = ++generation.current;
    const epoch = sessionEpoch();
    const isCurrent = () => sequence === generation.current && current.current === key && sessionEpoch() === epoch;
    setState(previous => ({ ...(previous.key === key ? previous : emptyPage(key, true)), loading: true }));

    try {
      const page = await loadStockActivityPage({ branchId, cutoff, side, productId, cursor, limit: activityPageSize });
      if (!isCurrent()) return;
      if (page.branchId !== branchId || stockInstant(page.cutoff) !== stockInstant(cutoff)
        || page.side !== side || (page.productId ?? undefined) !== productId) {
        throw new Error("The inventory activity source returned a different location, item, or time.");
      }
      setState(previous => {
        const pages = cursor ? previous.pages : [];
        const next = pages.at(-1)?.next;
        const extendsEvidence = !cursor || (number === pages.length + 1 && pages.length < evidencePages
          && next?.id === cursor.id && next.occurredAt === cursor.occurredAt);
        return { key, pages: extendsEvidence ? [...pages, page] : pages, page, number, loading: false, error: "" };
      });
    } catch (failure) {
      if (!isCurrent()) return;
      setState({ ...emptyPage(key, false),
        error: failure instanceof Error ? failure.message : "Inventory activity could not be loaded." });
    }
  }, [branchId, cutoff, key, productId, side]);

  useEffect(() => {
    void load();
    const lifecycle = { generation };
    return () => { lifecycle.generation.current++; };
  }, [load]);

  const evidence = useMemo(() => {
    const first = state.pages[0];
    return first ? { ...first, rows: state.pages.flatMap(page => page.rows), next: state.pages.at(-1)?.next ?? null } : null;
  }, [state.pages]);
  const visible = state.key === key ? state : emptyPage(key, enabled);
  const openCachedPage = (number: number) => {
    const page = visible.pages[number - 1];
    if (!page) return false;
    setState({ ...visible, page, number, error: "" });
    return true;
  };
  return {
    page: visible.page, number: visible.number, loading: visible.loading, error: visible.error,
    evidence: state.key === key ? evidence : null,
    evidenceLimit: visible.pages.length === evidencePages && evidence?.next ? evidencePages * activityPageSize : null,
    firstPage: () => { if (!openCachedPage(1)) void load(); },
    nextPage: () => {
      if (visible.page?.next && !openCachedPage(visible.number + 1)) void load(visible.page.next, visible.number + 1);
    },
  };
}

export type StockReportActivitySide = ReturnType<typeof useStockReportActivityPage>;

export type StockActivityProduct = { productId: string; name: string; sku?: string | null; barcode?: string | null };

export function reportActivityEvidence(before: StockActivityPage | null, after: StockActivityPage | null) {
  const scope = before ?? after;
  const groups = new Map<string, StockActivityRecord[]>();
  const latest = new Map<string, string>();
  const balances = new Map<string, { quantity: number; supportedAt: string }>();
  const records = [...(before?.rows ?? []), ...(after?.rows ?? [])];
  for (const row of records) {
    const group = groups.get(row.productId) ?? [];
    group.push(row);
    groups.set(row.productId, group);
  }
  if (!scope) return { latest, balances };

  const oldest = before?.rows.at(-1)?.occurredAt;
  const throughCoverage = before && (before.next ? (oldest ? { after: oldest } : undefined) : "all");
  for (const [productId, rows] of groups) {
    const evidence = stockActivityAtCutoff(rows, {
      productId, branchId: scope.branchId, cutoff: scope.cutoff,
      throughCoverage: throughCoverage || undefined, nearestAfterLoaded: Boolean(after),
    });
    if (evidence.balance) balances.set(productId, evidence.balance);
    for (const row of evidence.movements) {
      const hasChange = row.delta !== null ? row.delta !== 0 : row.before !== null && row.after !== null && row.before !== row.after;
      if (row.position !== "through-cutoff" || !hasChange) continue;
      const existing = latest.get(productId);
      if (!existing || stockInstant(row.occurredAt) > stockInstant(existing)) latest.set(productId, row.occurredAt);
    }
  }
  return { latest, balances };
}
