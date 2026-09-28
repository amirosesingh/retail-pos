import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { money, usePos } from "@/lib/pos-store";
import { savingsOf, soldLines, sumLines } from "@/lib/sales-analytics";
import { useReportSales } from "@/lib/use-report-sales";
import { saleNetRevenue } from "@/core/pricing/profit";
import { ReportHeader, StatCard, defaultRange, inRange } from "@/platforms/web/components/pos/report-kit";

export const Route = createFileRoute("/reports/analytics")({
  head: () => ({
    meta: [
      { title: "Business Analytics Board — Retail" },
      {
        name: "description",
        content:
          "Top selling items, revenue share per shop, daily and monthly revenue with averages, discounts given away and gross profit per branch.",
      },
      { property: "og:title", content: "Business Analytics Board — Retail" },
      {
        property: "og:description",
        content: "Top items, revenue per shop, daily and monthly trends, savings and profit.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AnalyticsBoard,
});

const PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
  "var(--chart-9)",
  "var(--chart-10)",
  "var(--chart-4)",
  "var(--chart-5)",
];

const monthKey = (iso: string) => iso.slice(0, 7);

function AnalyticsBoard() {
  const { state, stores } = usePos();
  const init = defaultRange(30);
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [topBy, setTopBy] = useState<"revenue" | "units">("revenue");
  const history = useReportSales(state.sales, stores.map((store) => store.id), from, to);
  const [trend, setTrend] = useState<"daily" | "monthly">("daily");

  const bills = useMemo(
    () => history.sales.filter((s) => inRange(s.createdAt, from, to) && !s.refunded),
    [history.sales, from, to],
  );
  const lines = useMemo(() => soldLines(bills, state.products), [bills, state.products]);
  const totals = sumLines(lines);
  const savings = savingsOf(bills, lines);
  const storeName = useCallback(
    (id: string) => stores.find((s) => s.id === id)?.name ?? (id || "Unassigned"),
    [stores],
  );

  const topItems = useMemo(() => {
    const by = new Map<string, { name: string; revenue: number; units: number }>();
    for (const l of lines) {
      const key = l.productId || l.name;
      const cur = by.get(key) ?? { name: l.name, revenue: 0, units: 0 };
      cur.revenue += l.revenue;
      cur.units += l.qty;
      by.set(key, cur);
    }
    return [...by.values()]
      .map((x) => ({ ...x, revenue: Math.round(x.revenue * 100) / 100 }))
      .sort((a, b) => b[topBy] - a[topBy])
      .slice(0, 10);
  }, [lines, topBy]);

  const byStore = useMemo(() => {
    const by = new Map<string, { name: string; revenue: number; cost: number }>();
    for (const l of lines) {
      const cur = by.get(l.storeId) ?? { name: storeName(l.storeId), revenue: 0, cost: 0 };
      cur.revenue += l.revenue;
      cur.cost += l.cost;
      by.set(l.storeId, cur);
    }
    return [...by.values()]
      .map((s) => ({
        ...s,
        revenue: Math.round(s.revenue * 100) / 100,
        cost: Math.round(s.cost * 100) / 100,
        profit: Math.round((s.revenue - s.cost) * 100) / 100,
        marginPct: s.revenue ? ((s.revenue - s.cost) / s.revenue) * 100 : 0,
        sharePct: 0,
      }))
      .map((s) => ({ ...s, sharePct: totals.revenue ? (s.revenue / totals.revenue) * 100 : 0 }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [lines, totals.revenue, storeName]);

  const series = useMemo(() => {
    const by = new Map<string, number>();
    for (const s of bills) {
      const key = trend === "daily" ? s.createdAt.slice(0, 10) : monthKey(s.createdAt);
      by.set(key, (by.get(key) ?? 0) + saleNetRevenue(s));
    }
    return [...by.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, value]) => ({ label, value: Math.round(value * 100) / 100 }));
  }, [bills, trend]);

  const dayCount = new Set(bills.map((s) => s.createdAt.slice(0, 10))).size || 1;
  const monthCount = new Set(bills.map((s) => monthKey(s.createdAt))).size || 1;
  const revenue = Math.round(bills.reduce((a, s) => a + saleNetRevenue(s), 0) * 100) / 100;

  return (
    <AppShell>
      <div className="space-y-5 p-6">
        <ReportHeader
          title="Business Analytics"
          subtitle="Top sellers, shop performance, trends, savings and profit."
          from={from}
          to={to}
          onFrom={setFrom}
          onTo={setTo}
        />

        {history.loading ? <p className="text-sm text-muted-foreground">Loading complete SQL history…</p> : null}
        {history.error ? <p className="text-sm text-destructive">{history.error}</p> : null}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard label="Revenue" value={money(revenue)} hint={`${bills.length} bills`} />
          <StatCard label="Avg / day" value={money(revenue / dayCount)} hint={`${dayCount} trading days`} />
          <StatCard label="Avg / month" value={money(revenue / monthCount)} hint={`${monthCount} months`} />
          <StatCard label="Gross profit" value={money(totals.profit)} hint={`${totals.marginPct.toFixed(1)}% margin`} />
          <StatCard label="Given away" value={money(savings.total)} hint="Discounts, coupons and free items" />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-lg border border-border p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Top selling items</h2>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant={topBy === "revenue" ? "default" : "outline"}
                  onClick={() => setTopBy("revenue")}
                >
                  Revenue
                </Button>
                <Button
                  size="sm"
                  variant={topBy === "units" ? "default" : "outline"}
                  onClick={() => setTopBy("units")}
                >
                  Units
                </Button>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={topItems} layout="vertical" margin={{ left: 24, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" fontSize={11} />
                <YAxis type="category" dataKey="name" width={130} fontSize={11} />
                <Tooltip
                  formatter={(v) => (topBy === "revenue" ? money(Number(v ?? 0)) : `${Number(v ?? 0)} units`)}
                />
                <Bar dataKey={topBy} fill="var(--primary)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </section>

          <section className="rounded-lg border border-border p-4">
            <h2 className="mb-3 text-sm font-semibold">Revenue by shop</h2>
            <ResponsiveContainer width="100%" height={320}>
              <PieChart>
                <Pie
                  data={byStore}
                  dataKey="revenue"
                  nameKey="name"
                  innerRadius={70}
                  outerRadius={110}
                  paddingAngle={2}
                >
                  {byStore.map((s, i) => (
                    <Cell key={s.name} fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </Pie>
                <Legend />
                <Tooltip formatter={(v) => money(Number(v ?? 0))} />
              </PieChart>
            </ResponsiveContainer>
          </section>
        </div>

        <section className="rounded-lg border border-border p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              {trend === "daily" ? "Daily revenue" : "Monthly revenue"}
            </h2>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant={trend === "daily" ? "default" : "outline"}
                onClick={() => setTrend("daily")}
              >
                Daily
              </Button>
              <Button
                size="sm"
                variant={trend === "monthly" ? "default" : "outline"}
                onClick={() => setTrend("monthly")}
              >
                Monthly
              </Button>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            {trend === "daily" ? (
              <BarChart data={series}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip formatter={(v) => money(Number(v ?? 0))} />
                <Bar dataKey="value" fill="var(--primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            ) : (
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip formatter={(v) => money(Number(v ?? 0))} />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="var(--primary)"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            )}
          </ResponsiveContainer>
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-lg border border-border p-4">
            <h2 className="mb-3 text-sm font-semibold">What we gave away</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <StatCard label="Item discounts" value={money(savings.lineDiscount)} />
              <StatCard label="Bill discounts" value={money(savings.billDiscount)} />
              <StatCard label="Coupons &amp; vouchers" value={money(savings.coupon)} />
              <StatCard label="Free items" value={money(savings.focValue)} />
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={[
                  { label: "Item", value: savings.lineDiscount },
                  { label: "Bill", value: savings.billDiscount },
                  { label: "Coupons", value: savings.coupon },
                  { label: "Free items", value: savings.focValue },
                ]}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip formatter={(v) => money(Number(v ?? 0))} />
                <Bar dataKey="value" fill="var(--accent)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </section>

          <section className="rounded-lg border border-border p-4">
            <h2 className="mb-3 text-sm font-semibold">Profit by shop</h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Shop</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Share</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Profit</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byStore.map((s) => (
                  <TableRow key={s.name}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="numeric text-right">{money(s.revenue)}</TableCell>
                    <TableCell className="numeric text-right">{s.sharePct.toFixed(1)}%</TableCell>
                    <TableCell className="numeric text-right">{money(s.cost)}</TableCell>
                    <TableCell className="numeric text-right font-semibold">
                      {money(s.profit)}
                    </TableCell>
                    <TableCell className="numeric text-right">{s.marginPct.toFixed(1)}%</TableCell>
                  </TableRow>
                ))}
                {!byStore.length && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                      No sales in this window.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
