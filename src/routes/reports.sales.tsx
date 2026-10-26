import { HelpTip } from "@/components/ui/help-tip";
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
import { saleNetRevenue } from "@/core/pricing/profit";
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
  const sponsorship=useSponsorshipTotals(storeId==="all"?stores.map(store=>store.id):[storeId],from,to,includeSponsorship&&cashier==="all"&&!q);
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

  const totals = rows
    .filter((sale) => !sale.refunded)
    .reduce(
      (a, s) => ({
        net: a.net + saleNetRevenue(s),
        collected: a.collected + s.total,
        discount: a.discount + s.discount,
        tax: a.tax + s.tax,
        rounding: a.rounding + (s.roundingAdjustment ?? 0),
      }),
      { net: 0, collected: 0, discount: 0, tax: 0, rounding: 0 },
    );
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

        <div className="summary-grid grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <SalesStatCard
            label="Completed bills"
            value={String(rows.filter((sale) => !sale.refunded).length)}
          />
{showSponsorship && !sponsorship.loading && !sponsorship.error && sponsorship.total > 0 && <><SalesStatCard label="Sales summary including sponsorship" value={sponsorship.loading?"Loading…":sponsorship.error?"Unavailable":money(totals.collected+sponsorship.total)}/><SalesStatCard label="Sponsorship value included" value={sponsorship.error?"Unavailable":money(sponsorship.total)}/></>}
          <SalesStatCard label="Net sales (ex tax)" value={money(totals.net)} info={<>
            <p>Sales after discounts, excluding tax and rounding. Bills marked refunded are excluded.</p>
            <p className="mt-2">Net sales: {money(totals.net)}</p>
            {Math.abs(totals.tax) >= 0.005 && <p>Tax: {money(totals.tax)}</p>}
            <p>Rounding adjustment: {money(totals.rounding)}</p>
            <p>Total collected: {money(totals.collected)}</p>
            <p className="mt-2">Negative rounding reduces the amount collected; positive rounding increases it.</p>
          </>} />
          <SalesStatCard label="Total collected" value={money(totals.collected)} info="Completed bill totals after discounts, including any tax and final rounding. Refunded bills are excluded." />
          <SalesStatCard label="Discounts given" value={money(totals.discount)} info="Recorded discounts on completed, non-refunded bills. These are already deducted from Net sales; do not subtract them again. Rounding adjustments are shown separately in the Net sales information." />
          {Math.abs(totals.tax) >= 0.005 && <SalesStatCard label="Tax collected" value={money(totals.tax)} />}
        </div>

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
    <div className="flex items-center justify-between gap-2"><p className="text-sm font-normal text-muted-foreground">{label}</p>{info && <HelpTip label={`${label} information`} text={info} />}</div>
    <p className="mt-1 break-words text-xl font-medium tabular-nums">{value}</p>
  </div>;
}
