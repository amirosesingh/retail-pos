import type { Ref } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TablePagination, usePagination } from "./TablePagination";
import type { StockActivityProduct, StockReportActivitySide } from "./use-stock-report-activity";

const activityLabels: Record<string, string> = {
  sale: "Sale", refund: "Refund", return: "Return", receive: "Receiving", receiving: "Receiving",
  stock: "Stock adjustment", adjustment: "Stock adjustment", stock_adjustment: "Stock adjustment",
  transfer: "Transfer", transfer_in: "Transfer in", transfer_out: "Transfer out", merge: "Product merge",
};

export function StockActivityTime({ value, format }: { value?: string; format: Intl.DateTimeFormat }) {
  if (!value) return <>—</>;
  const fraction = /\.(\d{1,7})Z$/.exec(value)?.[1]?.replace(/0+$/, "") ?? "";
  return <time dateTime={value} title={value}>{format.format(new Date(value))}{fraction && `.${fraction}`}</time>;
}

type RecordedBalanceRow = StockActivityProduct & { quantity: number | null; lastChange?: string; supportedAt?: string };

export function StockRecordedBalances({ rows, zeroOnly, selected, selectProduct, format }: {
  rows: RecordedBalanceRow[];
  zeroOnly: boolean;
  selected?: string;
  selectProduct: (productId: string) => void;
  format: Intl.DateTimeFormat;
}) {
  const filtered = zeroOnly ? rows.filter(row => row.quantity === 0) : rows;
  const { pageItems, setPage, setPageSize, ...pagination } = usePagination(filtered, 50);

  return <section className="space-y-2" aria-label="Balances from inventory activity">
    <h3 className="text-sm font-semibold">Stock at selected time</h3>
    <p className="text-xs text-muted-foreground">Recorded balances are provisional. Missing or conflicting activity leaves an item's balance unverified.</p>
    <div className="overflow-x-auto rounded-md border"><Table aria-label="Stock at selected time">
      <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>SKU / barcode</TableHead><TableHead className="text-right">Recorded stock</TableHead>
        <TableHead>Last recorded change</TableHead><TableHead>Balance status</TableHead></TableRow></TableHeader>
      <TableBody>{pageItems.length ? pageItems.map(row => <TableRow key={row.productId}>
        <TableCell className="min-w-40 max-w-80 whitespace-normal break-words">{row.name}
          <Button type="button" variant="link" size="sm" className="block h-auto px-0 py-1" onClick={() => selectProduct(row.productId)}
            aria-label={`Filter activity for ${row.name}`} aria-pressed={selected === row.productId}>Filter activity</Button>
        </TableCell>
        <TableCell className="max-w-52 whitespace-normal break-all text-xs">{row.sku || "—"}<br />{row.barcode || "—"}</TableCell>
        <TableCell className={`numeric whitespace-nowrap text-right ${row.quantity !== null && row.quantity < 0 ? "text-destructive" : ""}`}>{row.quantity ?? "—"}</TableCell>
        <TableCell className="whitespace-normal text-xs"><StockActivityTime value={row.lastChange} format={format} /></TableCell>
        <TableCell className="whitespace-normal text-xs">{row.quantity === null ? "Unverified" : "Provisional"}
          {row.supportedAt && row.supportedAt !== row.lastChange && <span className="block text-muted-foreground">Balance recorded <StockActivityTime value={row.supportedAt} format={format} /></span>}
        </TableCell>
      </TableRow>) : <TableRow><TableCell colSpan={5}>{zeroOnly ? "No recorded zero-stock balances for this selection." : "No products with available inventory activity or catalogue information."}</TableCell></TableRow>}</TableBody>
    </Table></div>
    {pagination.pageCount > 1 && <TablePagination {...pagination} onPage={setPage} onPageSize={setPageSize} label="products" />}
  </section>;
}

