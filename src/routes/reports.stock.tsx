import { ReportTable as Table } from "@/platforms/web/components/pos/report-kit";
import { PAGE_DATA_CACHE, pageDataScope } from "@/lib/page-data-cache";
import { useAuth } from "@/lib/pos-auth";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ThemedSelect } from "@/platforms/web/components/pos/ThemedSelect";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TablePagination, usePagination } from "@/platforms/web/components/pos/TablePagination";
import { money, usePos } from "@/lib/pos-store";
import { useQuery } from "@tanstack/react-query";
import { loadStockAdjustmentReport } from "@/lib/stock-adjustment-report";
import { sameBranchId } from "@/lib/branch-id";
import { STOCK_ADJUSTMENT_REASONS } from "@/core/types/pos-types";
import {
  ReportHeader,
  StatCard,
  defaultRange,
  downloadReport,
  stamp,
} from "@/platforms/web/components/pos/report-kit";

export const Route = createFileRoute("/reports/stock")({
  head: () => ({
    meta: [
      { title: "Stock Adjustments Report — POS" },
      {
        name: "description",
        content:
          "Every stock correction and calibration variance: product, branch, reason, units over or short, cost impact, who did it and when.",
      },
      { property: "og:title", content: "Stock Adjustments Report — POS" },
      {
        property: "og:description",
        content: "Audit trail of stock checks, damages, losses and corrections.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: StockReport,
});

const ALL = "__all__";

const reasonLabel = (v: string) => STOCK_ADJUSTMENT_REASONS.find((r) => r.value === v)?.label ?? v;

function StockReport() {
  const { user } = useAuth();
  const { state, stores } = usePos();
  const init = defaultRange();
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [query, setQuery] = useState("");
  const [reason, setReason] = useState(ALL);
  const [store, setStore] = useState(ALL);
  const [direction, setDirection] = useState(ALL);

  const storeIds = useMemo(
    () => (store === ALL ? stores.map((item) => item.id) : [store]),
    [stores, store],
  );
  const history = useQuery({
    queryKey: ["stock-adjustment-report", pageDataScope(user), from, to, storeIds.join("|")],
    meta: { tables: ["stock_adjustments"] },
    queryFn: () => loadStockAdjustmentReport(storeIds, from, to),
    ...PAGE_DATA_CACHE,
    refetchOnWindowFocus: true,
  });
  const all = useMemo(() => history.data ?? [], [history.data]);
  const rows = useMemo(
    () =>
      all.filter(
        (r) =>
          (!query || `${r.name} ${r.sku}`.toLowerCase().includes(query.trim().toLowerCase())) &&
          (reason === ALL || r.reason === reason) &&
          (store === ALL || sameBranchId(r.storeId, store)) &&
          (direction === ALL || (direction === "over" ? r.delta > 0 : r.delta < 0)),
      ),
    [all, query, reason, store, direction],
  );

  const pager = usePagination(rows);
  const over = rows.filter((r) => r.delta > 0).reduce((a, r) => a + r.delta, 0);
  const short = rows.filter((r) => r.delta < 0).reduce((a, r) => a + r.delta, 0);
  const impact = rows.reduce((a, r) => a + r.cost, 0);
  const storeName = (id: string) => stores.find((s) => sameBranchId(s.id, id))?.name ?? "—";

  return (
    <AppShell>
      <div className="pos-page-container">
        <ReportHeader
          title="Stock Adjustments & Calibration"
          subtitle="Every correction to stock on hand, with the reason, the variance and the person responsible."
          from={from}
          to={to}
          onFrom={setFrom}
          onTo={setTo}
          onExport={() =>
            downloadReport("stock-adjustments", [
              [
                "Time",
                "Product",
                "SKU",
                "Branch",
                "Reason",
                "Before",
                "After",
                "Difference",
                "Cost impact",
                "Staff",
                "Note",
              ],
              ...rows.map((r) => [
                stamp(r.at),
                r.name,
                r.sku,
                storeName(r.storeId),
                reasonLabel(r.reason),
                r.before,
                r.after,
                r.delta,
                r.cost,
                r.staff,
                r.note,
              ]),
            ])
          }
        >
          <div className="space-y-1">
            <Label className="text-sm">Product</Label>
            <Input
              className="h-9 w-44"
              placeholder="Name or SKU…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-sm">Reason</Label>
            <ThemedSelect
              ariaLabel="Reason"
              className="h-9 w-48"
              value={reason}
              onChange={setReason}
              options={[
                { value: ALL, label: "All reasons" },
                ...STOCK_ADJUSTMENT_REASONS.map((r) => ({ value: r.value, label: r.label })),
              ]}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-sm">Branch</Label>
            <ThemedSelect
              ariaLabel="Branch"
              className="h-9 w-40"
              value={store}
              onChange={setStore}
              options={[
                { value: ALL, label: "All branches" },
                ...stores.map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-sm">Direction</Label>
            <ThemedSelect
              ariaLabel="Direction"
              className="h-9 w-36"
              value={direction}
              onChange={setDirection}
              options={[
                { value: ALL, label: "Over & short" },
                { value: "over", label: "Overage only" },
                { value: "short", label: "Shortage only" },
              ]}
            />
          </div>
          <Button
            variant="outline"
            disabled={history.isFetching}
            onClick={() => void history.refetch()}
          >
            Refresh
          </Button>
          <Button
            variant="ghost"
            className="h-9"
            onClick={() => {
              setQuery("");
              setReason(ALL);
              setStore(ALL);
              setDirection(ALL);
            }}
          >
            Clear filters
          </Button>
        </ReportHeader>
        {history.error && (
          <p role="alert" className="text-sm text-destructive">
            {history.error.message}
          </p>
        )}

        <div className="summary-grid grid gap-4 sm:grid-cols-4">
          <StatCard label="Adjustments" value={String(rows.length)} />
          <StatCard label="Units over" value={`+${over}`} />
          <StatCard label="Units short" value={String(short)} />
          <StatCard
            label="Cost impact"
            value={money(impact)}
            hint={`${state.products.length} products in catalog`}
          />
        </div>

        <div className="rounded-2xl border border-border bg-card">
          <Table tableId="routes/reports.stock#1" loading={history.isPending}>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Before</TableHead>
                <TableHead className="text-right">After</TableHead>
                <TableHead className="text-right">Diff</TableHead>
                <TableHead className="text-right">Cost impact</TableHead>
                <TableHead>Staff</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pager.pageItems.map((r, i) => (
                <TableRow key={`${r.at}-${i}`}>
                  <TableCell className="numeric text-sm">{stamp(r.at)}</TableCell>
                  <TableCell>
                    <div className="font-medium">{r.name}</div>
                    <div className="numeric text-xs text-muted-foreground">{r.sku}</div>
                    {r.note && <div className="text-xs text-muted-foreground">“{r.note}”</div>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{storeName(r.storeId)}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{reasonLabel(r.reason)}</Badge>
                  </TableCell>
                  <TableCell className="numeric text-right">{r.before}</TableCell>
                  <TableCell className="numeric text-right">{r.after}</TableCell>
                  <TableCell
                    className={`numeric text-right ${
                      r.delta > 0 ? "text-success" : "text-destructive"
                    }`}
                  >
                    {r.delta > 0 ? `+${r.delta}` : r.delta}
                  </TableCell>
                  <TableCell className="numeric text-right">{money(r.cost)}</TableCell>
                  <TableCell>{r.staff}</TableCell>
                </TableRow>
              ))}
              {!rows.length && (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    No stock adjustments match these filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <TablePagination
            page={pager.page}
            pageCount={pager.pageCount}
            pageSize={pager.pageSize}
            total={pager.total}
            from={pager.from}
            to={pager.to}
            label="adjustments"
            onPage={pager.setPage}
            onPageSize={pager.setPageSize}
          />
        </div>
      </div>
    </AppShell>
  );
}
