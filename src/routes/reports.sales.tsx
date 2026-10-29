import { reportSponsorshipStores, receiptAdjustmentLabel } from "@/lib/report-display";
import { FinancialBreakdown, FinancialInfoTip, SalesTotalInfo } from "@/platforms/web/components/pos/FinancialInfo";
import {useSponsorshipTotals} from "@/lib/use-sponsorship-totals";
import { ReportTable as Table } from "@/platforms/web/components/pos/report-kit";
import { ReportReceiptLink } from "@/platforms/web/components/pos/ReportReceiptLink";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, type ReactNode } from "react";
import { ReportFrame as AppShell } from "@/platforms/web/components/pos/report-kit";
import { SalesReportWorkspace } from "@/platforms/web/components/pos/SalesReportWorkspace";
import { useSalesReportFilters, useSalesReportContext } from "@/lib/sales-report-context";
import { saleMatchesSearch } from "@/lib/sales-report-search";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TablePagination, usePagination } from "@/platforms/web/components/pos/TablePagination";
import { money, usePos } from "@/lib/pos-store";
import { salesReconciliation } from "@/lib/sales-reconciliation";
import { SummaryCardRail } from "@/platforms/web/components/pos/SummaryCardRail";
import { paymentsLabel, methodLabel } from "@/core/types/pos-types";
import { useReportSales } from "@/lib/use-report-sales";
import {
  ReportHeader,
  defaultRange,
  downloadReport,
  inRange,
  stamp,
} from "@/platforms/web/components/pos/report-kit";

