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
  ArrowLeftRight,
  BarChart3,
  Boxes,
  Info,
  ClipboardCheck,
  LayoutDashboard,
  PackageSearch,
  ScanBarcode,
  ShieldCheck,
  ShoppingCart,
  Store,
  Truck,
  Warehouse,
} from "lucide-react";
import type { PermissionFlag } from "@/lib/permissions";
import type { TerminalPurpose } from "@/core/types/pos-types";
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

const PURPOSE_DETAILS: Record<
  TerminalPurpose,
  { label: string; description: string; icon: typeof Store }
> = {
  retail: {
    label: "Retail workspace",
    description: "Sell, serve customers and manage the active shift.",
    icon: Store,
  },
  warehouse: {
    label: "Warehouse workspace",
    description: "Move stock, fulfil requests and control dispatch.",
    icon: Warehouse,
  },
  inventory: {
    label: "Inventory workspace",
    description: "Count, inspect and maintain branch stock.",
    icon: Boxes,
  },
  receiving: {
    label: "Receiving workspace",
    description: "Receive deliveries and post verified quantities.",
    icon: ClipboardCheck,
  },
  management: {
    label: "Management workspace",
    description: "Monitor performance, approvals and business operations.",
    icon: LayoutDashboard,
  },
};

const ACTIONS: Record<TerminalPurpose, WorkspaceAction[]> = {
  retail: [
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
  ],
  warehouse: [
    {
      label: "Stock transfers",
      description: "Move and dispatch stock between locations.",
      to: "/transfers",
      icon: ArrowLeftRight,
      permission: "can_create_transfer",
    },
    {
      label: "Stock requests",
      description: "Review and fulfil branch requests.",
      to: "/requests",
      icon: Truck,
      permission: "can_create_transfer",
    },
    {
      label: "Inventory catalog",
      description: "Search stock across the current branch.",
      to: "/inventory",
      icon: Boxes,
      permission: "can_view_inventory",
    },
    {
      label: "Open Register POS",
      description: "Sell without changing terminal purpose.",
      to: "/",
      icon: ShoppingCart,
      sell: true,
      permission: "can_process_sale",
    },
  ],
  inventory: [
    {
      label: "Inventory catalog",
      description: "Review products, prices and availability.",
      to: "/inventory",
      icon: Boxes,
      permission: "can_view_inventory",
    },
    {
      label: "Stock operations",
      description: "Count, adjust and reconcile stock.",
      to: "/stock-operations",
      icon: ScanBarcode,
      permission: "can_adjust_stock",
    },
    {
      label: "Stock transfers",
      description: "Track stock moving between locations.",
      to: "/transfers",
      icon: ArrowLeftRight,
      permission: "can_create_transfer",
    },
    {
      label: "Open Register POS",
      description: "Sell without changing terminal purpose.",
      to: "/",
      icon: ShoppingCart,
      sell: true,
      permission: "can_process_sale",
    },
  ],
  receiving: [
    {
      label: "Goods receiving",
      description: "Count arriving deliveries and post them.",
      to: "/receiving",
      icon: ClipboardCheck,
      permission: "can_receive_transfer",
    },
    {
      label: "Purchasing",
      description: "Receive purchase orders and supplier invoices.",
      to: "/purchasing",
      icon: Truck,
      permission: "can_receive_purchase_order",
    },
    {
      label: "Stock transfers",
      description: "Inspect incoming inter-branch stock.",
      to: "/transfers",
      icon: ArrowLeftRight,
      permission: "can_receive_transfer",
    },
    {
      label: "Open Register POS",
      description: "Sell without changing terminal purpose.",
      to: "/",
      icon: ShoppingCart,
      sell: true,
      permission: "can_process_sale",
    },
  ],
  management: [
    {
      label: "Live dashboard",
      description: "Track branch revenue and activity.",
      to: "/dashboard",
      icon: Activity,
      permission: "can_view_dashboard",
    },
    {
      label: "Business board",
      description: "Compare performance and product categories.",
      to: "/analytics",
      icon: BarChart3,
      permission: "can_view_sales_reports",
    },
    {
      label: "Pending approvals",
      description: "Decide protected operations waiting for review.",
      to: "/approvals",
      icon: ShieldCheck,
    },
    {
      label: "Reports centre",
      description: "Review sales, stock and audit reports.",
      to: "/reports",
      icon: BarChart3,
      permission: "can_view_sales_reports",
    },
    {
      label: "Open Register POS",
      description: "Enter the shared selling engine.",
      to: "/",
      icon: ShoppingCart,
      sell: true,
      permission: "can_process_sale",
    },
  ],
};

export function TerminalWorkspaceHome() {
  const { state, currentStore, activeShift } = usePos();
  const { isAdmin, isSupervisor, can, user } = useAuth();
  const { visible, visibleRoute } = useVisibility();
  const configured = state.settings.integrations.terminalPurpose ?? "retail";
  const purpose: TerminalPurpose = isAdmin ? "management" : configured;
  const detail = PURPOSE_DETAILS[purpose];
  const visibleActions = ACTIONS[purpose].filter(
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

  return (
    <AppShell>
      <SellingShortcuts />
      <div className="h-full overflow-y-auto bg-background p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-6xl space-y-8">
          <header className="rounded-2xl border border-border/70 bg-card p-5 sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <span className="rounded-2xl bg-primary/10 p-3 text-primary">
                  <PurposeIcon className="size-6" />
                </span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                      {isSupervisor && !isAdmin ? "Manager workspace" : detail.label}
                    </h1>
                    <Badge variant="outline">{currentStore.name}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{detail.description}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Welcome back, {user?.name ?? "staff"}.
                  </p>
                </div>
              </div>
              {can("can_process_sale") && visibleRoute("/") && (
                <Link
                  to="/"
                  search={{ sell: true }}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <ShoppingCart className="size-4" /> Sell now
                </Link>
              )}
            </div>
          </header>

          <section className="summary-grid grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {visible("workspace.shiftStatus") && (
              <Metric
                label="Shift"
                icon={Activity}
                tone={activeShift ? "text-success bg-success/10" : "text-muted-foreground bg-muted"}
                value={activeShift ? "Open" : "Closed"}
                hint={activeShift ? activeShift.cashier : "Open a shift before cash sales"}
              />
            )}
            {can("can_view_sales_reports") && visible("workspace.todayBills") && (
              <Metric
                label="Today's bills"
                icon={PackageSearch}
                tone="text-category-1 bg-category-1/10"
                value={<AnimatedMetric value={todaySales.length} />}
                hint={error ? "Could not refresh totals" : loading ? "Updating…" : "Current branch"}
              />
            )}
            {can("can_view_sales_reports") && visible("workspace.todayRevenue") && (
              <Metric
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
            )}
            {can("can_view_inventory") && visible("workspace.lowStock") && (
              <Metric
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
            )}
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Quick actions</h2>
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
                    <CardHeader className="workspace-action-header flex flex-row items-center gap-3 pb-2">
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
      <CardContent className="p-3 xl:p-5">
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
