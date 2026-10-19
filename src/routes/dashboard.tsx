import { productVisibleAt } from "@/lib/branch-policy";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useReportSales } from "@/lib/use-report-sales";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle } from "lucide-react";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { Badge } from "@/components/ui/badge";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { money, usePos } from "@/lib/pos-store";
import { useDrawerEvents } from "@/lib/drawer-events";
import { hourlyProfit, profitOf } from "@/core/pricing/profit";
import { paymentsLabel } from "@/core/types/pos-types";
import { formatTime, posDayKey, posHour } from "@/lib/time-zone";
import { defaultReviewThresholds } from "@/lib/pos-seed";
import { sameBranchId } from "@/lib/branch-id";
import { cashierReviewTotals, hasSplitPayments } from "@/lib/cashier-review";
import { inventoryMetrics } from "@/lib/inventory-metrics";
import { AnimatedMetric } from "@/platforms/web/components/pos/AnimatedMetric";
import { useAuth } from "@/lib/pos-auth";
import { useVisibility } from "@/lib/ui-visibility";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Live Dashboard — POS" },
      {
        name: "description",
        content:
          "Real-time till dashboard: today's revenue, profit margin, peak transaction hours, drawer opens and cashiers flagged for review.",
      },
      { property: "og:title", content: "Live Dashboard — POS" },
      {
        property: "og:description",
        content: "Daily revenue, margins, peak hours and cashier review flags.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { state, currentStore } = usePos();
  const { can } = useAuth();
  const { visible } = useVisibility();
  const showStockValue = can("can_view_sales_reports") && visible("inventory.stockValue");
  const drawer = useDrawerEvents();
  const thresholds = defaultReviewThresholds;

  const [today, setToday] = useState(() => posDayKey());
  useEffect(() => {
    const refresh = () => setToday(posDayKey());
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);
  const storeIds = useMemo(() => [currentStore.id], [currentStore.id]);
  // Include a boundary day on both sides: report loading uses device-local
  // midnight, while dashboard buckets use the configured business timezone.
  const { sales, loading: reportLoading, error: reportError } = useReportSales(state.sales, storeIds,
    posDayKey(new Date(Date.parse(`${today}T12:00:00`) - 14 * 86_400_000)),
    posDayKey(new Date(Date.parse(`${today}T12:00:00`) + 86_400_000)));
  const todaySales = sales.filter((s) => posDayKey(s.createdAt) === today);
  const live = todaySales.filter((s) => !s.refunded);

  const revenue = live.reduce((a, s) => a + s.total, 0);
  // One shared profit helper, so this never drifts from the business report.
  const profit = useMemo(() => profitOf(live, state.products), [live, state.products]);
  const margin = profit.marginPct;
  const refunds = todaySales.filter((s) => s.refunded);
  const stock = useMemo(
    () => inventoryMetrics(state.products.filter(product => productVisibleAt(state.settings, product, currentStore.id)), currentStore.id),
    [state.products, state.settings, currentStore.id],
  );

  /** Revenue against gross profit, hour by hour. */
  const profitByHour = useMemo(
    () => hourlyProfit(live, state.products, posHour),
    [live, state.products],
  );

  /** Revenue for the last 14 calendar days. */
  const daily = useMemo(() => {
    const buckets = new Map<string, number>();
    for (let i = 13; i >= 0; i--) {
      const day = new Date(`${today}T12:00:00`);
      day.setDate(day.getDate() - i);
      const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
      buckets.set(key, 0);
    }
    sales
      .filter((s) => !s.refunded)
      .forEach((s) => {
        const k = posDayKey(s.createdAt);
        if (buckets.has(k)) buckets.set(k, (buckets.get(k) ?? 0) + s.total);
      });
    return Array.from(buckets, ([day, total]) => ({
      day: day.slice(5),
      total: Number(total.toFixed(2)),
    }));
  }, [sales, today]);

  /** Transactions per hour today — shows the peak trading window. */
  const hourly = useMemo(() => {
    const hours = Array.from({ length: 24 }, (_, h) => ({ hour: `${h}:00`, bills: 0, value: 0 }));
    live.forEach((s) => {
      const h = posHour(s.createdAt);
      hours[h]!.bills += 1;
      hours[h]!.value = Number((hours[h]!.value + s.total).toFixed(2));
    });
    return hours;
  }, [live]);
  const peak = hourly.reduce((a, h) => (h.bills > a.bills ? h : a), hourly[0]!);

  const todayDrawer = drawer.filter(
    (d) => posDayKey(d.at) === today && sameBranchId(d.storeId, currentStore.id),
  );
  const splitSales = live.filter(sale => hasSplitPayments(sale.payments));

  /** Per-cashier behaviour with fixed thresholds plus relative outliers. */
  const cashiers = useMemo(() => {
    const rows = cashierReviewTotals(todaySales, todayDrawer);
    const originalTotal = rows.reduce((sum, row) => sum + row.original, 0);
    const avgDiscountPct = originalTotal > 0
      ? rows.reduce((sum, row) => sum + row.discount, 0) / originalTotal * 100
      : 0;
    return rows.map((r) => {
      const discountPct = r.discountPct;
      const flags: string[] = [];
      if (r.refunds > thresholds.maxRefunds) flags.push(`${r.refunds} refunds`);
      if (r.refundValue > thresholds.maxRefundValue) flags.push(`${money(r.refundValue)} refunded`);
      if (r.noSale > thresholds.maxNoSaleOpens) flags.push(`${r.noSale} no-sale opens`);
      if (discountPct > thresholds.maxDiscountPct)
        flags.push(`${discountPct.toFixed(1)}% discounting`);
      // Relative outlier: well above the shift average, even under the fixed cap.
      if (avgDiscountPct > 0 && discountPct > avgDiscountPct * 2)
        flags.push("discounting far above peers");
      return { ...r, discountPct, flags };
    });
  }, [todaySales, todayDrawer, thresholds]);

  const flagged = cashiers.filter((c) => c.flags.length);

  return (
    <AppShell>
      <div className="space-y-6 p-6">
        <header>
          <h1 className="text-2xl font-semibold">Live dashboard · {currentStore.name}</h1>
          <p className="text-sm text-muted-foreground page-description">
            Today&apos;s revenue, margin, peak trading hours and behaviour flags.
          </p>
        </header>

        {reportError && <p role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">Report incomplete: {reportError}</p>}
        <div className="summary-grid grid gap-4 md:grid-cols-4 xl:grid-cols-7">
          <Kpi label="Revenue today" value={money(revenue)} highlight />
          <Kpi label="Gross revenue" value={money(profit.revenue)} />
          <Kpi label="Total COGS" value={money(profit.cogs)} />
          <Kpi label="Gross margin" value={`${margin.toFixed(1)}%`} />
          <Kpi label="Bills" value={String(live.length)} />
          <Kpi
            label="Refunds"
            value={`${refunds.length} · ${money(refunds.reduce((a, s) => a + Math.abs(s.total), 0))}`}
          />
          <Kpi label="No-sale drawer opens" value={String(todayDrawer.length)} />
        </div>

        <section className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3">
            <h2 className="text-sm font-semibold">Inventory position · {currentStore.name}</h2>
            <p className="text-xs text-muted-foreground">
              Current active catalogue and on-hand value at this branch.
            </p>
          </div>
          <div className="summary-grid grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
            <Kpi label="Products" value={<AnimatedMetric value={stock.products} />} />
            <Kpi label="Categories" value={<AnimatedMetric value={stock.categories} />} />
            <Kpi label="On-hand units" value={<AnimatedMetric value={stock.units} />} />
            <Kpi label="Low stock" value={<AnimatedMetric value={stock.lowStock} />} />
            <Kpi
              label="Negative stock"
              value={<AnimatedMetric value={stock.negativeStock} />}
              danger={stock.negativeStock > 0}
            />
            {showStockValue && (
              <>
                <Kpi label="Cost value" value={money(stock.costValue)} />
                <Kpi label="Retail value" value={money(stock.retailValue)} />
                <Kpi label="Potential profit" value={money(stock.potentialProfit)} highlight />
              </>
            )}
          </div>
        </section>

        <Carousel
          opts={{ align: "start", containScroll: "trimSnaps" }}
          aria-label="Live dashboard graphs"
          // Keep arrow keys inside charts available for Recharts data-point navigation.
          // Previous/next buttons provide keyboard navigation between graph cards.
          onKeyDownCapture={() => undefined}
          className="min-w-0"
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Trading graphs</h2>
            <div className="flex items-center gap-1">
              <CarouselPrevious className="static translate-y-0" aria-label="Previous graph" />
              <CarouselNext className="static translate-y-0" aria-label="Next graph" />
            </div>
          </div>
          <CarouselContent className="touch-pan-y">
          <CarouselItem className="basis-[92%] sm:basis-3/4 lg:basis-[48%] 2xl:basis-1/3">
          <section className="flex h-88 min-w-0 flex-col rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 min-h-10 shrink-0 text-sm font-semibold">Revenue · last 14 days</h2>
            <div className="min-h-0 min-w-0 flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={daily}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="day" fontSize={11} stroke="var(--muted-foreground)" />
                  <YAxis fontSize={11} stroke="var(--muted-foreground)" />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="total"
                    stroke="var(--primary)"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
          </CarouselItem>

          <CarouselItem className="basis-[92%] sm:basis-3/4 lg:basis-[48%] 2xl:basis-1/3">
          <section className="flex h-88 min-w-0 flex-col rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 min-h-10 shrink-0 text-sm font-semibold">
              Transactions by hour · peak {peak.bills > 0 ? peak.hour : "—"}
            </h2>
            <div className="min-h-0 min-w-0 flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis
                    dataKey="hour"
                    fontSize={10}
                    interval={2}
                    stroke="var(--muted-foreground)"
                  />
                  <YAxis fontSize={11} allowDecimals={false} stroke="var(--muted-foreground)" />
                  <Tooltip />
                  <Bar dataKey="bills" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
          </CarouselItem>

        <CarouselItem className="basis-[92%] sm:basis-3/4 lg:basis-[48%] 2xl:basis-1/3">
          <section className="flex h-88 min-w-0 flex-col rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 min-h-10 shrink-0 text-sm font-semibold">
            Profit by hour · gross profit {money(profit.profit)} today
          </h2>
          <div className="min-h-0 min-w-0 flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={profitByHour}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="hour" fontSize={10} interval={2} stroke="var(--muted-foreground)" />
                <YAxis fontSize={11} stroke="var(--muted-foreground)" />
                <Tooltip />
                <Bar
                  dataKey="revenue"
                  name="Revenue"
                  fill="var(--muted-foreground)"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="profit"
                  name="Gross profit"
                  fill="var(--primary)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
          </CarouselItem>

          </CarouselContent>
        </Carousel>

        <section className="rounded-lg border border-border bg-card">
          <div className="flex items-center gap-2 px-5 py-3">
            <AlertTriangle className="size-4 text-warning" />
            <h2 className="text-sm font-semibold">Cashier review · today</h2>
            {flagged.length > 0 && (
              <Badge variant="outline" className="border-destructive/50 text-destructive">
                {flagged.length} flagged
              </Badge>
            )}
          </div>
          <p className="px-5 pb-3 text-xs text-muted-foreground">
            Completed sales only. Discount % = total discount ÷ original bill value before discounts.
            Final totals include applicable tax and rounding; refunded bills are shown separately.
          </p>
          <Separator />
          <Table loading={reportLoading}>
            <TableHeader>
              <TableRow>
                <TableHead>Cashier</TableHead>
                <TableHead className="text-right">Bills</TableHead>
                <TableHead className="text-right">Original bill value</TableHead>
                <TableHead className="text-right">Discount amount</TableHead>
                <TableHead className="text-right">Final bill total</TableHead>
                <TableHead className="text-right">Refunds</TableHead>
                <TableHead className="text-right">Discount %</TableHead>
                <TableHead className="text-right">No-sale</TableHead>
                <TableHead>Flags</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cashiers.map((c) => (
                <TableRow key={c.name}>
                  <TableCell>
                    <span>{c.name}</span>
                    <details className="mt-1 min-w-48 max-w-sm text-xs">
                      <summary className="cursor-pointer text-muted-foreground">View bills</summary>
                      <ul className="mt-2 space-y-2">
                        {todaySales.filter(sale => (sale.cashier || "Unknown") === c.name).map(sale => (
                          <li key={sale.id} className="rounded-md border p-2">
                            <p className="font-medium">{sale.receiptNo}{sale.refunded ? " · Refunded" : ""}</p>
                            <p>Original {money(sale.subtotal)} · Discount {money(sale.discount)} ({(sale.subtotal > 0 ? sale.discount / sale.subtotal * 100 : 0).toFixed(1)}%)</p>
                            <p>After discount {money(sale.subtotal - sale.discount)} · Final {money(sale.total)}</p>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </TableCell>
                  <TableCell className="numeric text-right">{c.bills}</TableCell>
                  <TableCell className="numeric text-right">{money(c.original)}</TableCell>
                  <TableCell className="numeric text-right">{money(c.discount)}</TableCell>
                  <TableCell className="numeric text-right">{money(c.revenue)}</TableCell>
                  <TableCell className="numeric text-right">
                    {c.refunds} · {money(c.refundValue)}
                  </TableCell>
                  <TableCell className="numeric text-right">{c.discountPct.toFixed(1)}%</TableCell>
                  <TableCell className="numeric text-right">{c.noSale}</TableCell>
                  <TableCell>
                    {c.flags.length ? (
                      <span className="text-xs text-destructive">{c.flags.join(" · ")}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">clear</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {!cashiers.length && (
                <TableRow>
                  <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                    No trading recorded today.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </section>

        <section className="rounded-lg border border-border bg-card">
          <h2 className="px-5 py-3 text-sm font-semibold">Cash drawer opens without a sale</h2>
          <Separator />
          <Table loading={reportLoading}>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Employee</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Note</TableHead>
                <TableHead>Approved by</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {todayDrawer.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="text-muted-foreground">{formatTime(d.at)}</TableCell>
                  <TableCell>
                    {d.staffName}{" "}
                    <span className="text-[11px] text-muted-foreground">({d.role})</span>
                  </TableCell>
                  <TableCell>{d.reason}</TableCell>
                  <TableCell className="text-muted-foreground">{d.note || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{d.approvedBy ?? "—"}</TableCell>
                </TableRow>
              ))}
              {!todayDrawer.length && (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    The drawer has not been opened outside a sale today.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </section>

        <section className="rounded-lg border border-border bg-card">
          <h2 className="px-5 pt-3 text-sm font-semibold">Split payments today</h2>
          <p className="px-5 pb-3 pt-1 text-xs text-muted-foreground">Bills paid in two or more parts, such as cash and card.</p>
          <Separator />
          <Table loading={reportLoading}>
            <TableHeader>
              <TableRow>
                <TableHead>Receipt</TableHead>
                <TableHead>When</TableHead>
                <TableHead>Tenders</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {splitSales.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="numeric">{s.receiptNo}</TableCell>
                  <TableCell className="text-muted-foreground">{formatTime(s.createdAt)}</TableCell>
                  <TableCell>{paymentsLabel(s.payments)}</TableCell>
                  <TableCell className="numeric text-right">{money(s.total)}</TableCell>
                </TableRow>
              ))}
              {!splitSales.length && (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                    No split-tender bills today.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </section>
      </div>
    </AppShell>
  );
}

function Kpi({
  label,
  value,
  highlight,
  danger,
}: {
  label: string;
  value: ReactNode;
  highlight?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="summary-card rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={`numeric text-xl font-semibold ${highlight ? "text-primary" : ""} ${danger ? "text-destructive" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}
