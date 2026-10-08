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
import { privateStockStores, productVisibleAt } from "@/lib/branch-policy";
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

const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

function AllShops() {
  const { state, stores: allStores } = usePos();
  // Branches that keep their stock private are left out of group figures.
  const hidden = useMemo(() => privateStockStores(state.settings), [state.settings]);
  const stores = useMemo(
    () => allStores.filter((store) => !hidden.has(store.id)),
    [allStores, hidden],
  );
  const { can, isAdmin } = useAuth();
  const allowed = isAdmin || can("can_view_inventory");
  const showMoney = isAdmin || can("can_view_sales_reports");
  const canExport = can("can_export_reports");
  const [query, setQuery] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [category, setCategory] = useState("all");

  const categories = useMemo(
    () => ["all", ...Array.from(new Set(state.products.map((p) => p.category))).sort()],
    [state.products],
  );

  const perStore = stores.map((store) => {
    const sales = state.sales.filter(
      (s) => s.storeId === store.id && isToday(s.createdAt) && !s.refunded,
    );
    const shift = state.shifts.find(
      (s) => s.storeId === store.id && s.status !== "CLOSED" && !s.closedAt,
    );
    const stockValue = state.products.reduce((a, p) => a + p.cost * stockAt(p, store.id), 0);
    const low = state.products.filter((p) => stockAt(p, store.id) <= p.reorderLevel).length;
    return {
      store,
      revenue: sales.reduce((a, s) => a + saleNetRevenue(s), 0),
      count: sales.length,
      shift,
      stockValue,
      low,
    };
  });

  /** Group-wide live performance — administrators only. */
  const live = useMemo(() => {
    const visibleStoreIds = new Set(stores.map((store) => store.id));
    const todays = state.sales.filter(
      (sale) =>
        visibleStoreIds.has(sale.storeId) && isToday(sale.createdAt) && !sale.refunded,
    );
    const financial = profitOf(todays, state.products);
    return {
      revenue: financial.revenue,
      profit: financial.profit,
      bills: todays.length,
      basket: todays.length ? financial.revenue / todays.length : 0,
      feed: [...todays].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 12),
    };
  }, [state.sales, state.products, stores]);

  const rows = state.products.filter((p) => {
    if (hidden.size > 0 && !stores.some((s2) => productVisibleAt(state.settings, p, s2.id))) return false;
    if (category !== "all" && p.category !== category) return false;
    if (
      query &&
      !`${p.name} ${p.sku} ${p.barcode} ${p.category}`.toLowerCase().includes(query.toLowerCase())
    )
      return false;
    if (lowOnly && !stores.some((s) => stockAt(p, s.id) <= p.reorderLevel)) return false;
    return true;
  });
  const pager = usePagination(rows, 25);

  function exportCsv() {
    const header = ["Product", "SKU", "Category", ...stores.map((s) => s.code), "Total"];
    const lines = rows.map((p) => {
      const per = stores.map((s) => stockAt(p, s.id));
      return [
        `"${p.name.replace(/"/g, '""')}"`,
        p.sku,
        p.category,
        ...per,
        per.reduce((a, b) => a + b, 0),
      ].join(",");
    });
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `all-shops-stock-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
      <div className="space-y-5 p-6">
        <header>
          <h1 className="text-2xl font-semibold">All shops</h1>
          <p className="text-sm text-muted-foreground">
            Today&apos;s trading and live stock for every branch. Product details are shared across
            shops; stock counts stay per branch.
          </p>
        </header>

        {isAdmin && (
          <section className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">Live performance · all branches</h2>
              <span className="text-[11px] text-muted-foreground">
                Visible to administrators only
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi label="Revenue today" value={money(live.revenue)} />
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
                  {live.feed.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="numeric text-xs">
                        {new Date(s.createdAt).toLocaleTimeString()}
                      </TableCell>
                      <TableCell className="text-xs">
                        {stores.find((x) => x.id === s.storeId)?.name ?? "—"}
                      </TableCell>
                      <TableCell className="numeric text-xs">{s.receiptNo}</TableCell>
                      <TableCell className="text-xs">{s.cashier}</TableCell>
                      <TableCell className="numeric text-right font-medium">
                        {money(s.total)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!live.feed.length && (
                    <TableRow>
                      <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                        No bills yet today.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </section>
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
                    {s.shift ? "Shift open" : "Closed"}
                  </Badge>
                )}
              </div>
              <p className="numeric mt-3 text-xl font-semibold">
                {showMoney ? money(s.revenue) : "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                {showMoney ? (
                  <>
                    {s.count} bill{s.count === 1 ? "" : "s"} today · stock {money(s.stockValue)}
                  </>
                ) : (
                  "Stock quantities only"
                )}
              </p>
              <p className="mt-1 text-xs text-warning">{s.low} below reorder level</p>
            </div>
          ))}
        </div>

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
          {canExport && (
            <Button variant="outline" size="sm" onClick={exportCsv}>
              <Download className="size-4" /> Export CSV
            </Button>
          )}
        </div>

        <div className="overflow-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>SKU</TableHead>
                {stores.map((s) => (
                  <TableHead key={s.id} className="text-right">
                    {s.code}
                  </TableHead>
                ))}
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pager.pageItems.map((p) => {
                const per = stores.map((s) => ({ store: s, qty: stockAt(p, s.id) }));
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
                        className={`numeric text-right ${qty <= p.reorderLevel ? "text-warning" : ""}`}
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
                    colSpan={stores.length + 3}
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
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="numeric mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}
