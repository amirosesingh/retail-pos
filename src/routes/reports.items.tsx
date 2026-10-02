import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemedSelect } from "@/platforms/web/components/pos/ThemedSelect";
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
import { soldLines, sumLines } from "@/lib/sales-analytics";
import { useReportSales } from "@/lib/use-report-sales";
import {
  ReportHeader,
  StatCard,
  defaultRange,
  downloadCsv,
  inRange,
  stamp,
} from "@/platforms/web/components/pos/report-kit";
import { branchDisplayName } from "@/lib/human-readable";

export const Route = createFileRoute("/reports/items")({
  head: () => ({
    meta: [
      { title: "Item Sales History — Retail" },
      {
        name: "description",
        content:
          "Line-by-line history of every item sold: date, time, cashier, price, cost price, margin and profit for any date range.",
      },
      { property: "og:title", content: "Item Sales History — Retail" },
      {
        property: "og:description",
        content: "Every sold line with cost price, margin and profit.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ItemSalesReport,
});

function ItemSalesReport() {
  const { state, stores } = usePos();
  const init = defaultRange(30);
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [storeId, setStoreId] = useState("all");
  const reportStoreIds = storeId === "all" ? stores.map((store) => store.id) : [storeId];
  const history = useReportSales(state.sales, reportStoreIds, from, to);
  const [cashier, setCashier] = useState("all");
  const [q, setQ] = useState("");

  const cashiers = useMemo(
    () => [...new Set(history.sales.map((s) => s.cashier).filter(Boolean))].sort(),
    [history.sales],
  );

  const rows = useMemo(() => {
    const bills = history.sales.filter(
      (s) =>
        !s.refunded &&
        inRange(s.createdAt, from, to) &&
        (storeId === "all" || s.storeId === storeId) &&
        (cashier === "all" || s.cashier === cashier),
    );
    const needle = q.trim().toLowerCase();
    return soldLines(bills, state.products)
      .filter(
        (l) =>
          !needle ||
          l.name.toLowerCase().includes(needle) ||
          l.sku.toLowerCase().includes(needle) ||
          l.barcode.toLowerCase().includes(needle) ||
          l.receiptNo.toLowerCase().includes(needle),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [history.sales, state.products, from, to, storeId, cashier, q]);

  const totals = sumLines(rows);
  const pager = usePagination(rows);
  const storeName = (id: string) => branchDisplayName(stores, id);

  return (
    <AppShell>
      <div className="space-y-5 p-6">
        <ReportHeader
          title="Item Sales History"
          subtitle="Every item sold, line by line, with cost price and margin."
          from={from}
          to={to}
          onFrom={setFrom}
          onTo={setTo}
          onExport={() =>
            downloadCsv("item-sales", [
              [
                "Date & time",
                "Receipt",
                "Store",
                "Cashier",
                "Product",
                "SKU",
                "Barcode",
                "Unit",
                "Qty",
                "Unit price",
                "Discount",
                "Tax",
                "Revenue",
                "Unit cost",
                "Cost",
                "Profit",
                "Margin %",
              ],
              ...rows.map((l) => [
                stamp(l.createdAt),
                l.receiptNo,
                storeName(l.storeId),
                l.cashier,
                l.name,
                l.sku,
                l.barcode,
                l.unit,
                l.qty,
                l.price,
                l.discount,
                l.tax,
                l.revenue,
                l.unitCost,
                l.cost,
                l.profit,
                l.marginPct,
              ]),
            ])
          }
        >
          <div className="space-y-1">
            <Label className="text-xs">Store</Label>
            <ThemedSelect
              value={storeId}
              onChange={setStoreId}
              className="h-9 w-44"
              options={[
                { value: "all", label: "All stores" },
                ...stores.map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Cashier</Label>
            <ThemedSelect
              value={cashier}
              onChange={setCashier}
              className="h-9 w-44"
              options={[
                { value: "all", label: "All cashiers" },
                ...cashiers.map((c) => ({ value: c, label: c })),
              ]}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Search</Label>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Item, SKU, barcode or receipt"
              className="h-9 w-56"
            />
          </div>
        </ReportHeader>

        {history.loading ? (
          <p className="text-sm text-muted-foreground">Loading complete SQL history…</p>
        ) : null}
        {history.error ? <p className="text-sm text-destructive">{history.error}</p> : null}

        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Lines" value={String(totals.lines)} />
          <StatCard label="Units" value={String(totals.units)} />
          <StatCard label="Revenue" value={money(totals.revenue)} />
          <StatCard label="Cost" value={money(totals.cost)} />
          <StatCard label="Gross profit" value={money(totals.profit)} />
          <StatCard label="Margin" value={`${totals.marginPct.toFixed(1)}%`} />
        </div>

        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date &amp; time</TableHead>
                <TableHead>Receipt</TableHead>
                <TableHead>Store</TableHead>
                <TableHead>Cashier</TableHead>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Discount</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Profit</TableHead>
                <TableHead className="text-right">Margin</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pager.pageItems.map((l, i) => (
                <TableRow key={`${l.saleId}-${l.productId}-${i}`}>
                  <TableCell className="numeric text-xs">{stamp(l.createdAt)}</TableCell>
                  <TableCell className="font-medium">{l.receiptNo}</TableCell>
                  <TableCell className="text-xs">{storeName(l.storeId)}</TableCell>
                  <TableCell className="text-xs">{l.cashier}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span>{l.name}</span>
                      {l.foc && <Badge variant="secondary">FOC</Badge>}
                      {l.credit && <Badge variant="outline">Return</Badge>}
                    </div>
                    {(l.sku || l.barcode) && (
                      <p className="text-[11px] text-muted-foreground">
                        {[l.sku, l.barcode].filter(Boolean).join(" · ")}
                        {l.unit ? ` · ${l.unit}` : ""}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="numeric text-right">{l.qty}</TableCell>
                  <TableCell className="numeric text-right">{money(l.price)}</TableCell>
                  <TableCell className="numeric text-right">{money(l.discount)}</TableCell>
                  <TableCell className="numeric text-right font-semibold">
                    {money(l.revenue)}
                  </TableCell>
                  <TableCell className="numeric text-right">
                    {money(l.cost)}
                    {l.estimatedCost && (
                      <span className="ml-1 text-[10px] text-muted-foreground">est.</span>
                    )}
                  </TableCell>
                  <TableCell
                    className={`numeric text-right ${l.profit < 0 ? "text-destructive" : ""}`}
                  >
                    {money(l.profit)}
                  </TableCell>
                  <TableCell className="numeric text-right">{l.marginPct.toFixed(1)}%</TableCell>
                </TableRow>
              ))}
              {!rows.length && (
                <TableRow>
                  <TableCell
                    colSpan={12}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    No items sold in this window.
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
            label="lines"
            onPage={pager.setPage}
            onPageSize={pager.setPageSize}
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Lines marked “est.” were sold before cost capture was switched on, so their cost uses the
          product’s current cost price.
        </p>
      </div>
    </AppShell>
  );
}
