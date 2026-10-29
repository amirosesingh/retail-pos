import { companyStoreScope } from "@/lib/company-store-scope";
import { useAuth } from "@/lib/pos-auth";
import { salesReportScope } from "@/lib/sales-report-scope";
import { canonicalBranchId } from "@/lib/branch-id";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { AppShell } from "./AppShell";
import { ReportHeader, defaultRange } from "./report-kit";
import { SalesReportContext, useSalesReportFilters } from "@/lib/sales-report-context";
import { useReportSales } from "@/lib/use-report-sales";
import { usePos } from "@/lib/pos-store";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ThemedSelect } from "./ThemedSelect";
import { paymentTenderKey, paymentTenderLabel } from "@/lib/sales-report-search";
const Bills = lazy(() =>
  import("@/routes/reports.sales").then((module) => ({ default: module.BillsReport })),
);
const Items = lazy(() =>
  import("./ItemSalesReport").then((module) => ({ default: module.ItemSalesReport })),
);
const Payments = lazy(() =>
  import("./PaymentsReport").then((module) => ({ default: module.PaymentsReport })),
);
export type SalesReportView = "bills" | "items" | "payments";
export function SalesReportWorkspace({ initialView = "bills" }: { initialView?: SalesReportView }) {
  const { state, stores, currentStore } = usePos();
  const { user, terminalStoreId, canSwitchStores } = useAuth();
  const companyStores = companyStoreScope(stores, terminalStoreId || user?.storeId || currentStore.id,
    !canSwitchStores || !!terminalStoreId || !!user?.storeId);
  const baseFilters = useSalesReportFilters(defaultRange());
  // A changed global branch immediately selects that branch before effects run.
  const [selection, setSelection] = useState({ viewBranch: currentStore.id, storeId: currentStore.id });
  const requestedStore = selection.viewBranch === currentStore.id ? selection.storeId : currentStore.id;
  const reportScope = salesReportScope({
    selectedStoreId: requestedStore, currentStoreId: currentStore.id, terminalStoreId,
    userStoreId: user?.storeId, canSwitchStores, storeIds: companyStores.map(store => store.id),
  });
  const filters = {
    ...baseFilters, storeId: reportScope.storeId,
    setStoreId: (value: SetStateAction<string>) => setSelection({
      viewBranch: currentStore.id,
      storeId: typeof value === "function" ? value(reportScope.storeId) : value,
    }),
  };
  const availableStores = stores.filter(store => reportScope.allowedStoreIds.includes(canonicalBranchId(store.id)));
  const [view, setView] = useState<SalesReportView>(initialView);
  useEffect(() => setView(initialView), [initialView]);
  const exportAction = useRef<(() => void) | undefined>(undefined);
  const tabs = (
    <div
      role="tablist"
      aria-label="Sales report views"
      className="flex gap-1 rounded-xl border border-border bg-muted/40 p-1"
    >
      {(
        [
          ["bills", "Bills"],
          ["items", "Items"],
          ["payments", "Payments"],
        ] as const
      ).map(([key, label]) => (
        <Button
          key={key}
          size="sm"
          role="tab"
          id={"sales-tab-" + key}
          aria-controls="sales-report-panel"
          aria-selected={view === key}
          variant={view === key ? "default" : "ghost"}
          onClick={() => {
            exportAction.current = undefined;
            setView(key);
          }}
        >
          {label}
        </Button>
      ))}
    </div>
  );
  const storeIds = reportScope.storeIds;
  const history = useReportSales(state.sales, storeIds, filters.from, filters.to, storeIds.length > 0);
  const cashiers = useMemo(
    () => [...new Set(history.sales.map((sale) => sale.cashier).filter(Boolean))].sort(),
    [history.sales],
  );
  const tenderOptions = useMemo(
    () =>
      [
        ...new Set(
          history.sales.flatMap((sale) =>
            (sale.payments?.length ? sale.payments : [{ method: sale.method }]).map(
              paymentTenderKey,
            ),
          ),
        ),
      ].sort(),
    [history.sales],
  );
  return (
    <AppShell>
      <SalesReportContext.Provider value={{ ...filters, history, reportStoreIds: storeIds, exportAction }}>
        <div className="pos-page-boundary">
          <div className="space-y-4 px-4 pt-4 sm:px-6 sm:pt-6">
            <ReportHeader
              workspaceHeader
              toolbar={tabs}
              onExport={() => exportAction.current?.()}
              title="Sales Report"
              subtitle={
                [filters.from || "Any start date", filters.to || "Any end date"].join(" → ") +
                " · " +
                (filters.storeId === "all"
                  ? "All permitted company branches"
                  : (stores.find((store) => store.id === filters.storeId)?.name ??
                    "Selected branch")) +
                " · " +
                (filters.cashier === "all" ? "All cashiers" : filters.cashier)
              }
              from={filters.from}
              to={filters.to}
              onFrom={filters.setFrom}
              onTo={filters.setTo}
            >
              <div className="min-w-40 flex-1 space-y-1">
                <Label className="text-xs">Branch</Label>
                <ThemedSelect
                  ariaLabel="Sales report branch"
                  value={filters.storeId}
                  onChange={filters.setStoreId}
                  options={[
                    ...(reportScope.canAggregate ? [{ value: "all", label: "All permitted company branches" }] : []),
                    ...availableStores.map((store) => ({ value: canonicalBranchId(store.id), label: store.name })),
                  ]}
                />
              </div>
              <div className="min-w-40 flex-1 space-y-1">
                <Label className="text-xs">Cashier</Label>
                <ThemedSelect
                  ariaLabel="Sales report cashier"
                  value={filters.cashier}
                  onChange={filters.setCashier}
                  options={[
                    { value: "all", label: "All cashiers" },
                    ...cashiers.map((cashier) => ({ value: cashier, label: cashier })),
                  ]}
                />
              </div>
              <div className="min-w-48 flex-[2] space-y-1">
                <Label htmlFor="sales-report-search" className="text-xs">
                  Bill or item search
                </Label>
                <Input
                  id="sales-report-search"
                  value={filters.q}
                  onChange={(event) => filters.setQ(event.target.value)}
                  placeholder="Receipt, item, SKU or barcode"
                />
              </div>
              {view === "payments" && (
                <div className="min-w-40 flex-1 space-y-1">
                  <Label className="text-xs">Payment method / machine</Label>
                  <ThemedSelect
                    ariaLabel="Sales report payment method"
                    value={filters.tender}
                    onChange={filters.setTender}
                    options={[
                      { value: "all", label: "All payment methods" },
                      ...tenderOptions.map((key) => ({
                        value: key,
                        label: paymentTenderLabel(key),
                      })),
                    ]}
                  />
                </div>
              )}
            </ReportHeader>
          </div>
          <div role="tabpanel" id="sales-report-panel" aria-labelledby={"sales-tab-" + view}>
            <Suspense
              fallback={
                <p role="status" className="p-6 text-sm text-muted-foreground">
                  Opening report view…
                </p>
              }
            >
              {view === "bills" ? <Bills /> : view === "items" ? <Items /> : <Payments />}
            </Suspense>
          </div>
        </div>
      </SalesReportContext.Provider>
    </AppShell>
  );
}
