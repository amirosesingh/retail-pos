/**
 * Read-only look at one receiving entry. Anyone who can open Purchasing may
 * read a record; changing a posted one is a separate, gated action.
 */
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { money } from "@/lib/pos-store";
import type { ReceivingInvoice } from "@/core/api/pos-db";

export function ReceivingRecordView({
  record,
  onClose,
}: {
  record: ReceivingInvoice | null;
  onClose: () => void;
}) {
  const units = record?.lines.reduce((a, l) => a + l.qty, 0) ?? 0;

  return (
    <Dialog open={!!record} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="numeric">{record?.reference ?? "Receiving entry"}</DialogTitle>
          <DialogDescription>
            {record
              ? `${record.status === "posted" ? "Received" : record.status === "draft" ? "Draft" : "Discarded"} · ${record.lines.length} items · ${units} units · ${money(record.totalCost)}`
              : ""}
          </DialogDescription>
        </DialogHeader>

        {record && (
          <div className="space-y-4">
            <dl className="grid gap-3 text-sm sm:grid-cols-4">
              <Meta label="Supplier invoice no." value={record.invoiceNo || "—"} />
              <Meta label="Supplier" value={record.supplier || "—"} />
              <Meta label="Invoice date" value={record.invoiceDate ?? "—"} />
              <Meta label="Entered" value={new Date(record.entryDate).toLocaleString()} />
              <Meta label="Operator" value={record.operator || "—"} />
              <Meta label="Branch" value={record.storeCode ?? "—"} />
            </dl>

            <Table managed summaryFormats={{ Amount: money, "Net impact": money, "Estimated cost": money }}>
              <TableHeader>
                <TableRow>
                  <TableHead>Item number / SKU</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="w-28 text-right">Cost</TableHead>
                  <TableHead className="w-28 text-right">Selling</TableHead>
                  <TableHead className="w-24 text-right">Qty</TableHead>
                  <TableHead className="text-right">Subtotal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {record.lines.map((l) => (
                  <TableRow key={l.id} summaryValues={{ Units: l.qty, Amount: l.qty * l.cost }}>
                    <TableCell className="numeric">{l.sku || l.barcode || "—"}</TableCell>
                    <TableCell>{l.name}</TableCell>
                    <TableCell className="numeric text-right">{money(l.cost)}</TableCell>
                    <TableCell className="numeric text-right">{money(l.price)}</TableCell>
                    <TableCell className="numeric text-right">{l.qty}</TableCell>
                    <TableCell className="numeric text-right">{money(l.cost * l.qty)}</TableCell>
                  </TableRow>
                ))}
                {!record.lines.length && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      Nothing was added to this entry.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
