import { useViewedBranchShift } from "@/lib/use-viewed-branch-shift";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { inventoryMetrics } from "@/lib/inventory-metrics";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AnimatedMetric } from "./AnimatedMetric";
import { useReportSales } from "@/lib/use-report-sales";
import { dailyPaymentSummary } from "@/lib/daily-payment-summary";
import { methodLabel } from "@/core/types/pos-types";
import { SellingShortcuts } from "./SellingShortcuts";

const localDay = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Boxes,
  Info,
  PackageSearch,
  ShoppingCart,
  Store,
} from "lucide-react";
import type { PermissionFlag } from "@/lib/permissions";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/pos-auth";
import { usePos } from "@/lib/pos-store";
import { useVisibility } from "@/lib/ui-visibility";

type WorkspaceAction = {
  label: string;
  description: string;
  to: string;
  icon: typeof Store;
  permission?: PermissionFlag;
  sell?: boolean;
};

const detail = { label: "Retail workspace", description: "Sell, serve customers and manage the active shift.", icon: Store };

const ACTIONS: WorkspaceAction[] = [
    {
      label: "Open Register POS",
      description: "Start or continue selling.",
      to: "/",
      icon: ShoppingCart,
      sell: true,
    },
    {
      label: "Shift management",
      description: "Open, count or close the active shift.",
      to: "/shifts",
      icon: Activity,
      permission: "can_open_shift",
    },
    {
      label: "Bill history",
      description: "Find and reprint completed sales.",
      to: "/receipts",
      icon: PackageSearch,
      permission: "can_view_sales_reports",
    },
  ];

