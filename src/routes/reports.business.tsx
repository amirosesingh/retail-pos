import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { Label } from "@/components/ui/label";
import { ThemedSelect } from "@/platforms/web/components/pos/ThemedSelect";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TablePagination, usePagination } from "@/platforms/web/components/pos/TablePagination";
import { money, usePos } from "@/lib/pos-store";
import { useReportSales } from "@/lib/use-report-sales";
import { lineCost, saleLineRevenues, saleNetRevenue } from "@/core/pricing/profit";
import {
  ReportHeader,
  StatCard,
  defaultRange,
  downloadCsv,
  inRange,
} from "@/platforms/web/components/pos/report-kit";
import { loadCompleteReceivingHistory } from "@/core/api/pos-db";

export const Route = createFileRoute("/reports/business")({
  head: () => ({
    meta: [
      { title: "Retail Performance Report — Retail" },
      {
        name: "description",
        content:
          "Profitability by product, stock movement speed and cashier performance across every branch and date range.",
      },
      { property: "og:title", content: "Retail Performance Report — Retail" },
      {
        property: "og:description",
        content: "Margin, sell-through speed and takings per cashier in one report.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: BusinessReport,
});

type ProductRow = {
  id: string;
  name: string;
  qty: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
  perDay: number;
  onHand: number;
  daysCover: number;
  arrivalDate: string | null;
};

type CashierRow = {
  name: string;
  bills: number;
  revenue: number;
  profit: number;
  discount: number;
  avgBill: number;
};

function BusinessReport() {
  const { state, stores } = usePos();
  const init = defaultRange(30);
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [storeId, setStoreId] = useState("all");
  const reportStoreIds = storeId === "all" ? stores.map((store) => store.id) : [storeId];
  const history = useReportSales(state.sales, reportStoreIds, from, to);
  const arrivals = useQuery({
    queryKey: ["business-report-arrivals", storeId],
    meta: { tables: ["purchase_orders", "purchase_order_items"] },
    queryFn: () =>
      loadCompleteReceivingHistory(storeId === "all" ? null : storeId, storeId === "all"),
    staleTime: 60_000,
  });
  const arrivedByProduct = useMemo(() => {
    const dates = new Map<string, string>();
    for (const invoice of arrivals.data ?? []) {
      if (storeId !== "all" && invoice.storeId && invoice.storeId !== storeId) continue;
      const arrived = invoice.entryDate || invoice.createdAt;
      for (const line of invoice.lines) {
        if (!line.productId || !arrived) continue;
        const previous = dates.get(line.productId);
        if (!previous || arrived > previous) dates.set(line.productId, arrived);
      }
    }
    return dates;
  }, [arrivals.data, storeId]);
  const [view, setView] = useState<"products" | "cashiers">("products");

  const sales = useMemo(
    () =>
      history.sales.filter(
        (s) =>
          inRange(s.createdAt, from, to) &&
          (storeId === "all" || s.storeId === storeId) &&
          !s.refunded,
      ),
    [history.sales, from, to, storeId],
  );

  const days = Math.max(
    1,
    Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000) + 1,
  );

  const products = useMemo(() => {
    const map = new Map<string, ProductRow>();
    for (const s of sales) {
      const revenues = saleLineRevenues(s);
      for (const [index, l] of s.lines.entries()) {
        if (l.qty <= 0) continue;
        const revenue = Math.max(0, revenues[index] ?? 0);
        const cost = lineCost(l, state.products);
        const row = map.get(l.productId) ?? {
          id: l.productId,
          name: l.name,
          qty: 0,
          revenue: 0,
          cost: 0,
          profit: 0,
          margin: 0,
          perDay: 0,
          onHand: 0,
          daysCover: 0,
          arrivalDate: null,
        };
        row.qty += l.qty;
        row.revenue += revenue;
        row.cost += cost;
        map.set(l.productId, row);
      }
    }
    const out = [...map.values()].map((r) => {
      const product = state.products.find((p) => p.id === r.id);
      const onHand = product
        ? storeId === "all"
          ? Object.values(product.stockByStore).reduce((a, b) => a + b, 0)
          : (product.stockByStore[storeId] ?? 0)
        : 0;
      const perDay = r.qty / days;
      return {
        ...r,
        profit: r.revenue - r.cost,
        margin: r.revenue > 0 ? ((r.revenue - r.cost) / r.revenue) * 100 : 0,
        onHand,
        perDay,
        daysCover: perDay > 0 ? onHand / perDay : 0,
        arrivalDate: arrivedByProduct.get(r.id) ?? product?.createdAt ?? null,
      };
    });
    return out.sort((a, b) => b.profit - a.profit);
  }, [sales, state.products, storeId, days, arrivedByProduct]);

  const cashiers = useMemo(() => {
    const map = new Map<string, CashierRow>();
    for (const s of sales) {
      const key = s.cashier || "Unknown";
      const row = map.get(key) ?? {
        name: key,
        bills: 0,
        revenue: 0,
        profit: 0,
        discount: 0,
        avgBill: 0,
      };
      const cost = s.lines.reduce((a, l) => a + lineCost(l, state.products), 0);
      row.bills += 1;
      const revenue = saleNetRevenue(s);
      row.revenue += revenue;
      row.profit += revenue - cost;
      row.discount += s.discount;
      map.set(key, row);
    }
    return [...map.values()]
      .map((r) => ({ ...r, avgBill: r.bills ? r.revenue / r.bills : 0 }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [sales, state.products]);

  const totals = useMemo(() => {
    const revenue = products.reduce((a, r) => a + r.revenue, 0);
    const profit = products.reduce((a, r) => a + r.profit, 0);
    const slow = products.filter((r) => r.daysCover > 60).length;
    return { revenue, profit, margin: revenue ? (profit / revenue) * 100 : 0, slow };
  }, [products]);

  const prodPage = usePagination(products);
  const cashPage = usePagination(cashiers);

  const exportCsv = () => {
    if (view === "products") {
      downloadCsv("retail-performance-products", [
        [
          "Product",
          "Arrived",
          "Units",
          "Revenue",
          "Cost",
          "Profit",
          "Margin %",
          "Units/day",
          "On hand",
          "Days cover",
        ],
        ...products.map((r) => [
          r.name,
          r.arrivalDate ? r.arrivalDate.slice(0, 10) : "",
          r.qty,
          r.revenue.toFixed(2),
          r.cost.toFixed(2),
          r.profit.toFixed(2),
          r.margin.toFixed(1),
          r.perDay.toFixed(2),
          r.onHand,
          r.daysCover ? r.daysCover.toFixed(1) : "",
        ]),
      ]);
    } else {
      downloadCsv("retail-performance-cashiers", [
        ["Cashier", "Bills", "Revenue", "Profit", "Discount given", "Average bill"],
        ...cashiers.map((r) => [
          r.name,
          r.bills,
          r.revenue.toFixed(2),
          r.profit.toFixed(2),
          r.discount.toFixed(2),
          r.avgBill.toFixed(2),
        ]),
      ]);
    }
  };

  return (
    <AppShell>
      <div className="space-y-5 p-6">
        <ReportHeader
          title="Retail performance"
          subtitle="Where the profit comes from, how fast stock moves, and how each cashier is trading."
          from={from}
          to={to}
          onFrom={setFrom}
          onTo={setTo}
          onExport={exportCsv}
        >
          <div className="space-y-1">
            <Label className="text-xs">Branch</Label>
            <div className="w-52">
              <ThemedSelect
                value={storeId}
                onChange={setStoreId}
                options={[
                  { value: "all", label: "All branches" },
                  ...stores.map((s) => ({ value: s.id, label: s.name })),
                ]}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">View</Label>
            <div className="w-64">
              <ThemedSelect
                value={view}
                onChange={(v: string) => setView(v === "cashiers" ? "cashiers" : "products")}
                options={[
                  { value: "products", label: "Product profitability & velocity" },
                  { value: "cashiers", label: "Cashier performance" },
                ]}
              />
            </div>
          </div>
        </ReportHeader>

        {history.loading ? (
          <p className="text-sm text-muted-foreground">Loading complete SQL history…</p>
        ) : null}
        {history.error ? <p className="text-sm text-destructive">{history.error}</p> : null}

        <div className="grid gap-4 sm:grid-cols-4">
          <StatCard label="Revenue" value={money(totals.revenue)} />
          <StatCard label="Gross profit" value={money(totals.profit)} />
          <StatCard label="Margin" value={`${totals.margin.toFixed(1)}%`} />
          <StatCard
            label="Slow movers"
            value={String(totals.slow)}
            hint="More than 60 days of stock cover at the current selling rate"
          />
        </div>

        <div className="rounded-lg border border-border">
          {view === "products" ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Arrived</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                  <TableHead className="text-right">Units/day</TableHead>
                  <TableHead className="text-right">On hand</TableHead>
                  <TableHead className="text-right">Days cover</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={9}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      Nothing sold in this period.
                    </TableCell>
                  </TableRow>
                ) : (
                  prodPage.pageItems.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {r.arrivalDate
                          ? new Date(r.arrivalDate).toLocaleDateString()
                          : "Not recorded"}
                      </TableCell>
                      <TableCell className="text-right">{r.qty}</TableCell>
                      <TableCell className="text-right">{money(r.revenue)}</TableCell>
                      <TableCell className="text-right">{money(r.profit)}</TableCell>
                      <TableCell className="text-right">{r.margin.toFixed(1)}%</TableCell>
                      <TableCell className="text-right">{r.perDay.toFixed(2)}</TableCell>
                      <TableCell className="text-right">{r.onHand}</TableCell>
                      <TableCell className="text-right">
                        {r.daysCover ? `${r.daysCover.toFixed(0)} d` : "—"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cashier</TableHead>
                  <TableHead className="text-right">Bills</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                  <TableHead className="text-right">Discount given</TableHead>
                  <TableHead className="text-right">Average bill</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cashiers.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      No bills in this period.
                    </TableCell>
                  </TableRow>
                ) : (
                  cashPage.pageItems.map((r) => (
                    <TableRow key={r.name}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-right">{r.bills}</TableCell>
                      <TableCell className="text-right">{money(r.revenue)}</TableCell>
                      <TableCell className="text-right">{money(r.profit)}</TableCell>
                      <TableCell className="text-right">{money(r.discount)}</TableCell>
                      <TableCell className="text-right">{money(r.avgBill)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
          {view === "products" ? (
            <TablePagination
              page={prodPage.page}
              pageCount={prodPage.pageCount}
              pageSize={prodPage.pageSize}
              total={prodPage.total}
              from={prodPage.from}
              to={prodPage.to}
              label="products"
              onPage={prodPage.setPage}
              onPageSize={prodPage.setPageSize}
            />
          ) : (
            <TablePagination
              page={cashPage.page}
              pageCount={cashPage.pageCount}
              pageSize={cashPage.pageSize}
              total={cashPage.total}
              from={cashPage.from}
              to={cashPage.to}
              label="cashiers"
              onPage={cashPage.setPage}
              onPageSize={cashPage.setPageSize}
            />
          )}
        </div>
      </div>
    </AppShell>
  );
}
