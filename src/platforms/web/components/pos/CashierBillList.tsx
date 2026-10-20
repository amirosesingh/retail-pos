import { useMemo, useState } from "react";
import type { Sale } from "@/core/types/pos-types";
import { money } from "@/lib/pos-store";
import { formatTime } from "@/lib/time-zone";
import { Input } from "@/components/ui/input";
import { ReportReceiptLink } from "./ReportReceiptLink";
import { TablePagination, usePagination } from "./TablePagination";

/** Uses only the dashboard's already branch-scoped sales snapshot. */
export function CashierBillList({ sales, cashier }: { sales: Sale[]; cashier: string }) {
  const [query, setQuery] = useState("");
  const bills = useMemo(() => sales.filter(sale =>
    (sale.cashier || "Unknown") === cashier &&
    (sale.receiptNo || "").toLowerCase().includes(query.trim().toLowerCase())
  ).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [sales, cashier, query]);
  const pager = usePagination(bills, 10);
  return <section aria-label={`Bills for ${cashier}`} className="space-y-3">
    <Input aria-label={`Search bill number for ${cashier}`} placeholder="Search bill number"
      value={query} onChange={event => { setQuery(event.target.value); pager.setPage(1); }} className="sm:max-w-xs" />
    <div className="grid gap-3 lg:grid-cols-2">
      {pager.pageItems.map(sale => <article key={sale.id} className="min-w-0 space-y-3 rounded-xl border border-border p-3">
        <div className="flex flex-wrap items-start justify-between gap-2 text-sm">
          <div className="min-w-0"><ReportReceiptLink sale={sale} /></div>
          <span className="text-xs text-muted-foreground">{formatTime(sale.createdAt)} · {sale.refunded ? "Refunded" : "Completed"}</span>
        </div>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div><dt className="text-xs text-muted-foreground">Original bill</dt><dd className="numeric">{money(sale.subtotal)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Discount</dt><dd className="numeric">{money(sale.discount)} <span className="text-xs text-muted-foreground">({(sale.subtotal > 0 ? sale.discount / sale.subtotal * 100 : 0).toFixed(1)}%)</span></dd></div>
          <div><dt className="text-xs text-muted-foreground">Final bill total</dt><dd className="numeric font-semibold">{money(sale.total)}</dd></div>
        </dl>
      </article>)}
    </div>
    {!bills.length && <p className="text-sm text-muted-foreground">{query ? "No bills match this number." : "No bills recorded for this cashier today."}</p>}
    <TablePagination {...pager} label="bills" onPage={pager.setPage} onPageSize={pager.setPageSize} />
  </section>;
}
