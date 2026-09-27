import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
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
  const drawer = useDrawerEvents();
  const thresholds = state.settings.review;

  const today = posDayKey();
  const sales = useMemo(
    () => state.sales.filter((s) => s.storeId === currentStore.id),
    [state.sales, currentStore.id],
  );
  const todaySales = sales.filter((s) => posDayKey(s.createdAt) === today);
  const live = todaySales.filter((s) => !s.refunded);

  const revenue = live.reduce((a, s) => a + s.total, 0);
  // One shared profit helper, so this never drifts from the business report.
  const profit = useMemo(() => profitOf(live, state.products), [live, state.products]);
  const margin = profit.marginPct;
  const refunds = todaySales.filter((s) => s.refunded);

  /** Revenue against gross profit, hour by hour. */
  const profitByHour = useMemo(
    () => hourlyProfit(live, state.products, posHour),
    [live, state.products],
  );

  /** Revenue for the last 14 calendar days. */
  const daily = useMemo(() => {
    const buckets = new Map<string, number>();
    for (let i = 13; i >= 0; i--) {
      buckets.set(posDayKey(new Date(Date.now() - i * 86_400_000)), 0);
    }
    sales
      .filter((s) => !s.refunded)
      .forEach((s) => {
        const k = posDayKey(s.createdAt);
        if (buckets.has(k)) buckets.set(k, (buckets.get(k) ?? 0) + s.total);
      });
    return Array.from(buckets, ([day, total]) => ({ day: day.slice(5), total: Number(total.toFixed(2)) }));
  }, [sales]);

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
    (d) => posDayKey(d.at) === today && d.storeId === currentStore.id,
  );
  const splitSales = live.filter(
    (sale) => (sale.payments?.length ?? 0) > 1 || sale.payments?.some((payment) => payment.bankName),
  );

  /** Per-cashier behaviour with fixed thresholds plus relative outliers. */
  const cashiers = useMemo(() => {
    const map = new Map<
      string,
      { name: string; bills: number; revenue: number; refunds: number; refundValue: number; discount: number; noSale: number }
    >();
    const get = (name: string) => {
      if (!map.has(name))
        map.set(name, { name, bills: 0, revenue: 0, refunds: 0, refundValue: 0, discount: 0, noSale: 0 });
      return map.get(name)!;
    };
    todaySales.forEach((s) => {
      const c = get(s.cashier || "Unknown");
      c.bills += 1;
      c.discount += s.discount;
      if (s.refunded) {
        c.refunds += 1;
        c.refundValue += Math.abs(s.total);
      } else {
        c.revenue += s.total;
      }
    });
    todayDrawer.forEach((d) => (get(d.staffName || "Unknown").noSale += 1));
    const rows = Array.from(map.values());
    const avgDiscountPct =
      rows.length > 0
        ? rows.reduce((a, r) => a + (r.revenue > 0 ? (r.discount / r.revenue) * 100 : 0), 0) /
          rows.length
        : 0;
    return rows.map((r) => {
      const discountPct = r.revenue > 0 ? (r.discount / r.revenue) * 100 : 0;
      const flags: string[] = [];
      if (r.refunds > thresholds.maxRefunds) flags.push(`${r.refunds} refunds`);
      if (r.refundValue > thresholds.maxRefundValue)
        flags.push(`${money(r.refundValue)} refunded`);
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
          <p className="text-sm text-muted-foreground">
            Today&apos;s revenue, margin, peak trading hours and behaviour flags.
          </p>
        </header>

        <div className="grid gap-4 md:grid-cols-4 xl:grid-cols-7">
          <Kpi label="Revenue today" value={money(revenue)} highlight />
          <Kpi label="Gross revenue" value={money(profit.revenue)} />
          <Kpi label="Total COGS" value={money(profit.cogs)} />
          <Kpi label="Gross margin" value={`${margin.toFixed(1)}%`} />
          <Kpi label="Bills" value={String(live.length)} />
          <Kpi label="Refunds" value={`${refunds.length} · ${money(refunds.reduce((a, s) => a + Math.abs(s.total), 0))}`} />
          <Kpi label="No-sale drawer opens" value={String(todayDrawer.length)} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">Revenue · last 14 days</h2>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={daily}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="day" fontSize={11} stroke="var(--muted-foreground)" />
                  <YAxis fontSize={11} stroke="var(--muted-foreground)" />
                  <Tooltip />
                  <Line type="monotone" dataKey="total" stroke="var(--primary)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">
              Transactions by hour · peak {peak.bills > 0 ? peak.hour : "—"}
            </h2>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="hour" fontSize={10} interval={2} stroke="var(--muted-foreground)" />
                  <YAxis fontSize={11} allowDecimals={false} stroke="var(--muted-foreground)" />
                  <Tooltip />
                  <Bar dataKey="bills" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>

        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-3 text-sm font-semibold">
            Profit by hour · gross profit {money(profit.profit)} today
          </h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={profitByHour}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="hour" fontSize={10} interval={2} stroke="var(--muted-foreground)" />
                <YAxis fontSize={11} stroke="var(--muted-foreground)" />
                <Tooltip />
                <Bar dataKey="revenue" name="Revenue" fill="var(--muted-foreground)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="profit" name="Gross profit" fill="var(--primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

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
          <Separator />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cashier</TableHead>
                <TableHead className="text-right">Bills</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Refunds</TableHead>
                <TableHead className="text-right">Discount %</TableHead>
                <TableHead className="text-right">No-sale</TableHead>
                <TableHead>Flags</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cashiers.map((c) => (
                <TableRow key={c.name}>
                  <TableCell>{c.name}</TableCell>
                  <TableCell className="numeric text-right">{c.bills}</TableCell>
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
                  <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
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
          <Table>
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
                  <TableCell className="text-muted-foreground">
                    {formatTime(d.at)}
                  </TableCell>
                  <TableCell>
                    {d.staffName} <span className="text-[11px] text-muted-foreground">({d.role})</span>
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
          <h2 className="px-5 py-3 text-sm font-semibold">Split payments today</h2>
          <Separator />
          <Table>
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
                    <TableCell className="text-muted-foreground">
                      {formatTime(s.createdAt)}
                    </TableCell>
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

function Kpi({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`numeric text-xl font-semibold ${highlight ? "text-primary" : ""}`}>{value}</p>
    </div>
  );
}
