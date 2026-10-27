import { companyStoreScope } from "@/lib/company-store-scope";
import { allShopsScope, allShopsTotalsScope, shopClusterKey } from "@/lib/all-shops-scope";
import { useAllShopsLifetime } from "@/lib/use-all-shops-lifetime";
import { FinancialBreakdown, FinancialInfoTip, GrossProfitInfo, SalesTotalInfo } from "@/platforms/web/components/pos/FinancialInfo";
import { salesReconciliation } from "@/lib/sales-reconciliation";
import { SummaryCardRail } from "@/platforms/web/components/pos/SummaryCardRail";
import { HomeShortcuts } from "@/platforms/web/components/pos/HomeShortcuts";
import { formatDateTime as posDisplayDateTime } from "@/lib/time-zone";
import { inventoryMetrics, isLowStock } from "@/lib/inventory-metrics";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { Download, Search } from "lucide-react";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TablePagination, usePagination } from "@/platforms/web/components/pos/TablePagination";
import { money, stockAt, usePos } from "@/lib/pos-store";
import { useAuth } from "@/lib/pos-auth";
import { createCatalogueVisibility } from "@/lib/branch-policy";
import { groupStockLocations } from "@/lib/all-shops-stock";
import { canonicalBranchId, sameBranchId } from "@/lib/branch-id";
import { useReportSales } from "@/lib/use-report-sales";
import {
  isoDay,
  inRange,
  ReportFilters,
  downloadReport,
} from "@/platforms/web/components/pos/report-kit";
import { ReportReceiptLink } from "@/platforms/web/components/pos/ReportReceiptLink";
import { profitOf } from "@/core/pricing/profit";

