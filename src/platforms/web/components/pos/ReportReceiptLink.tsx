import { useState } from "react";
import { Eye, Printer } from "lucide-react";
import { lineDiscountTotal, paymentsLabel, methodLabel, type Sale } from "@/core/types/pos-types";
import { lineRevenue } from "@/core/pricing/profit";
import { money, usePos } from "@/lib/pos-store";
import { useAuth } from "@/lib/pos-auth";
import { useUserPermissions } from "@/lib/pos-permissions";
import { logger } from "@/lib/audit-log";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ReportTable } from "./report-kit";

/** Inspects the already authorized report snapshot, with separately gated printing. */
export function ReportReceiptLink({ sale, receiptNo }: { sale?: Sale; receiptNo?: string }) {
  const { state, stores } = usePos();
  const { can } = useAuth();
  const { requirePermission } = useUserPermissions();
  const [open, setOpen] = useState(false);
  const [receiptView, setReceiptView] = useState(false);
  const [html, setHtml] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!sale || !can("can_view_sales_reports"))
    return <span>{receiptNo ?? sale?.receiptNo ?? "—"}</span>;
  const member = state.members.find((person) => person.id === sale.memberId) ?? null;
  const viewReceipt = async () => {
    setReceiptView(true);
    setHtml("");
    setError("");
    try {
      const { saleReceiptPreview } = await import("@/lib/pos-print");
      setHtml(saleReceiptPreview(sale, member, "sale"));
    } catch {
      setError("The receipt preview could not be opened. Please try again.");
    }
  };
  const print = async () => {
    if (busy || !can("can_reprint_bill")) return;
    setBusy(true);
    setError("");
    try {
      if (!(await requirePermission("can_reprint_bill"))) return;
      const { printSaleReceipt } = await import("@/lib/pos-print");
      printSaleReceipt(sale, member, "sale");
      logger.log("print", "Receipt reprinted from report", "receipts", {
        saleId: sale.id,
        receiptNo: sale.receiptNo,
      });
    } catch {
      setError("The receipt could not be printed. Check your printer settings and try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setReceiptView(false);
          setError("");
        }}
        aria-label={"Open bill " + sale.receiptNo}
        className="break-all text-left font-medium text-primary underline decoration-primary/30 underline-offset-4 hover:decoration-primary focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {sale.receiptNo}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto rounded-2xl sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Bill {sale.receiptNo}</DialogTitle>
            <DialogDescription>Bill details, items and recorded payments.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={receiptView ? "outline" : "secondary"}
              onClick={() => setReceiptView(false)}
            >
              Bill details
            </Button>
            <Button
              size="sm"
              variant={receiptView ? "secondary" : "outline"}
              onClick={() => void viewReceipt()}
            >
              <Eye className="size-4" /> View receipt
            </Button>
            {can("can_reprint_bill") && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void print()}>
                <Printer className="size-4" /> {busy ? "Printing…" : "Print receipt"}
              </Button>
            )}
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {receiptView ? (
            html ? (
              <iframe
                title={"Receipt " + sale.receiptNo}
                sandbox=""
                srcDoc={html}
                className="h-[60dvh] w-full rounded-xl border border-border bg-white"
              />
            ) : (
              !error && (
                <p role="status" className="p-6 text-sm text-muted-foreground">
                  Opening receipt…
                </p>
              )
            )
          ) : (
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-4 rounded-xl bg-primary/5 p-4 text-sm">
                <BillField label="Receipt number" value={sale.receiptNo} />
                <BillField label="Sold by" value={sale.cashier || "—"} />
                <BillField label="Date & time" value={new Date(sale.createdAt).toLocaleString()} />
                <BillField
                  label="Branch"
                  value={
                    sale.storeName ||
                    stores.find((store) => store.id === sale.storeId)?.name ||
                    sale.storeId
                  }
                />
                {member && <BillField label="Customer" value={member.name} />}
                <BillField
                  label="Status"
                  value={
                    sale.refunded
                      ? "Refunded / cancelled"
                      : sale.exchangeOfReceiptNo
                        ? "Exchange bill"
                        : "Completed"
                  }
                />
                {sale.exchangeOfReceiptNo && (
                  <BillField label="Original bill" value={sale.exchangeOfReceiptNo} />
                )}
                {sale.exchangedToReceiptNo && (
                  <BillField label="Exchanged to" value={sale.exchangedToReceiptNo} />
                )}
              </dl>
              <div className="overflow-hidden rounded-xl border border-border">
                <ReportTable
                  clientDataControls={false}
                  mobileCards={false}
                  className="[&_td]:py-2 [&_th]:py-2 [&_td]:text-xs"
                >
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Quantity</TableHead>
                      <TableHead className="text-right">Unit price</TableHead>
                      <TableHead className="text-right">Line discount</TableHead>
                      <TableHead className="text-right">Net before tax</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sale.lines.map((line, index) => (
                      <TableRow key={line.productId + "-" + index}>
                        <TableCell className="font-medium">{line.name}</TableCell>
                        <TableCell>{line.qty}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(line.price)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(lineDiscountTotal(line))}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(lineRevenue(line))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </ReportTable>
              </div>
              <dl className="grid grid-cols-2 gap-3 rounded-xl border border-border p-4 text-sm sm:grid-cols-3">
                <BillField label="Subtotal" value={money(sale.subtotal)} />
                <BillField label="Discount" value={money(sale.discount)} />
                <BillField label="Tax" value={money(sale.tax)} />
                {!!sale.roundingAdjustment && (
                  <BillField label="Rounding" value={money(sale.roundingAdjustment)} />
                )}
                {!!sale.exchangeCredit && (
                  <BillField label="Exchange credit" value={money(sale.exchangeCredit)} />
                )}
                <BillField label="Total" value={money(sale.total)} />
                <BillField label="Paid" value={money(sale.paid)} />
                <BillField label="Change" value={money(sale.change)} />
              </dl>
              <div className="rounded-xl bg-muted/40 p-4 text-sm">
                <p className="mb-1 font-medium">Payments</p>
                <p className="break-words leading-6">
                  {sale.payments?.length ? paymentsLabel(sale.payments) : methodLabel(sale.method)}
                </p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
function BillField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words font-medium tabular-nums">{value}</dd>
    </div>
  );
}
