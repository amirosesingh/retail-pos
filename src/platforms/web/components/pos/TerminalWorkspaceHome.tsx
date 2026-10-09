import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useReportSales } from "@/lib/use-report-sales";
import { stockAtLocation } from "@/lib/locations";

const localDay = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};
import {
  Activity,
  ArrowLeftRight,
  BarChart3,
  Boxes,
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
  const { visible } = useVisibility();
  const configured = state.settings.integrations.terminalPurpose ?? "retail";
  const purpose: TerminalPurpose = isAdmin ? "management" : configured;
  const detail = PURPOSE_DETAILS[purpose];
  const visibleActions = ACTIONS[purpose].filter(
    (action) => !action.permission || can(action.permission),
  );
  const [todayKey, setTodayKey] = useState(localDay);
  useEffect(() => {
    const refreshDay = () => setTodayKey(localDay());
    const timer = window.setInterval(refreshDay, 30_000);
    window.addEventListener("focus", refreshDay);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refreshDay); };
  }, []);
  const storeIds = useMemo(() => [currentStore.id], [currentStore.id]);
  const { sales: todaySales, loading, error } = useReportSales(state.sales, storeIds, todayKey, todayKey);
  const todayRevenue = todaySales.reduce((sum, sale) => sum + sale.total, 0);
  const lowStock = state.products.filter(
    (product) => stockAtLocation(product, currentStore.id) <= product.reorderLevel,
  ).length;
  const PurposeIcon = detail.icon;

  return (
    <AppShell>
      <main className="h-full overflow-y-auto bg-muted/20 p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-6xl space-y-6">
          <header className="rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-card to-card p-5 shadow-sm sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <span className="rounded-xl bg-primary p-3 text-primary-foreground">
                  <PurposeIcon className="size-6" />
                </span>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-2xl font-semibold tracking-tight">
                      {isSupervisor && !isAdmin ? "Manager workspace" : detail.label}
                    </h1>
                    <Badge variant="outline">{currentStore.name}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{detail.description}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Signed in as {user?.name ?? "staff"}. Access remains controlled by your
                    permissions.
                  </p>
                </div>
              </div>
              <Link
                to="/"
                search={{ sell: true }}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90"
              >
                <ShoppingCart className="size-4" /> Sell now
              </Link>
            </div>
          </header>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {visible("workspace.shiftStatus") && (
              <Metric
                label="Shift"
                value={activeShift ? "Open" : "Closed"}
                hint={activeShift ? activeShift.cashier : "Open a shift before cash sales"}
              />
            )}
            {can("can_view_sales_reports") && visible("workspace.todayBills") && (
              <Metric
                label="Today's bills"
                value={String(todaySales.length)}
                hint={error ? "Could not refresh totals" : loading ? "Updating…" : "Current branch"}
              />
            )}
            {can("can_view_sales_reports") && visible("workspace.todayRevenue") && (
              <Metric
                label="Today's revenue"
                value={todayRevenue.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
                hint={error ? "Could not refresh totals" : loading ? "Updating…" : "Completed sales"}
              />
            )}
            {can("can_view_inventory") && visible("workspace.lowStock") && (
              <Metric label="Low stock" value={String(lowStock)} hint="At or below reorder level" />
            )}
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Quick actions</h2>
                <p className="text-sm text-muted-foreground">
                  Only actions allowed for this user are shown.
                </p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visibleActions.map((action) => (
                <Link
                  key={`${action.to}-${action.label}`}
                  to={action.to}
                  search={action.sell ? { sell: true } : {}}
                  className="group"
                >
                  <Card className="h-full transition-all group-hover:-translate-y-0.5 group-hover:border-primary/50 group-hover:shadow-md">
                    <CardHeader className="flex flex-row items-center gap-3 pb-2">
                      <span className="rounded-lg bg-primary/10 p-2 text-primary">
                        <action.icon className="size-5" />
                      </span>
                      <CardTitle className="text-base">{action.label}</CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                      {action.description}
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        </div>
      </main>
    </AppShell>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}
