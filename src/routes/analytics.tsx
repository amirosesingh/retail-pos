import { TradingTooltip, TradingChartCard } from "@/platforms/web/components/pos/TradingChartLayout";
import { TradingRangePresets } from "@/platforms/web/components/pos/TradingRangePresets";
import { useConfirmedPresentation } from "@/lib/use-confirmed-presentation";
import { dashboardPageStores } from "@/lib/dashboard-scope";
import { ShopComparisonCharts } from "@/platforms/web/components/pos/ShopComparisonCharts";
import { comparisonShopSeries, comparisonHeaderHours } from "@/lib/shop-comparison";
import { HomeShortcuts } from "@/platforms/web/components/pos/HomeShortcuts";
import { FinancialBreakdown, GrossProfitInfo } from "@/platforms/web/components/pos/FinancialInfo";
import { SummaryCardRail } from "@/platforms/web/components/pos/SummaryCardRail";
import { PAGE_DATA_CACHE, pageDataScope } from "@/lib/page-data-cache";
import { effectiveTimeZone } from "@/lib/time-zone";
import { branchChartColor, ANALYTICS_COLORS } from "@/lib/analytics-design";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FolderOpen, Package, RefreshCw, X } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatCard, downloadReport, isoDay, ReportFilters } from "@/platforms/web/components/pos/report-kit";
import { money, usePos } from "@/lib/pos-store";
import { useAuth } from "@/lib/pos-auth";
import { AnalyticsErrorPanel } from "@/platforms/web/components/pos/AnalyticsErrorPanel";
import {
  fetchBoard,
  boardTradingPeriods,
  shopSlices,
  topCategories,
  topItems,
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


const shift = (days: number) => isoDay(new Date(Date.now() - days * 86_400_000));
const hasMoney = (value: number) => Number.isFinite(value) && Math.abs(value) >= 0.005;

function LiveBoard() {
  const { allStores: directoryStores, currentStore } = usePos();
  const { can, isAdmin, user, terminalStoreId, canSwitchStores } = useAuth();
  const stores = useMemo(() => dashboardPageStores(directoryStores, currentStore.id, terminalStoreId, user?.storeId, canSwitchStores, "company"),
  [directoryStores, terminalStoreId, user?.storeId, currentStore.id, canSwitchStores]);
  const allStores = stores;
  const shopColors = useMemo(() => new Map(comparisonShopSeries(allStores).map(shop => [shop.id, shop.color])), [allStores]);
  const storeIds = useMemo(() => stores.map(store => store.id), [stores]);
  const allowed = isAdmin || can("can_view_sales_reports");
  const canExport = can("can_export_reports");
  const showCostMargin = isAdmin || can("can_view_cost_margin");

  const [from, setFrom] = useState(shift(29));
  const [to, setTo] = useState(isoDay(new Date()));
  const [topBy, setTopBy] = useState<"revenue" | "units">("revenue");
  const [picked, setPicked] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["analytics-board", pageDataScope(user), currentStore.id, stores.map(store => store.id).sort().join("|"), effectiveTimeZone(), from, to],
    queryFn: () => fetchBoard(from, to, storeIds, { includeHourlyProfit: showCostMargin }),
    enabled: allowed && storeIds.length > 0,
    meta: {
      tables: [
        "sales",
        "sale_items",
        "payment_transactions",
        "products",
        "product_categories",
        "stores",
      ],
    },
    ...PAGE_DATA_CACHE,
    refetchOnWindowFocus: false, refetchOnReconnect: false,
  });

  const filter = useMemo(
    () => {
      const eligible = new Set(storeIds.map(canonicalBranchId));
      const selected = picked.map(canonicalBranchId).filter(id => eligible.has(id));
      return selected.length ? new Set(selected) : undefined;
    },
    [picked, storeIds],
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
  const categoryShops = useMemo(() => {
    const ids = new Set(itemRows.map(row => row.store_id ?? ""));
    return shops.filter(shop => ids.has(shop.storeId));
  }, [shops, itemRows]);
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
  const totals = useMemo(() => {
    const revenue = shops.reduce((a, s) => a + s.revenue, 0);
    const cost = shops.reduce((a, s) => a + s.cost, 0);
    const bills = shops.reduce((a, s) => a + s.bills, 0);
    const given = shops.reduce((a, s) => a + s.givenAway, 0);
    const { days, months } = boardTradingPeriods(data?.storeDays ?? [], filter);
    return {
      revenue,
      cost,
      profit: revenue - cost,
      marginPct: revenue ? ((revenue - cost) / revenue) * 100 : 0,
      bills,
      basket: bills ? revenue / bills : 0,
      given,
      itemDiscount: shops.reduce((sum, shop) => sum + shop.itemDiscount, 0),
      billDiscount: shops.reduce((sum, shop) => sum + shop.billDiscount, 0),
      coupon: shops.reduce((sum, shop) => sum + shop.coupon, 0),
      focValue: shops.reduce((sum, shop) => sum + shop.focValue, 0),
      perDay: revenue / days,
      perMonth: revenue / months,
      days,
      months,
    };
  }, [shops, filter, data]);

  const exportRows = () =>
    downloadReport("live-business-board", [
      [
        "Shop",
        "Bills",
        "Revenue",
        ...(showCostMargin ? ["Cost", "Profit", "Margin %"] : []),
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
        ...(showCostMargin ? [s.cost, s.profit, s.marginPct.toFixed(1)] : []),
        s.sharePct.toFixed(1),
        s.itemDiscount,
        s.billDiscount,
        s.coupon,
        s.focValue,
      ]),
    ]);

  const empty = !!data && shops.length === 0;
  const giveawayInfo = <FinancialBreakdown rows={[
    ["Item discounts", money(totals.itemDiscount)],
    ["Bill discounts", money(totals.billDiscount)],
    ["Coupons", money(totals.coupon)],
    ["Free-item value", money(totals.focValue)],
    ["Total given away", money(totals.given)],
  ]}><p>Already reflected in revenue. Do not deduct these values again; free-item value is not cash received.</p></FinancialBreakdown>;
  const summaryCards = [
    hasMoney(totals.revenue) && <StatCard key="revenue" label="Net revenue before adjustments" value={money(totals.revenue)} hint={`${totals.bills} bills`} info={<FinancialBreakdown rows={[["Net revenue", money(totals.revenue)]]}>
      <p>Completed sales after discounts, excluding tax and before saved receipt adjustments. Refunded bills are excluded.</p>
      {giveawayInfo}
      <p>This summary does not contain original bill subtotals or separate tax and rounding amounts.</p>
    </FinancialBreakdown>} />,
    showCostMargin && hasMoney(totals.profit) && <StatCard key="profit" label="Gross profit" value={money(totals.profit)} hint={`${totals.marginPct.toFixed(1)}% margin`} info={<GrossProfitInfo revenue={totals.revenue} cost={totals.cost} profit={totals.profit} marginPct={totals.marginPct} />} />,
    hasMoney(totals.given) && <StatCard key="given" label="Given away" value={money(totals.given)} hint="Discounts, coupons, free items" info={giveawayInfo} />,
    hasMoney(totals.basket) && <StatCard key="basket" label="Avg basket" value={money(totals.basket)} hint="Per bill" info={<FinancialBreakdown rows={[["Net revenue", money(totals.revenue)], ["Completed bills", String(totals.bills)], ["Average basket", money(totals.basket)]]}><p>Net revenue ÷ completed bills for these shops and dates.</p></FinancialBreakdown>} />,
    hasMoney(totals.perDay) && <StatCard key="day" label="Avg / day" value={money(totals.perDay)} hint={`${totals.days} trading days`} info={<FinancialBreakdown rows={[["Net revenue", money(totals.revenue)], ["Trading days", String(totals.days)], ["Average per day", money(totals.perDay)]]}><p>Net revenue ÷ trading days represented in this report.</p></FinancialBreakdown>} />,
    hasMoney(totals.perMonth) && <StatCard key="month" label="Avg / month" value={money(totals.perMonth)} hint="Across the range" info={<FinancialBreakdown rows={[["Net revenue", money(totals.revenue)], ["Trading months", String(totals.months)], ["Average per month", money(totals.perMonth)]]}><p>Net revenue ÷ trading months represented in this report.</p></FinancialBreakdown>} />,
    !hasMoney(totals.revenue) && totals.bills !== 0 && <StatCard key="bills" label="Bills" value={String(totals.bills)} hint="Completed bills" />,
  ].filter(Boolean);
  const confirmedCards = useConfirmedPresentation(allowed ? JSON.stringify([pageDataScope(user), storeIds, from, to, effectiveTimeZone(), filter ? [...filter].sort() : null]) : null,
    summaryCards, !!data && !query.isLoading && !query.isError);

  const confirmedBoard = useConfirmedPresentation(allowed && storeIds.length > 0
    ? JSON.stringify([pageDataScope(user), storeIds, from, to, effectiveTimeZone(), filter ? [...filter].sort() : null, showCostMargin]) : null,
    data, !!data && !query.isLoading && !query.isError);
  const graphAuthority=allowed&&storeIds.length>0?JSON.stringify([pageDataScope(user),storeIds,effectiveTimeZone(),filter?[...filter].sort():null,showCostMargin]):null;
  const graphPayload=useMemo(()=>confirmedBoard?{board:confirmedBoard,shops:shopSlices(confirmedBoard,nameOf,filter),range:{from,to}}:null,[confirmedBoard,nameOf,filter,from,to]);
  const graphFrame=useConfirmedPresentation(graphAuthority,graphPayload,!!confirmedBoard);
  const transactionHours = useMemo(() => comparisonHeaderHours(graphFrame?.board.bills ?? []), [graphFrame]);
  const graphFinancial=useMemo(()=>graphFrame?.shops.map(shop=>({...shop,id:shop.storeId}))??[],[graphFrame]);

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

  return (
    <AppShell>
      <div className="pos-page-container">
        <header className="min-w-0 space-y-3">
          <div>
            <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
              <h1 className="text-2xl font-semibold tracking-tight">Live Business Board</h1>
              <HomeShortcuts />
            </div>
            <p className="text-sm text-muted-foreground page-description">
              {data?.localOnly
                ? "This terminal’s branch — reports calculated from local SQL Server. Group-wide reports are available on the web."
                : "All authorized company shops across clusters — categories, item drilldown and revenue share. Updates when trading data changes."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
<ReportFilters title="Live Business Board filters"><div className="flex flex-wrap items-end gap-4">
          <TradingRangePresets today={isoDay(new Date())} from={from} to={to} onChange={range => { setFrom(range.from); setTo(range.to); }} />
          <div className="space-y-1">
            <Label className="text-xs">From</Label>
            <Input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
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
              }}
              className="h-9 w-40"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Shops</Label>
            <div className="flex flex-wrap gap-1">
              <Button
                size="sm"
                variant={!filter ? "default" : "outline"}
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
        </div></ReportFilters>
            <Button variant="outline" onClick={() => query.refetch()} disabled={query.isFetching}>
              <RefreshCw className={`mr-2 h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            {canExport && (
              <Button variant="outline" onClick={exportRows}>
                Export Excel
              </Button>
            )}
          </div>
        </header>

        {query.isError && (
          <AnalyticsErrorPanel error={query.error} onRetry={() => void query.refetch()} />
        )}

        {query.isError && confirmedCards && <p role="status" className="text-xs text-muted-foreground">Showing last confirmed summary; the refresh did not complete.</p>}
        {confirmedCards && (confirmedCards.length ? <SummaryCardRail label="Business totals">
          {confirmedCards}
        </SummaryCardRail> : !empty && <p role="status" className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">No financial totals to show for these shops and dates.</p>)}

        {query.isLoading && (
          <p role="status" className="rounded-lg border border-border p-6 text-sm text-muted-foreground">
            Loading live figures…
          </p>
        )}

        {empty && (
          <p className="rounded-lg border border-border p-6 text-sm text-muted-foreground">
            No sales in this range yet. Pick a wider date range or another shop.
          </p>
        )}

            {graphFrame && <ShopComparisonCharts rows={graphFrame.board.storeDays} directory={allStores}
              selectedIds={filter ? [...filter] : storeIds} showProfit={showCostMargin}
              range={graphFrame.range} requestedRange={{from,to}}
              transactionHours={transactionHours} profitHours={graphFrame.board.hourlyRows ?? null}
              hourlyError={showCostMargin && !graphFrame.board.hourlyRows ? (graphFrame.board.hourlyIssue ?? "A verified hourly cost report has not loaded.") : undefined}
              financialRows={graphFinancial}
              scopeLabel={filter ? "Selected authorized shops" : "All authorized company shops"}>
              {graphFrame.shops.some(shop => Math.abs(shop.revenue) >= 0.005) && <TradingChartCard title="Revenue share by shop" description="Net revenue share for the selected authorized shops and dates.">
                <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={graphFrame.shops} dataKey="revenue" nameKey="name" innerRadius={64} outerRadius={88} paddingAngle={2} cornerRadius={4}>
                  {graphFrame.shops.map(shop => <Cell key={shop.storeId} fill={shopColors.get(canonicalBranchId(shop.storeId)) ?? branchChartColor(shop.storeId)} />)}
                </Pie><TradingTooltip formatter={value => money(Number(value ?? 0))} /><Legend /></PieChart></ResponsiveContainer>
              </TradingChartCard>}
              {graphFrame.shops.some(shop => Math.abs(shop.givenAway) >= 0.005) && <TradingChartCard title="Where the money went" description="Discounts, coupons and free-item value are already reflected in revenue.">
                <ResponsiveContainer width="100%" height="100%"><BarChart data={graphFrame.shops} barCategoryGap="30%">
                  <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="name" fontSize={11} /><YAxis fontSize={11} width={58} />
                  <TradingTooltip formatter={value => money(Number(value ?? 0))} /><Legend />
                  {showCostMargin && <Bar dataKey="profit" stackId="giveaway" name="Kept as profit" fill="var(--analytics-profit)" isAnimationActive={false} radius={4} />}
                  <Bar dataKey="itemDiscount" stackId="giveaway" name="Item discounts" fill="var(--analytics-revenue)" isAnimationActive={false} radius={4} />
                  <Bar dataKey="billDiscount" stackId="giveaway" name="Bill discounts" fill="var(--analytics-cost)" isAnimationActive={false} radius={4} />
                  <Bar dataKey="coupon" stackId="giveaway" name="Coupons" fill="var(--analytics-discount)" isAnimationActive={false} radius={4} />
                  <Bar dataKey="focValue" stackId="giveaway" name="Free items" fill="var(--analytics-margin)" isAnimationActive={false} radius={4} />
                </BarChart></ResponsiveContainer>
              </TradingChartCard>}
            </ShopComparisonCharts>}

        {confirmedBoard && !empty && (
          <>

            {combinedCategories.length > 0 && <div className="min-w-0">
              <section className="min-w-0 rounded-lg border border-border p-4 xl:col-span-7 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-300">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
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
                <h2 className="mb-3 text-sm font-semibold">Categories</h2>
                <SummaryCardRail label="Categories" desktopBehavior="finite-carousel">
                  {combinedCategories.map((category) => (
                    <button
                      key={category.name}
                      type="button"
                      onClick={() => setSelectedCategory(category.name)}
                      className={`group flex min-h-24 w-full min-w-0 items-center gap-3 rounded-lg border p-3 text-left transition-[border-color,background-color,transform] hover:-translate-y-0.5 hover:border-primary/60 ${
                        selectedCategory === category.name
                          ? "border-primary bg-primary/10"
                          : "border-border bg-card"
                      }`}
                    >
                      <span
                        className="grid size-9 shrink-0 place-items-center rounded-lg text-white"
                        style={{ background: branchChartColor("category:" + category.name) }}
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
                </SummaryCardRail>
              </section>


            </div>}

            {selectedCategory && categoryItems.length > 0 && (
              <TradingChartCard title={<span className="flex items-center gap-2"><Package className="size-4 text-primary" />Items in {selectedCategory}</span>}
                description="Category opened · all matching items remain available by scrolling."
                controls={<Button size="sm" variant="ghost" onClick={() => setSelectedCategory(null)}><X className="size-4" /> Close items</Button>}>
                <div className="trading-chart-scroll h-full overflow-y-auto overscroll-contain" tabIndex={0} aria-label={`Items in ${selectedCategory}`}>
                {categoryItems.length ? (
                  <ResponsiveContainer
                    width="100%"
                    height={Math.max(224, categoryItems.length * 30)}
                  >
                    <BarChart
                      data={categoryItems}
                      layout="vertical"
                      margin={{ left: 12, right: 20 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" fontSize={11} />
                      <YAxis type="category" dataKey="name" width={130} fontSize={11} />
                      <TradingTooltip
                        formatter={(value) =>
                          topBy === "revenue"
                            ? money(Number(value ?? 0))
                            : `${Number(value ?? 0)} units`
                        }
                      />
                      <Bar dataKey={topBy} fill="var(--pos-pay)" radius={[0, 5, 5, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No items were sold in this category for the selected range.
                  </p>
                )}
                </div>
              </TradingChartCard>
            )}

            {categoryShops.length > 0 && <section className="rounded-lg border border-border p-4 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-300">
              <h2 className="mb-3 text-sm font-semibold">Top categories per shop</h2>
              <SummaryCardRail label="Top categories per shop" desktopBehavior="finite-carousel">
                  {categoryShops.map((shop) => {
                    const rows = topCategories(
                      itemRows.filter((r) => (r.store_id ?? "") === shop.storeId),
                      topBy,
                      5,
                    );
                    return (
                      <div
                        key={shop.storeId}
                        className="min-h-72 rounded-md border border-border p-3"
                      >
                        <p className="truncate text-sm font-semibold" title={shop.name}>
                          {shop.name}
                        </p>
                        <p className="mb-1 text-[11px] text-muted-foreground">
                          {money(shop.revenue)} · {shop.sharePct.toFixed(1)}% of group
                        </p>
                        <div className="mt-3 space-y-1.5">
                          {rows.map((category) => (
                            <button
                              key={category.name}
                              type="button"
                              onClick={() => setSelectedCategory(category.name)}
                              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted"
                            >
                              <span
                                className="size-2.5 shrink-0 rounded-full"
                                style={{ background: branchChartColor("category:" + category.name) }}
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
              </SummaryCardRail>
            </section>}

          </>
        )}
      </div>
    </AppShell>
  );
}
