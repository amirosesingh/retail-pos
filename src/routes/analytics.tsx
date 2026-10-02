import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FolderOpen, Package, RefreshCw, X } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatCard, downloadCsv, isoDay } from "@/platforms/web/components/pos/report-kit";
import { money, usePos } from "@/lib/pos-store";
import { useAuth } from "@/lib/pos-auth";
import { AnalyticsErrorPanel } from "@/platforms/web/components/pos/AnalyticsErrorPanel";
import {
  fetchBoard,
  shopSlices,
  topCategories,
  topItems,
  trendSeries,
  type ItemDayRow,
} from "@/lib/analytics-board";
import { canonicalBranchId } from "@/lib/branch-id";

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { title: "Live Business Board — every shop combined" },
      {
        name: "description",
        content:
          "One live board for the whole group: category performance with item drilldown, revenue share, margin, and every ringgit given away in discounts, coupons and free items.",
      },
      { property: "og:title", content: "Live Business Board — every shop combined" },
      {
        property: "og:description",
        content:
          "Category performance, item drilldown, revenue share, margin and giveaways for every shop.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LiveBoard,
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

const shift = (days: number) => isoDay(new Date(Date.now() - days * 86_400_000));

function LiveBoard() {
  const { allStores } = usePos();
  const { can, isAdmin } = useAuth();
  const allowed = isAdmin || can("can_view_sales_reports");

  const [from, setFrom] = useState(shift(29));
  const [to, setTo] = useState(isoDay(new Date()));
  const [preset, setPreset] = useState<"today" | "7" | "30" | "custom">("30");
  const [topBy, setTopBy] = useState<"revenue" | "units">("revenue");
  const [grain, setGrain] = useState<"daily" | "monthly">("daily");
  const [financialView, setFinancialView] = useState<
    "compare" | "revenue" | "cost" | "profit" | "marginPct"
  >("compare");
  const [picked, setPicked] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const applyPreset = (p: "today" | "7" | "30") => {
    setPreset(p);
    setTo(isoDay(new Date()));
    setFrom(p === "today" ? isoDay(new Date()) : shift(p === "7" ? 6 : 29));
  };

  const query = useQuery({
    queryKey: ["analytics-board", from, to],
    queryFn: () => fetchBoard(from, to),
    enabled: allowed,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const filter = useMemo(
    () => (picked.length ? new Set(picked.map(canonicalBranchId)) : undefined),
    [picked],
  );
  const data = query.data;
  const nameOf = useCallback(
    (id: string) => {
      const canonicalId = canonicalBranchId(id);
      return (
        data?.storeNames[canonicalId] ??
        allStores.find((s) => canonicalBranchId(s.id) === canonicalId || s.code === id)?.name ??
        (id ? "Archived or unavailable shop" : "Unassigned shop")
      );
    },
    [allStores, data?.storeNames],
  );

  const shops = useMemo(
    () => (data ? shopSlices(data, nameOf, filter) : []),
    [data, nameOf, filter],
  );

  const itemRows: ItemDayRow[] = useMemo(
    () => (data ? data.itemDays.filter((r) => !filter || filter.has(r.store_id ?? "")) : []),
    [data, filter],
  );

  const combinedCategories = useMemo(() => topCategories(itemRows, topBy, 10), [itemRows, topBy]);
  const categoryItems = useMemo(
    () =>
      selectedCategory
        ? topItems(
            itemRows.filter((row) => row.product_category === selectedCategory),
            topBy,
            12,
            false,
          )
        : [],
    [itemRows, selectedCategory, topBy],
  );
  const trend = useMemo(
    () =>
      data
        ? trendSeries(
            data.storeDays.filter((r) => !filter || filter.has(r.store_id ?? "")),
            grain,
          )
        : [],
    [data, filter, grain],
  );

  const totals = useMemo(() => {
    const revenue = shops.reduce((a, s) => a + s.revenue, 0);
    const cost = shops.reduce((a, s) => a + s.cost, 0);
    const bills = shops.reduce((a, s) => a + s.bills, 0);
    const given = shops.reduce((a, s) => a + s.givenAway, 0);
    const days = new Set(trend.map((t) => t.label.slice(0, 10))).size || 1;
    const months = new Set((data?.storeDays ?? []).map((r) => r.sale_month)).size || 1;
    return {
      revenue,
      profit: revenue - cost,
      marginPct: revenue ? ((revenue - cost) / revenue) * 100 : 0,
      bills,
      basket: bills ? revenue / bills : 0,
      given,
      perDay: revenue / days,
      perMonth: revenue / months,
      days,
    };
  }, [shops, trend, data]);

  const exportRows = () =>
    downloadCsv("live-business-board", [
      [
        "Shop",
        "Bills",
        "Revenue",
        "Cost",
        "Profit",
        "Margin %",
        "Share %",
        "Item discount",
        "Bill discount",
        "Coupons",
        "Free items",
      ],
      ...shops.map((s) => [
        s.name,
        s.bills,
        s.revenue,
        s.cost,
        s.profit,
        s.marginPct.toFixed(1),
        s.sharePct.toFixed(1),
        s.itemDiscount,
        s.billDiscount,
        s.coupon,
        s.focValue,
      ]),
    ]);

  if (!allowed) {
    return (
      <AppShell>
        <div className="p-6">
          <p className="text-sm text-muted-foreground">
            You do not have permission to view sales reporting.
          </p>
        </div>
      </AppShell>
    );
  }

  const empty = !query.isLoading && shops.length === 0;

  return (
    <AppShell>
      <div className="space-y-5 p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Link to="/reports" className="text-xs text-muted-foreground hover:text-foreground">
              ← Reports &amp; Analytics
            </Link>
            <h1 className="text-2xl font-semibold tracking-tight">Live Business Board</h1>
            <p className="text-sm text-muted-foreground">
              Every shop combined — categories first, item drilldown, revenue share, margin and what
              we gave away. Refreshes on its own every minute.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => query.refetch()} disabled={query.isFetching}>
              <RefreshCw className={`mr-2 h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button variant="outline" onClick={exportRows}>
              Export CSV
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-3">
          <div className="flex gap-1">
            {(["today", "7", "30"] as const).map((p) => (
              <Button
                key={p}
                size="sm"
                variant={preset === p ? "default" : "outline"}
                onClick={() => applyPreset(p)}
              >
                {p === "today" ? "Today" : p === "7" ? "7 days" : "30 days"}
              </Button>
            ))}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">From</Label>
            <Input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPreset("custom");
              }}
              className="h-9 w-40"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">To</Label>
            <Input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPreset("custom");
              }}
              className="h-9 w-40"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Shops</Label>
            <div className="flex flex-wrap gap-1">
              <Button
                size="sm"
                variant={picked.length === 0 ? "default" : "outline"}
                onClick={() => setPicked([])}
              >
                All
              </Button>
              {allStores.map((s) => (
                <Button
                  key={s.id}
                  size="sm"
                  variant={picked.includes(s.id) ? "default" : "outline"}
                  onClick={() =>
                    setPicked((prev) =>
                      prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id],
                    )
                  }
                >
                  {nameOf(s.id)}
                </Button>
              ))}
            </div>
          </div>
        </div>

        {query.isError && (
          <AnalyticsErrorPanel error={query.error} onRetry={() => void query.refetch()} />
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          <StatCard label="Revenue" value={money(totals.revenue)} hint={`${totals.bills} bills`} />
          <StatCard
            label="Gross profit"
            value={money(totals.profit)}
            hint={`${totals.marginPct.toFixed(1)}% margin`}
          />
          <StatCard
            label="Given away"
            value={money(totals.given)}
            hint="Discounts, coupons, free items"
          />
          <StatCard label="Avg basket" value={money(totals.basket)} hint="Per bill" />
          <StatCard
            label="Avg / day"
            value={money(totals.perDay)}
            hint={`${totals.days} trading days`}
          />
          <StatCard label="Avg / month" value={money(totals.perMonth)} hint="Across the range" />
        </div>

        {query.isLoading && (
          <p className="rounded-lg border border-border p-6 text-sm text-muted-foreground">
            Loading live figures…
          </p>
        )}

        {empty && (
          <p className="rounded-lg border border-border p-6 text-sm text-muted-foreground">
            No sales in this range yet. Pick a wider date range or another shop.
          </p>
        )}

        {!empty && !query.isLoading && (
          <>
            <div className="grid items-stretch gap-4 xl:grid-cols-12">
              <section className="min-w-0 rounded-lg border border-border p-4 xl:col-span-7">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold">Top categories — all shops combined</h2>
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
                <div className="grid gap-2 sm:grid-cols-2">
                  {combinedCategories.map((category, index) => (
                    <button
                      key={category.name}
                      type="button"
                      onClick={() => setSelectedCategory(category.name)}
                      className={`group flex min-w-0 items-center gap-3 rounded-lg border p-3 text-left transition-[border-color,background-color,transform] hover:-translate-y-0.5 hover:border-primary/60 ${
                        selectedCategory === category.name
                          ? "border-primary bg-primary/10"
                          : "border-border bg-card"
                      }`}
                    >
                      <span
                        className="grid size-9 shrink-0 place-items-center rounded-lg text-white"
                        style={{ background: PALETTE[index % PALETTE.length] }}
                      >
                        <FolderOpen className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{category.name}</span>
                        <span className="block text-[11px] text-muted-foreground">
                          {category.itemCount} item{category.itemCount === 1 ? "" : "s"} ·{" "}
                          {topBy === "revenue"
                            ? money(category.revenue)
                            : `${category.units} units`}
                        </span>
                      </span>
                    </button>
                  ))}
                  {!combinedCategories.length && (
                    <p className="col-span-full py-8 text-center text-sm text-muted-foreground">
                      No category sales in this range.
                    </p>
                  )}
                </div>
              </section>

              <section className="min-w-0 rounded-lg border border-border p-4 xl:col-span-5">
                <h2 className="mb-3 text-sm font-semibold">Revenue share by shop</h2>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={shops}
                      dataKey="revenue"
                      nameKey="name"
                      innerRadius={70}
                      outerRadius={92}
                      paddingAngle={2}
                    >
                      {shops.map((s, i) => (
                        <Cell key={s.storeId} fill={PALETTE[i % PALETTE.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => money(Number(v ?? 0))} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </section>
            </div>

            {selectedCategory && (
              <section className="rounded-lg border border-primary/40 bg-primary/5 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-primary">
                      Category opened
                    </p>
                    <h2 className="flex items-center gap-2 text-sm font-semibold">
                      <Package className="size-4 text-primary" /> Items in {selectedCategory}
                    </h2>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setSelectedCategory(null)}>
                    <X className="size-4" /> Close items
                  </Button>
                </div>
                {categoryItems.length ? (
                  <ResponsiveContainer
                    width="100%"
                    height={Math.min(360, Math.max(220, categoryItems.length * 30))}
                  >
                    <BarChart
                      data={categoryItems}
                      layout="vertical"
                      margin={{ left: 12, right: 20 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" fontSize={11} />
                      <YAxis type="category" dataKey="name" width={130} fontSize={11} />
                      <Tooltip
                        formatter={(value) =>
                          topBy === "revenue"
                            ? money(Number(value ?? 0))
                            : `${Number(value ?? 0)} units`
                        }
                      />
                      <Bar dataKey={topBy} fill="var(--pos-pay)" radius={[0, 5, 5, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No items were sold in this category for the selected range.
                  </p>
                )}
              </section>
            )}

            <section className="rounded-lg border border-border p-4">
              <h2 className="mb-3 text-sm font-semibold">Top categories per shop</h2>
              <div className="max-h-[34rem] overflow-y-auto overscroll-contain pr-2">
                <div className="grid auto-rows-fr gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {shops.map((shop) => {
                    const rows = topCategories(
                      itemRows.filter((r) => (r.store_id ?? "") === shop.storeId),
                      topBy,
                      5,
                    );
                    return (
                      <div
                        key={shop.storeId}
                        className="min-h-48 rounded-md border border-border p-3"
                      >
                        <p className="truncate text-sm font-semibold" title={shop.name}>
                          {shop.name}
                        </p>
                        <p className="mb-1 text-[11px] text-muted-foreground">
                          {money(shop.revenue)} · {shop.sharePct.toFixed(1)}% of group
                        </p>
                        <div className="mt-3 space-y-1.5">
                          {rows.map((category, index) => (
                            <button
                              key={category.name}
                              type="button"
                              onClick={() => setSelectedCategory(category.name)}
                              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
                            >
                              <span
                                className="size-2.5 shrink-0 rounded-full"
                                style={{ background: PALETTE[index % PALETTE.length] }}
                              />
                              <span className="min-w-0 flex-1 truncate">{category.name}</span>
                              <span className="numeric shrink-0 text-muted-foreground">
                                {topBy === "revenue" ? money(category.revenue) : category.units}
                              </span>
                            </button>
                          ))}
                          {!rows.length && (
                            <p className="py-5 text-center text-xs text-muted-foreground">
                              No category sales
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            <div className="grid items-stretch gap-4 xl:grid-cols-12">
              <section className="min-w-0 rounded-lg border border-border p-4 xl:col-span-7">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold">Financial performance by shop</h2>
                    <p className="text-xs text-muted-foreground">
                      Compare related measures or inspect one measure on its own scale.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {(
                      [
                        ["compare", "Compare"],
                        ["revenue", "Revenue"],
                        ["cost", "Cost"],
                        ["profit", "Profit"],
                        ["marginPct", "Margin %"],
                      ] as const
                    ).map(([value, label]) => (
                      <Button
                        key={value}
                        size="sm"
                        variant={financialView === value ? "default" : "outline"}
                        onClick={() => setFinancialView(value)}
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={270}>
                  {financialView === "compare" ? (
                    <ComposedChart data={shops} barCategoryGap="28%">
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" fontSize={11} interval={0} />
                      <YAxis yAxisId="left" fontSize={11} width={70} />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        fontSize={11}
                        unit="%"
                        domain={[0, 100]}
                        width={44}
                      />
                      <Tooltip
                        formatter={(v, key) =>
                          key === "Margin %"
                            ? `${Number(v ?? 0).toFixed(1)}%`
                            : money(Number(v ?? 0))
                        }
                      />
                      <Legend />
                      <Bar
                        yAxisId="left"
                        dataKey="revenue"
                        name="Revenue"
                        fill="var(--primary)"
                        maxBarSize={38}
                        radius={[4, 4, 0, 0]}
                      />
                      <Bar
                        yAxisId="left"
                        dataKey="cost"
                        name="Cost"
                        fill="var(--muted-foreground)"
                        maxBarSize={38}
                        radius={[4, 4, 0, 0]}
                      />
                      <Bar
                        yAxisId="left"
                        dataKey="profit"
                        name="Profit"
                        fill="var(--success)"
                        maxBarSize={38}
                        radius={[4, 4, 0, 0]}
                      />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="marginPct"
                        name="Margin %"
                        stroke="var(--warning)"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                    </ComposedChart>
                  ) : financialView === "marginPct" ? (
                    <LineChart data={shops} margin={{ left: 8, right: 18 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" fontSize={11} interval={0} />
                      <YAxis domain={[0, 100]} unit="%" fontSize={11} width={48} />
                      <Tooltip formatter={(value) => `${Number(value ?? 0).toFixed(1)}%`} />
                      <Line
                        type="monotone"
                        dataKey="marginPct"
                        name="Margin %"
                        stroke="var(--warning)"
                        strokeWidth={3}
                        dot={{ r: 4 }}
                      />
                    </LineChart>
                  ) : (
                    <BarChart data={shops} barCategoryGap="38%" margin={{ left: 8, right: 18 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" fontSize={11} interval={0} />
                      <YAxis fontSize={11} width={70} />
                      <Tooltip formatter={(value) => money(Number(value ?? 0))} />
                      <Bar
                        dataKey={financialView}
                        name={financialView[0].toUpperCase() + financialView.slice(1)}
                        fill={
                          financialView === "revenue"
                            ? "var(--primary)"
                            : financialView === "cost"
                              ? "var(--muted-foreground)"
                              : "var(--success)"
                        }
                        maxBarSize={56}
                        radius={[5, 5, 0, 0]}
                      />
                    </BarChart>
                  )}
                </ResponsiveContainer>
              </section>

              <section className="min-w-0 rounded-lg border border-border p-4 xl:col-span-5">
                <h2 className="mb-3 text-sm font-semibold">Where the money went</h2>
                <ResponsiveContainer width="100%" height={270}>
                  <BarChart data={shops} barCategoryGap="30%">
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" fontSize={11} interval={0} />
                    <YAxis fontSize={11} width={64} />
                    <Tooltip formatter={(v) => money(Number(v ?? 0))} />
                    <Legend />
                    <Bar dataKey="profit" stackId="m" name="Kept as profit" fill="var(--success)" />
                    <Bar
                      dataKey="itemDiscount"
                      stackId="m"
                      name="Item discounts"
                      fill="var(--primary)"
                    />
                    <Bar
                      dataKey="billDiscount"
                      stackId="m"
                      name="Bill discounts"
                      fill="var(--accent)"
                    />
                    <Bar dataKey="coupon" stackId="m" name="Coupons" fill="var(--warning)" />
                    <Bar
                      dataKey="focValue"
                      stackId="m"
                      name="Free items"
                      fill="var(--destructive)"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </section>
            </div>

            <section className="rounded-lg border border-border p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold">Revenue and profit trend</h2>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant={grain === "daily" ? "default" : "outline"}
                    onClick={() => setGrain("daily")}
                  >
                    Daily
                  </Button>
                  <Button
                    size="sm"
                    variant={grain === "monthly" ? "default" : "outline"}
                    onClick={() => setGrain("monthly")}
                  >
                    Monthly
                  </Button>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" fontSize={11} />
                  <YAxis fontSize={11} />
                  <Tooltip formatter={(v) => money(Number(v ?? 0))} />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    name="Revenue"
                    stroke="var(--primary)"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="profit"
                    name="Profit"
                    stroke="var(--success)"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
