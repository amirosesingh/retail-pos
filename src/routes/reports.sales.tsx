import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TablePagination, usePagination } from "@/platforms/web/components/pos/TablePagination";
import { money, usePos } from "@/lib/pos-store";
import { saleNetRevenue } from "@/core/pricing/profit";
import { useReportSales } from "@/lib/use-report-sales";
import {
  ReportHeader,
  StatCard,
  defaultRange,
  downloadCsv,
  inRange,
  stamp,
} from "@/platforms/web/components/pos/report-kit";

export const Route = createFileRoute("/reports/sales")({
  head: () => ({
    meta: [
      { title: "Sales Summary Report — Retail" },
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
  component: SalesReport,
});

function SalesReport() {
  const { state, stores } = usePos();
  const init = defaultRange();
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const history = useReportSales(state.sales, stores.map((store) => store.id), from, to);

  const rows = useMemo(
    () =>
      history.sales
        .filter((s) => inRange(s.createdAt, from, to))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [history.sales, from, to],
  );

  const totals = rows.filter((sale) => !sale.refunded).reduce(
    (a, s) => ({
      net: a.net + saleNetRevenue(s),
      collected: a.collected + s.total,
      discount: a.discount + s.discount,
      tax: a.tax + s.tax,
    }),
    { net: 0, collected: 0, discount: 0, tax: 0 },
  );
  const pager = usePagination(rows);

  return (
    <AppShell>
      <div className="space-y-5 p-6">
        <ReportHeader
          title="Sales Summary"
          subtitle="Every completed bill in the selected window."
          from={from}
          to={to}
          onFrom={setFrom}
          onTo={setTo}
          onExport={() =>
            downloadCsv("sales-summary", [
              ["Time", "Receipt", "Store", "Cashier", "Method", "Subtotal", "Discount", "Tax", "Total"],
              ...rows.map((s) => [
                stamp(s.createdAt),
                s.receiptNo,
                s.storeId,
                s.cashier,
                s.method,
                s.subtotal,
                s.discount,
                s.tax,
                s.total,
              ]),
            ])
          }
        />

        {history.loading ? <p className="text-sm text-muted-foreground">Loading complete SQL history…</p> : null}
        {history.error ? <p className="text-sm text-destructive">{history.error}</p> : null}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard label="Completed bills" value={String(rows.filter((sale) => !sale.refunded).length)} />
          <StatCard label="Net sales (ex tax)" value={money(totals.net)} />
          <StatCard label="Total collected" value={money(totals.collected)} />
          <StatCard label="Discounts given" value={money(totals.discount)} />
          <StatCard label="Tax collected" value={money(totals.tax)} />
        </div>

        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Receipt</TableHead>
                <TableHead>Cashier</TableHead>
                <TableHead>Method</TableHead>
                <TableHead className="text-right">Discount</TableHead>
                <TableHead className="text-right">Tax</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pager.pageItems.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="numeric text-xs">{stamp(s.createdAt)}</TableCell>
                  <TableCell className="font-medium">{s.receiptNo}</TableCell>
                  <TableCell>{s.cashier}</TableCell>
                  <TableCell className="capitalize">{s.method.replace("_", " ")}</TableCell>
                  <TableCell className="numeric text-right">{money(s.discount)}</TableCell>
                  <TableCell className="numeric text-right">{money(s.tax)}</TableCell>
                  <TableCell className="numeric text-right font-semibold">{money(s.total)}</TableCell>
                </TableRow>
              ))}
              {!rows.length && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
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
