import { useEffect, useState } from "react";
import { loadStockActivityBalances } from "@/lib/stock-activity-client";
import { stockActivityAtCutoff, type RecordedStockBalance } from "@/lib/stock-activity-history";
import { stockActivityBalancesRequestSchema, type StockActivityBalancesRequest } from "@/lib/stock-activity-balances";

type BalanceRead = {
  key: string;
  state: "loading" | "complete" | "unsupported" | "failed";
  balances?: ReadonlyMap<string, RecordedStockBalance>;
};

export function useStockAsOfBalances(scope: string, request: StockActivityBalancesRequest | null) {
  const [read, setRead] = useState<BalanceRead | null>(null);
  const key = request?.productIds.length ? JSON.stringify([scope, request]) : "";
  useEffect(() => {
    if (!key) return;
    const parsed = stockActivityBalancesRequestSchema.safeParse((JSON.parse(key) as [string, unknown])[1]);
    if (!parsed.success) return;
    let cancelled = false;
    setRead({ key, state: "loading" });
    void loadStockActivityBalances(parsed.data).then(page => {
      if (cancelled) return;
      if (!page) {
        setRead({ key, state: "unsupported" });
        return;
      }
      const balances = new Map<string, RecordedStockBalance>();
      for (const product of page.products) {
        const { balance } = stockActivityAtCutoff([...product.through, ...product.after], {
          branchId: page.branchId, cutoff: page.cutoff, productId: product.productId,
          // The reader returns each product's own newest contiguous activity.
          // This is recorded evidence and does not grant ledger verification.
          throughCoverage: "all", nearestAfterLoaded: true,
        });
        if (balance) balances.set(product.productId, balance);
      }
      setRead({ key, state: "complete", balances });
    }).catch(() => {
      if (!cancelled) setRead({ key, state: "failed" });
    });
    return () => { cancelled = true; };
  }, [key]);
  return key && read?.key === key ? read : null;
}
