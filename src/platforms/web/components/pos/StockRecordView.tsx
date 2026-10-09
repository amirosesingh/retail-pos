/**
 * Read-only view of one stock count record: who counted it, when, and every
 * line with its variance. Always available, whatever the record's status.
 */
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { money } from "@/lib/pos-store";
import { parseLines, ReviewTable, type StockRecordRow } from "@/platforms/web/components/pos/StockCountDialog";

export function StockRecordView({
  record,
  onOpenChange,
}: {
  record: StockRecordRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const lines = parseLines(record?.lines);
  return (
    <Dialog open={!!record} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[min(96vw,90rem)] max-w-none overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-mono">{record?.reference || "No reference"}</span>
            <Badge variant="outline" className="capitalize">
              {record?.status ?? "—"}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            {record?.store_code || record?.store_id || "—"} ·{" "}
            {record?.created_at ? new Date(record.created_at).toLocaleString() : "—"} · counted by{" "}
            {record?.staff_name || "—"}
            {record?.posted_by ? ` · posted by ${record.posted_by}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Reason" value={record?.reason || "—"} />
          <Field label="Items" value={String(record?.line_count ?? lines.length)} />
          <Field label="Net impact" value={money(Number(record?.total_impact ?? 0))} />
        </div>
        {record?.note ? (
          <p className="rounded-lg border border-border bg-surface-2 p-3 text-sm">{record.note}</p>
        ) : null}

        <ReviewTable rows={lines} />
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}