export const Route = createFileRoute("/all-shops")({
  head: () => ({
    meta: [
      { title: "All Shops — Retail" },
      {
        name: "description",
        content:
          "Live takings and shift status for every branch, with group sales performance and stock export.",
      },
      { property: "og:title", content: "All Shops — Retail" },
      {
        property: "og:description",
        content: "Group-wide sales and inventory in a single panel.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AllShops,
});

function AllShops() {
  const { state, stores: directoryStores, currentStore, ready: inventoryReady, loadPhase } = usePos();
  const { can, isAdmin, user, terminalStoreId, canSwitchStores } = useAuth();
  const unrestrictedManagement = canSwitchStores && !terminalStoreId && !user?.storeId;
  const stores = useMemo(() => allShopsScope(directoryStores, terminalStoreId || user?.storeId || currentStore.id,
    unrestrictedManagement),
  [directoryStores, terminalStoreId, user?.storeId, currentStore.id, unrestrictedManagement]);
  const [totalsSelection, setTotalsSelection] = useState<string | null>(null);
  const selectedCluster = totalsSelection && (totalsSelection === "all" ? unrestrictedManagement : stores.some(store=>shopClusterKey(store)===totalsSelection))
    ? totalsSelection : shopClusterKey(stores.find(store=>sameBranchId(store.id,currentStore.id)) ?? stores[0] ?? currentStore);
  const totalStores = useMemo(() => allShopsTotalsScope(stores, selectedCluster), [stores, selectedCluster]);
  const clusterOptions = useMemo(() => [...new Map(stores.map(store => [shopClusterKey(store), {
    key: shopClusterKey(store), label: store.groupId ? `Cluster ${store.groupId}` : store.name,
  }])).values()], [stores]);
  const catalogueVisibleAt = useMemo(() => createCatalogueVisibility(state.settings, state.stores, state.transfers),
    [state.settings, state.stores, state.transfers]);
  const stockStores = useMemo(
    () => groupStockLocations(companyStoreScope(stores, terminalStoreId || user?.storeId || currentStore.id,
      !unrestrictedManagement), state.settings, currentStore.id),
    [stores, state.settings, currentStore.id, terminalStoreId, user?.storeId, unrestrictedManagement],
  );
  const stockStoreIds = useMemo(
    () => new Set(groupStockLocations(stores, state.settings, currentStore.id).map((store) => canonicalBranchId(store.id))),
    [stores, state.settings, currentStore.id],
  );
  const allowed = isAdmin || can("can_view_inventory");
  const showMoney = isAdmin || can("can_view_sales_reports");
  const showCostMargin = isAdmin || can("can_view_cost_margin");
  const canExport = can("can_export_reports");
  const storeIds = useMemo(() => stores.map((store) => store.id), [stores]);
  const periodStoreIds = useMemo(() => totalStores.map(store=>store.id),[totalStores]);
  const today = isoDay(new Date());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const history = useReportSales(state.sales, periodStoreIds, from, to, isAdmin && periodStoreIds.length > 0);
  const lifetime = useAllShopsLifetime(storeIds,today,showMoney,showCostMargin);
  const [query, setQuery] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [category, setCategory] = useState("all");

  const categories = useMemo(
    () => ["all", ...Array.from(new Set(state.products.filter(product => stockStores.some(store => catalogueVisibleAt(product,store.id))).map((p) => p.category))).sort()],
    [state.products, stockStores, catalogueVisibleAt],
  );

  const perStore = stores.map((store) => {
    const totals = lifetime.totals?.[canonicalBranchId(store.id)];
    const shift = state.shifts.find(
      (s) => sameBranchId(s.storeId, store.id) && s.status !== "CLOSED" && !s.closedAt,
    );
    const metrics = inventoryMetrics(state.products.filter(product => catalogueVisibleAt(product, store.id)), store.id);
    const stockValue = metrics.costValue;
    const low = metrics.lowStock;
    return {
      store,
      totals,
      shift,
      stockValue,
      low,
      stockVisible: stockStoreIds.has(canonicalBranchId(store.id)),
    };
  });

  /** Group-wide live performance — administrators only. */
  const live = useMemo(() => {
    const visibleStoreIds = new Set(totalStores.map((store) => canonicalBranchId(store.id)));
    const todays = history.sales.filter(
      (sale) =>
        visibleStoreIds.has(canonicalBranchId(sale.storeId)) &&
        inRange(sale.createdAt, from, to) &&
        !sale.refunded,
    );
    const financial = profitOf(todays, state.products);
    return {
      revenue: financial.revenue,
      cost: financial.cogs,
      profit: financial.profit,
      totals: salesReconciliation(todays),
      bills: todays.length,
      basket: todays.length ? financial.revenue / todays.length : 0,
      feed: [...todays].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    };
  }, [history.sales, state.products, totalStores, from, to]);
  const billPager = usePagination(live.feed, 25);

  const rows = state.products.filter((p) => {
    if (!stockStores.some((s2) => catalogueVisibleAt(p, s2.id))) return false;
    if (category !== "all" && p.category !== category) return false;
    if (
      query &&
      !`${p.name} ${p.sku} ${p.barcode} ${p.category}`.toLowerCase().includes(query.toLowerCase())
    )
      return false;
    if (lowOnly && (p.archived === true || !stockStores.some((s) => catalogueVisibleAt(p, s.id) && isLowStock(stockAt(p, s.id), p.reorderLevel)))) return false;
    return true;
  });

  function exportCsv() {
    downloadReport("all-shops-stock", [
      ["Product", "SKU", "Category", ...stockStores.map((store) => store.name), "Total"],
      ...rows.map((product) => {
        const quantities = stockStores.map((store) => stockAt(product, store.id));
        return [
          product.name,
          product.sku,
          product.category,
          ...quantities,
          quantities.reduce((sum, quantity) => sum + quantity, 0),
        ];
      }),
    ]);
  }
  if (!allowed)
    return (
      <AppShell>
        <div className="p-6 text-sm text-muted-foreground">
          You do not have permission to view group inventory.
        </div>
      </AppShell>
    );

  return (
    <AppShell>
      <div className="pos-page-container">
        <header className="min-w-0 space-y-3">
          <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
            <h1 className="text-2xl font-semibold">All shops</h1>
            <HomeShortcuts />
          </div>
          <div>
            <p className="text-sm text-muted-foreground page-description">
              Shop cards show sales and profit to date through {today}. The date filters apply to sales performance and bills below, using the store time zone. Stock and shifts show the current state; stock export stays within the selected cluster.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
            <ReportFilters title="All Shops filters">
              {isAdmin && (
                <div className="flex flex-wrap gap-3">
                  <label className="space-y-1 text-sm">
                    <span>From</span>
                    <Input
                      type="date"
                      value={from}
                      max={to}
                      onChange={(e) => {
                        if (e.target.value) setFrom(e.target.value > to ? to : e.target.value);
                      }}
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span>To</span>
                    <Input
                      type="date"
                      value={to}
                      min={from}
                      onChange={(e) => {
                        if (e.target.value) setTo(e.target.value < from ? from : e.target.value);
                      }}
                    />
                  </label>
                </div>
              )}{" "}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search products"
                    className="w-56 pl-9"
                  />
                </div>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                  aria-label="Category"
                >
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c === "all" ? "All categories" : c}
                    </option>
                  ))}
                </select>
                <Button
                  variant={lowOnly ? "default" : "outline"}
                  size="sm"
                  onClick={() => setLowOnly((v) => !v)}
                >
                  Below reorder level
                </Button>
              </div>
            </ReportFilters>{" "}
            {canExport && (
              <Button variant="outline" size="sm" onClick={exportCsv}>
                <Download className="size-4" /> Export Excel
              </Button>
            )}
          </div>
        </header>

        {history.error && (
          <p role="alert" className="rounded-xl border border-warning/30 bg-warning/5 p-3 text-sm">
            Could not refresh trading data: {history.error}
          </p>
        )}
        {showMoney && (history.loading || history.refreshing) && (
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
            {history.loading ? "Loading sales for the selected dates…" : "Updating sales…"}
          </p>
        )}
        {lifetime.error && <p role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">Could not refresh shop totals: {lifetime.error}</p>}
        {lifetime.loading && <p role="status" className="text-sm text-muted-foreground">Loading shop totals to date…</p>}
        {!stores.length && (
          <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            No active branches are available to this account.
          </p>
        )}

        <SummaryCardRail label="Shop summaries">
          {perStore.map((s) => (
            <div key={s.store.id} className="min-w-0 rounded-lg border border-border bg-card p-4 [overflow-wrap:anywhere]">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{s.store.name}</p>
                  <p className="text-xs text-muted-foreground">{s.store.code}</p>
                </div>
                {showMoney && (
                  <Badge variant={s.shift ? "secondary" : "destructive"}>
                    {s.shift ? "Current shift open" : "Current shift closed"}
                  </Badge>
                )}
              </div>
              <p className="numeric mt-3 min-w-0 text-xl font-semibold [overflow-wrap:anywhere]">
                {showMoney && s.totals ? money(s.totals.revenue) : "—"}
              </p>
              {showMoney && <p className="text-xs text-muted-foreground">Net sales to date · through {today}{s.totals && <FinancialInfoTip label={`${s.store.name} net sales to date`}><FinancialBreakdown rows={[["Net sales to date", money(s.totals.revenue)]]}><p>Sales after discounts, excluding tax and rounding, through {today}. Refunded bills are excluded. This summary does not include individual bill deductions.</p></FinancialBreakdown></FinancialInfoTip>}</p>}
              {showCostMargin && showMoney && <p className="mt-1 text-sm">Gross profit to date <span className="numeric font-semibold">{s.totals ? money(s.totals.profit) : "—"}</span>{s.totals && <FinancialInfoTip label={`${s.store.name} gross profit to date`}><FinancialBreakdown rows={[["Net sales to date", money(s.totals.revenue)], ["Gross profit to date", money(s.totals.profit)]]}><p>Gross profit is net sales less cost of goods sold, before other operating expenses. This summary does not include the separate cost or bill deductions.</p></FinancialBreakdown></FinancialInfoTip>}</p>}
              <p className="text-xs text-muted-foreground">
                {showMoney ? (
                  <>
                    {s.totals ? `${s.totals.bills} bills to date` : "Shop totals unavailable"}
                    {!s.stockVisible ? " · Private stock" : !inventoryReady ? (loadPhase === "failed" ? " · Stock unavailable" : " · Stock loading…") : !showCostMargin ? " · Stock value restricted" : Math.abs(s.stockValue) >= 0.005 ? " · current stock " + money(s.stockValue) : null}
                  </>
                ) : (
                  "Stock quantities only"
                )}
              </p>
              {s.stockVisible && inventoryReady && s.low > 0 && (
                <p className="mt-1 text-xs text-warning">{s.low} below reorder level</p>
              )}
            </div>
          ))}
        </SummaryCardRail>

        {isAdmin && (
          <section className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">Sales performance · {selectedCluster === "all" ? "all authorized clusters" : clusterOptions.find(option=>option.key===selectedCluster)?.label ?? "selected cluster"}</h2>
              <span className="text-[11px] text-muted-foreground">
                Visible to administrators only
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <label className="flex items-center gap-2">Totals and bills
                <select aria-label="Cluster for totals and bills" value={selectedCluster} onChange={event=>setTotalsSelection(event.target.value)} className="h-9 max-w-full rounded-md border border-border bg-background px-2">
                  {unrestrictedManagement && <option value="all">All authorized clusters</option>}
                  {clusterOptions.map(option=><option key={option.key} value={option.key}>{option.label}</option>)}
                </select>
              </label>
              <span className="text-xs text-muted-foreground">{from} to {to} · Shop cards remain separate.</span>
            </div>
            <p className="text-xs text-muted-foreground">Net sales exclude tax and rounding. Collected includes the stored bill total after discounts, tax and rounding. Refunded bills are excluded.</p>
            <SummaryCardRail label="Selected-period shop totals">
              <Kpi label="Net sales · selected dates" value={money(live.revenue)} info={!history.loading && !history.error && <SalesTotalInfo totals={live.totals} />} />
              <Kpi label="Gross profit" value={money(live.profit)} info={<GrossProfitInfo revenue={live.revenue} cost={live.cost} profit={live.profit} />} />
              <Kpi label="Bills" value={String(live.bills)} />
              <Kpi label="Average basket · net sales" value={money(live.basket)} info={<FinancialBreakdown rows={[["Net sales", money(live.revenue)], ["Completed bills", String(live.bills)], ["Average basket", money(live.basket)]]}><p>Net sales ÷ completed bills for the selected dates.</p></FinancialBreakdown>} />
            </SummaryCardRail>
            <div className="overflow-auto rounded-md border border-border bg-card">
              <Table tableId="routes/all-shops#1">
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Bill</TableHead>
                    <TableHead>Cashier</TableHead>
                    <TableHead className="text-right">Collected</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {billPager.pageItems.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="numeric text-xs">
                        {posDisplayDateTime(new Date(s.createdAt))}
                      </TableCell>
                      <TableCell className="text-xs">
                        {stores.find((x) => x.id === s.storeId)?.name ?? "—"}
                      </TableCell>
                      <TableCell data-sort-value={s.receiptNo}>
                        <ReportReceiptLink sale={s} />
                      </TableCell>
                      <TableCell className="text-xs">{s.cashier}</TableCell>
                      <TableCell className="numeric text-right font-medium">
                        {money(s.total)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!live.feed.length && (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="py-6 text-center text-sm text-muted-foreground"
                      >
                        No bills in the selected dates.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              <TablePagination
                {...billPager}
                label="bills"
                onPage={billPager.setPage}
                onPageSize={billPager.setPageSize}
              />
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}

function Kpi({ label, value, info }: { label: string; value: string; info?: ReactNode }) {
  return (
    <div className="summary-card rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-1"><p className="text-xs text-muted-foreground">{label}</p>{info && <FinancialInfoTip label={label}>{info}</FinancialInfoTip>}</div>
      <p className="numeric mt-1 min-w-0 text-xl font-semibold [overflow-wrap:anywhere]">{value}</p>
    </div>
  );
}