function TransactionTable({ title, navigation, view, products, format }: {
  title: string;
  navigation: string;
  view: StockReportActivitySide;
  products: ReadonlyMap<string, StockActivityProduct>;
  format: Intl.DateTimeFormat;
}) {
  return <section className="min-w-0 space-y-2" aria-label={title} aria-busy={view.loading}>
    <h4 className="text-sm font-medium">{title}</h4>
    {view.error && <p role="alert" className="text-xs text-destructive">{view.error} <Button variant="link" size="sm" className="h-auto px-1" onClick={view.retry}>Retry activity</Button></p>}
    {view.loading && <p role="status" className="text-xs text-muted-foreground">Loading inventory activity…</p>}
    {view.page && (view.page.rows.length ? <div className="overflow-x-auto rounded-md border">
      <Table aria-label={title}>
        <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Product</TableHead><TableHead>Movement</TableHead>
          <TableHead className="text-right">Change</TableHead><TableHead className="text-right">Stock before</TableHead>
          <TableHead className="text-right">Stock after</TableHead><TableHead>Reference</TableHead></TableRow></TableHeader>
        <TableBody>{view.page.rows.map(row => <TableRow key={row.id}>
          <TableCell className="whitespace-normal text-xs"><StockActivityTime value={row.occurredAt} format={format} /></TableCell>
          <TableCell className="min-w-32 max-w-72 whitespace-normal break-words">{products.get(row.productId)?.name ?? row.productName ?? row.productId}</TableCell>
          <TableCell className="whitespace-normal">{activityLabels[row.kind] ?? row.kind.replace(/[_-]/g, " ")}</TableCell>
          <TableCell className="numeric text-right">{row.delta === null ? "—" : row.delta > 0 ? `+${row.delta}` : row.delta}</TableCell>
          <TableCell className="numeric text-right">{row.before ?? "—"}</TableCell>
          <TableCell className="numeric text-right">{row.after ?? "—"}</TableCell>
          <TableCell className="max-w-52 whitespace-normal break-all text-xs">{row.reference ?? "—"}</TableCell>
        </TableRow>)}</TableBody>
      </Table>
    </div> : <p className="text-xs text-muted-foreground">No recorded activity for this part of the report.</p>)}
    {view.page && (view.page.next || view.number > 1) && <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">Page {view.number}</span>
      {view.number > 1 && <Button size="sm" variant="outline" disabled={view.loading} onClick={view.firstPage}>First activity page</Button>}
      {view.page.next && <Button size="sm" variant="outline" disabled={view.loading} onClick={view.nextPage}>{navigation}</Button>}
    </div>}
    {view.evidenceLimit && <p className="text-xs text-muted-foreground">Activity balances use the {view.evidenceLimit} records closest to this cutoff on this side.</p>}
  </section>;
}

export function StockReportActivity({ before, after, products, selected, clearSelection, format, timeZone, heading }: {
  before: StockReportActivitySide;
  after: StockReportActivitySide;
  products: ReadonlyMap<string, StockActivityProduct>;
  selected?: string;
  clearSelection: () => void;
  format: Intl.DateTimeFormat;
  timeZone: string;
  heading?: Ref<HTMLHeadingElement>;
}) {
  return <section className="space-y-3 rounded-md border p-3" aria-label="Inventory activity">
    <div className="flex flex-wrap items-center justify-between gap-2"><div>
      <h3 ref={heading} tabIndex={-1} className="text-sm font-semibold">Inventory activity</h3>
      <p className="text-xs text-muted-foreground">Recorded movement times · {timeZone}{selected && ` · ${products.get(selected)?.name ?? selected}`}</p>
    </div>{selected && <Button type="button" variant="outline" size="sm" onClick={clearSelection}>All products</Button>}</div>
    <TransactionTable title="Activity at or before the cutoff" navigation="Earlier activity" view={before} products={products} format={format} />
    <TransactionTable title="Activity after the cutoff" navigation="Later activity" view={after} products={products} format={format} />
  </section>;
}