export function TerminalWorkspaceHome() {
  const { state, currentStore } = usePos();
  const { shift: viewedShift, checked: shiftChecked, error: shiftError } = useViewedBranchShift();
  const { can, user } = useAuth();
  const { visible, visibleRoute } = useVisibility();
  const visibleActions = ACTIONS.filter(
    (action) =>
      (!action.permission || can(action.permission)) &&
      (!action.sell || can("can_process_sale")) &&
      visibleRoute(action.to),
  );
  const [todayKey, setTodayKey] = useState(localDay);
  useEffect(() => {
    const refreshDay = () => setTodayKey(localDay());
    const timer = window.setInterval(refreshDay, 30_000);
    window.addEventListener("focus", refreshDay);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshDay);
    };
  }, []);
  const storeIds = useMemo(() => [currentStore.id], [currentStore.id]);
  const {
    sales: todaySales,
    loading,
    error,
  } = useReportSales(state.sales, storeIds, todayKey, todayKey);
  const completedSales = todaySales.filter((sale) => !sale.refunded);
  const todayRevenue = completedSales.reduce((sum, sale) => sum + sale.total, 0);
  const paymentSummary = dailyPaymentSummary(completedSales);
  const stockMetrics = inventoryMetrics(state.products, currentStore.id);
  const lowStock = stockMetrics.lowStock;
  const archivedProducts = state.products.filter((product) => product.archived === true).length;
  const activeProducts = state.products.length - archivedProducts;
  const PurposeIcon = detail.icon;
  const primaryAction = visibleActions[0];

  const metrics = {
    shift: visible("workspace.shiftStatus") && (
              <Metric
                key="shift"
                label="Shift"
                icon={Activity}
                tone={viewedShift ? "text-success bg-success/10" : "text-muted-foreground bg-muted"}
                value={viewedShift ? (viewedShift.state && viewedShift.state !== "ACTIVE" ? "Closing" : "Open") : !shiftChecked ? "Checking…" : shiftError ? "Unavailable" : "Closed"}
                hint={shiftError ? "Reconnecting — showing last known status" : viewedShift ? viewedShift.cashier : !shiftChecked ? "Checking selected branch" : "No open shift at this branch"}
              />
            ),
    bills: can("can_view_sales_reports") && visible("workspace.todayBills") && (
              <Metric
                key="bills"
                label="Today's bills"
                icon={PackageSearch}
                tone="text-category-1 bg-category-1/10"
                value={<AnimatedMetric value={todaySales.length} />}
                hint={error ? "Could not refresh totals" : loading ? "Updating…" : "Current branch"}
              />
            ),
    revenue: can("can_view_sales_reports") && visible("workspace.todayRevenue") && (
              <Metric
                key="revenue"
                label="Today's revenue"
                payments={paymentSummary}
                icon={BarChart3}
                tone="text-category-2 bg-category-2/10"
                value={
                  <AnimatedMetric
                    value={todayRevenue}
                    format={(value) =>
                      value.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })
                    }
                  />
                }
                hint={
                  error ? "Could not refresh totals" : loading ? "Updating…" : "Completed sales"
                }
              />
            ),
    stock: can("can_view_inventory") && visible("workspace.lowStock") && (
              <Metric
                key="stock"
                icon={Boxes}
                tone="text-warning bg-warning/10"
                label={<>Low stock <StockExplanation><span className="block">Positive stock at or below reorder level</span><span className="block">{stockMetrics.outOfStock} out of stock · {stockMetrics.negativeStock} negative stock</span></StockExplanation></>}
                value={<AnimatedMetric value={lowStock} />}
                hint={
                  <>
                    <span className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-border/60 pt-2">
                      <span>
                        Active{" "}
                        <strong className="font-medium text-foreground">
                          <AnimatedMetric value={activeProducts} />
                        </strong>
                      </span>
                      <span>
                        Archived{" "}
                        <strong className="font-medium text-foreground">
                          <AnimatedMetric value={archivedProducts} />
                        </strong>
                      </span>
                    </span>
                  </>
                }
              />
            ),
  };

  const actions = (
          <section>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Selling tools</h2>
                <p className="text-sm text-muted-foreground">Your everyday tools, one step away.</p>
              </div>
            </div>
            <div className="workspace-actions grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3">
              {visibleActions.map((action, index) => (
                <Link
                  key={`${action.to}-${action.label}`}
                  to={action.to}
                  search={action.sell ? { sell: true } : {}}
                  className="group rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <Card className="workspace-action-card h-full transition-[border-color,background-color] duration-[var(--motion-fast)] group-hover:border-primary/40 group-hover:bg-muted/25 motion-reduce:transition-none">
                    <CardHeader className="workspace-action-header flex flex-row items-center space-y-0 gap-3 pb-2">
                      <span
                        className={`rounded-xl p-2.5 ${["bg-category-1/10 text-category-1", "bg-category-2/10 text-category-2", "bg-category-3/10 text-category-3", "bg-category-4/10 text-category-4"][index % 4]}`}
                      >
                        <action.icon className="size-5" />
                      </span>
                      <CardTitle className="workspace-action-title flex-1 text-base leading-snug">
                        {action.label}
                      </CardTitle>
                      <ArrowUpRight
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
                      />
                    </CardHeader>
                    <CardContent className="workspace-action-content text-sm text-muted-foreground">
                      {action.description}
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
  );

  return (
    <AppShell>
      <SellingShortcuts />
      <div className="pos-page-container no-scrollbar h-full overflow-y-auto bg-background">
        <div className="w-full min-w-0 space-y-5">
          <header className="rounded-2xl border border-border/70 bg-card p-5 sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <span className="rounded-2xl bg-primary/10 p-3 text-primary">
                  <PurposeIcon className="size-6" />
                </span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                      {detail.label}
                    </h1>
                    <Badge variant="outline">{currentStore.name}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{detail.description}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Welcome back, {user?.name ?? "staff"}.
                  </p>
                </div>
              </div>
              {primaryAction && (
                <Link
                  to={primaryAction.to}
                  search={primaryAction.sell ? { sell: true } : {}}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <primaryAction.icon className="size-4" /> {primaryAction.sell ? "Sell now" : primaryAction.label}
                </Link>
              )}
            </div>
          </header>

          {Object.values(metrics).some(Boolean) && <section className="selling-overview flex flex-wrap gap-3" aria-label="Workspace overview" tabIndex={0}>
            {(["shift", "bills", "revenue", "stock"] as const).filter(key => metrics[key]).map(key => <div key={key} className="min-w-0 flex-[1_1_11rem] [&>*]:h-full">{metrics[key]}</div>)}
          </section>}

          {actions}
        </div>
      </div>
    </AppShell>
  );
}

function Metric({
  label,
  value,
  hint,
  icon: Icon,
  tone,
  payments,
}: {
  label: ReactNode;
  value: ReactNode;
  hint: ReactNode;
  icon: typeof Store;
  tone: string;
  payments?: { method: string; amount: number }[];
}) {
  return (
    <Card className="workspace-metric">
      <CardContent className="p-3 pt-3 sm:p-4 sm:pt-4 xl:p-5 xl:pt-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <span className={`rounded-xl p-2 ${tone}`}>
            <Icon aria-hidden="true" className="size-4" />
          </span>
        </div>
        <p className="mt-2 break-words text-xl font-semibold tracking-tight tabular-nums xl:mt-3 xl:text-3xl">
          {value}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{hint}</p>
        {payments && payments.length > 0 && (
          <dl className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-t border-border/60 pt-2 text-xs">
            {payments.map((payment) => (
              <div key={payment.method} className="flex gap-1.5">
                <dt className="text-muted-foreground">{methodLabel(payment.method)}</dt>
                <dd className="font-medium tabular-nums">
                  <AnimatedMetric
                    value={payment.amount}
                    format={(value) =>
                      value.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })
                    }
                  />
                </dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

function StockExplanation({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <Tooltip open={open} onOpenChange={setOpen}><TooltipTrigger asChild>
    <button type="button" aria-label="Explain low-stock figures" className="inline-flex size-7 items-center justify-center rounded-md align-middle text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setOpen(value => !value)}><Info className="size-3.5" aria-hidden /></button>
  </TooltipTrigger><TooltipContent className="max-w-72 text-sm leading-relaxed">{children}</TooltipContent></Tooltip>;
}
