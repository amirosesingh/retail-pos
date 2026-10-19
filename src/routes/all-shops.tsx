import { inventoryMetrics, isLowStock } from "@/lib/inventory-metrics";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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
import { productVisibleAt } from "@/lib/branch-policy";
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
import { profitOf, saleNetRevenue } from "@/core/pricing/profit";

export const Route = createFileRoute("/all-shops")({
  head: () => ({
    meta: [
      { title: "All Shops — Retail" },
      {
        name: "description",
        content:
          "Live takings and shift status for every branch, plus one stock table showing each product's inventory across all shops.",
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
  const { state, stores, currentStore } = usePos();
  const stockStores = useMemo(
    () => groupStockLocations(stores, state.settings, currentStore.id),
    [stores, state.settings, currentStore.id],
  );
  const stockStoreIds = useMemo(
    () => new Set(stockStores.map((store) => canonicalBranchId(store.id))),
    [stockStores],
  );
  const { can, isAdmin } = useAuth();
  const allowed = isAdmin || can("can_view_inventory");
  const showMoney = isAdmin || can("can_view_sales_reports");
  const canExport = can("can_export_reports");
  const storeIds = useMemo(() => stores.map((store) => store.id), [stores]);
  const today = isoDay(new Date());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const history = useReportSales(state.sales, storeIds, from, to, showMoney);
  const [query, setQuery] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [category, setCategory] = useState("all");

  const categories = useMemo(
    () => ["all", ...Array.from(new Set(state.products.map((p) => p.category))).sort()],
    [state.products],
  );

  const perStore = stores.map((store) => {
    const sales = history.sales.filter(
      (s) => sameBranchId(s.storeId, store.id) && inRange(s.createdAt, from, to) && !s.refunded,
    );
    const shift = state.shifts.find(
      (s) => sameBranchId(s.storeId, store.id) && s.status !== "CLOSED" && !s.closedAt,
    );
    const metrics = inventoryMetrics(state.products.filter(product => productVisibleAt(state.settings, product, store.id)), store.id);
    const stockValue = metrics.costValue;
    const low = metrics.lowStock;
    return {
      store,
      revenue: sales.reduce((a, s) => a + saleNetRevenue(s), 0),
      count: sales.length,
      shift,
      stockValue,
      low,
      stockVisible: stockStoreIds.has(canonicalBranchId(store.id)),
    };
  });

  /** Group-wide live performance — administrators only. */
  const live = useMemo(() => {
    const visibleStoreIds = new Set(stores.map((store) => canonicalBranchId(store.id)));
    const todays = history.sales.filter(
      (sale) =>
        visibleStoreIds.has(canonicalBranchId(sale.storeId)) &&
        inRange(sale.createdAt, from, to) &&
        !sale.refunded,
    );
    const financial = profitOf(todays, state.products);
    return {
      revenue: financial.revenue,
      profit: financial.profit,
      bills: todays.length,
      basket: todays.length ? financial.revenue / todays.length : 0,
      feed: [...todays].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    };
  }, [history.sales, state.products, stores, from, to]);
  const billPager = usePagination(live.feed, 25);

  const rows = state.products.filter((p) => {
    if (!stockStores.some((s2) => productVisibleAt(state.settings, p, s2.id))) return false;
    if (category !== "all" && p.category !== category) return false;
    if (
      query &&
      !`${p.name} ${p.sku} ${p.barcode} ${p.category}`.toLowerCase().includes(query.toLowerCase())
    )
      return false;
    if (lowOnly && (p.archived === true || !stockStores.some((s) => productVisibleAt(state.settings, p, s.id) && isLowStock(stockAt(p, s.id), p.reorderLevel)))) return false;
    return true;
  });
  const pager = usePagination(rows, 25);

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
      <div className="mx-auto w-full max-w-[1600px] space-y-5 p-4 sm:p-6">
        {history.error && <p role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">Report incomplete: {history.error}</p>}
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">All shops</h1>
            <p className="text-sm text-muted-foreground">
              Sales from {from} to {to}. Stock quantities and shift status show the current state.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ReportFilters title="All Shops filters">
              {showMoney && (
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

        {isAdmin && (
          <section className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">Sales performance · all branches</h2>
              <span className="text-[11px] text-muted-foreground">
                Visible to administrators only
              </span>
            </div>
            <div className="summary-grid grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi label="Revenue · selected dates" value={money(live.revenue)} />
              <Kpi label="Gross profit" value={money(live.profit)} />
              <Kpi label="Bills" value={String(live.bills)} />
              <Kpi label="Average basket" value={money(live.basket)} />
            </div>
            <div className="overflow-auto rounded-md border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Bill</TableHead>
                    <TableHead>Cashier</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {billPager.pageItems.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="numeric text-xs">
                        {new Date(s.createdAt).toLocaleString()}
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
        {!stores.length && (
          <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            No active branches are available to this account.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {perStore.map((s) => (
            <div key={s.store.id} className="rounded-lg border border-border bg-card p-4">
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
              <p className="numeric mt-3 text-xl font-semibold">
                {showMoney ? money(s.revenue) : "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                {showMoney ? (
                  <>
                    {s.count} bill{s.count === 1 ? "" : "s"} in selected dates ·{" "}
                    {s.stockVisible ? "current stock " + money(s.stockValue) : "Private stock"}
                  </>
                ) : (
                  "Stock quantities only"
                )}
              </p>
              {s.stockVisible && (
                <p className="mt-1 text-xs text-warning">{s.low} below reorder level</p>
              )}
            </div>
          ))}
        </div>

        <div className="overflow-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>SKU</TableHead>
                {stockStores.map((s) => (
                  <TableHead key={s.id} className="text-right">
                    {s.code}
                  </TableHead>
                ))}
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pager.pageItems.map((p) => {
                const per = stockStores.map((s) => ({ store: s, qty: stockAt(p, s.id) }));
                return (
                  <TableRow key={p.id}>
                    <TableCell>
                      <span className="block text-sm">{p.name}</span>
                      <span className="block text-xs text-muted-foreground">{p.category}</span>
                    </TableCell>
                    <TableCell className="numeric text-xs text-muted-foreground">{p.sku}</TableCell>
                    {per.map(({ store, qty }) => (
                      <TableCell
                        key={store.id}
                        className={`numeric text-right ${qty <= 0 ? "text-destructive" : isLowStock(qty, p.reorderLevel) ? "text-warning" : ""}`}
                      >
                        {qty}
                      </TableCell>
                    ))}
                    <TableCell className="numeric text-right font-medium">
                      {per.reduce((a, b) => a + b.qty, 0)}
                    </TableCell>
                  </TableRow>
                );
              })}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={stockStores.length + 3}
                    className="py-8 text-center text-sm text-muted-foreground"
                  >
                    No products match this filter.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <TablePagination
          page={pager.page}
          pageCount={pager.pageCount}
          pageSize={pager.pageSize}
          total={pager.total}
          from={pager.from}
          to={pager.to}
          label="products"
          onPage={pager.setPage}
          onPageSize={pager.setPageSize}
        />
      </div>
    </AppShell>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary-card rounded-lg border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="numeric mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}