export const Route = createFileRoute("/reports/sales")({
  validateSearch: (search: Record<string, unknown>) =>
    ({ view: search.view === "items" || search.view === "payments" ? search.view : "bills" }) as {
      view: "bills" | "items" | "payments";
    },
  head: () => ({
    meta: [
      { title: "Sales Report — Retail" },
      {
        name: "description",
        content:
          "Bill-by-bill sales report with subtotal, discount, tax, tender type and cashier for any date range.",
      },
      { property: "og:title", content: "Sales Summary Report — Retail" },
      { property: "og:description", content: "Revenue and discount breakdown per bill." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SalesReportPage,
});

function SalesReportPage() {
  return <SalesReportWorkspace initialView={Route.useSearch().view} />;
}

export function BillsReport() {
  const { state, stores } = usePos();
  const init = defaultRange();
  const { from, setFrom, to, setTo, storeId, cashier, q } = useSalesReportFilters(init);
  const shared = useSalesReportContext();
  const localHistory = useReportSales(
    state.sales,
    stores.map((store) => store.id),
    from,
    to,
    !shared,
  );
  const history = shared?.history ?? localHistory;
  const includeSponsorship=state.settings.integrations.includeSponsorshipInDailySales===true;
  const sponsorship=useSponsorshipTotals(reportSponsorshipStores(storeId,stores.map(store=>store.id),shared?.reportStoreIds),from,to,includeSponsorship&&cashier==="all"&&!q);
  const showSponsorship=includeSponsorship&&cashier==="all"&&!q;
  const products = useMemo(
    () => new Map(state.products.map((product) => [product.id, product])),
    [state.products],
  );

  const rows = useMemo(
    () =>
      history.sales
        .filter(
          (s) =>
            inRange(s.createdAt, from, to) &&
            (storeId === "all" || s.storeId === storeId) &&
            (cashier === "all" || s.cashier === cashier) &&
            saleMatchesSearch(s, q, products),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [history.sales, from, to, storeId, cashier, q, products],
  );

  const totals = useMemo(() => salesReconciliation(rows), [rows]);
  const showTaxColumn = rows.some(sale => Math.abs(sale.tax) >= 0.005);
  const pager = usePagination(rows);

  return (
    <AppShell>
      <div className="pos-page-container">
        <ReportHeader
          title="Sales Summary"
          subtitle="Every completed bill in the selected window."
          from={from}
          to={to}
          onFrom={setFrom}
          onTo={setTo}
          onExport={() =>
            downloadReport("sales-summary", [
              [
                "Time",
                "Receipt",
                "Store",
                "Cashier",
                "Method",
                "Subtotal",
                "Discount",
                ...(showTaxColumn ? ["Tax"] : []),
                "Total",
              ],
              ...rows.map((s) => [
                stamp(s.createdAt),
                s.receiptNo,
                stores.find((store) => store.id === s.storeId)?.name ?? s.storeName ?? s.storeId,
                s.cashier,
                s.payments?.length ? paymentsLabel(s.payments) : methodLabel(s.method),
                s.subtotal,
                s.discount,
                ...(showTaxColumn ? [s.tax] : []),
                s.total,
              ]),
            ])
          }
        />

        {history.loading ? (
          <p className="text-sm text-muted-foreground">Updating report data…</p>
        ) : null}
        {history.error ? <p className="text-sm text-destructive">{history.error}</p> : null}

        {!history.loading && !history.error && <SummaryCardRail label="Sales report totals">
          <SalesStatCard label="Completed bills" value={String(totals.bills)} />
          {showSponsorship && !sponsorship.loading && !sponsorship.error && sponsorship.total > 0 && <>
            <SalesStatCard label="Sales value with sponsorship · not collections" value={money(totals.collected + sponsorship.total)} info={<SalesTotalInfo totals={totals} adjustmentLabel={receiptAdjustmentLabel(rows)} sponsorshipValue={sponsorship.total} />} />
            <SalesStatCard label="Sponsorship value included" value={money(sponsorship.total)} info={<FinancialBreakdown rows={[["Sponsorship value", money(sponsorship.total)]]}><p>Included under the saved daily-sales policy. Stock value is separate from customer payments.</p></FinancialBreakdown>} />
          </>}
          <SalesStatCard label="Net sales before receipt adjustments (ex tax)" value={money(totals.net)} info={<SalesTotalInfo totals={totals} adjustmentLabel={receiptAdjustmentLabel(rows)} />} />
          <SalesStatCard label="Total collected · without sponsorship" value={money(totals.collected)} info={<SalesTotalInfo totals={totals} adjustmentLabel={receiptAdjustmentLabel(rows)} />} />
          <SalesStatCard label="Discounts given" value={money(totals.discounts)} info={<SalesTotalInfo totals={totals} adjustmentLabel={receiptAdjustmentLabel(rows)} />} />
          {Math.abs(totals.tax) >= 0.005 && <SalesStatCard label="Tax collected" value={money(totals.tax)} info={<SalesTotalInfo totals={totals} adjustmentLabel={receiptAdjustmentLabel(rows)} />} />}
        </SummaryCardRail>}
        {showSponsorship && sponsorship.error && <p role="alert" className="text-sm text-destructive">Sponsorship values could not be refreshed. Customer payment totals are shown separately.</p>}

        <div className="rounded-2xl border border-border bg-card">
          <Table tableId="routes/reports.sales#1" loading={history.loading}>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Receipt</TableHead>
                <TableHead>Cashier</TableHead>
                <TableHead>Method</TableHead>
                <TableHead className="text-right">Discount</TableHead>
                {showTaxColumn && <TableHead className="text-right">Tax</TableHead>}
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pager.pageItems.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="numeric text-sm">{stamp(s.createdAt)}</TableCell>
                  <TableCell data-sort-value={s.receiptNo}>
                    <ReportReceiptLink sale={s} />
                  </TableCell>
                  <TableCell>{s.cashier}</TableCell>
                  <TableCell>
                    {s.payments?.length ? paymentsLabel(s.payments) : methodLabel(s.method)}
                  </TableCell>
                  <TableCell className="numeric text-right">{money(s.discount)}</TableCell>
                  {showTaxColumn && <TableCell className="numeric text-right">{money(s.tax)}</TableCell>}
                  <TableCell className="numeric text-right font-semibold">
                    {money(s.total)}
                  </TableCell>
                </TableRow>
              ))}
              {!rows.length && (
                <TableRow>
                  <TableCell
                    colSpan={showTaxColumn ? 7 : 6}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    No bills in this date range.
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
            label="bills"
            onPage={pager.setPage}
            onPageSize={pager.setPageSize}
          />
        </div>
      </div>
    </AppShell>
  );
}

/** Sales-only typography; other reports retain their existing appearance. */
function SalesStatCard({ label, value, info }: { label: string; value: string; info?: ReactNode }) {
  return <div className="min-w-0 rounded-xl border border-border bg-card p-4 font-sans">
    <div className="flex items-center justify-between gap-1"><p className="text-sm font-normal text-muted-foreground">{label}</p>{info && <FinancialInfoTip label={label}>{info}</FinancialInfoTip>}</div>
    <p className="mt-1 min-w-0 text-xl font-medium tabular-nums [overflow-wrap:anywhere]">{value}</p>
  </div>;
}
