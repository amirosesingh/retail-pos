import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { routedQuery } from "@/core/api/db-query";
import { nextCursor, type Cursor } from "@/lib/keyset";
import { approvalHistorySummary } from "@/lib/approval-history";
import { formatDateTime } from "@/lib/time-zone";
const SIZE = 25;
type Row = Record<string, unknown>;
export function ApprovalHistoryDialog({
  open,
  onOpenChange,
  storeId,
  allBranches,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
  allBranches: boolean;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [cursor, setCursor] = useState<Cursor>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  async function read(position: Cursor) {
    if (!allBranches && !storeId) throw new Error("Select a branch to view approval history.");
    return routedQuery("authorization_log", {
      columns:
        "id,action_key,mode_used,authorized_by,authorizer_role,store_id,terminal_id,outcome,detail,created_at",
      match: { outcome: "approved", ...(!allBranches ? { store_id: storeId } : {}) },
      orderBy: { column: "created_at", ascending: false },
      limit: SIZE,
      ...(position
        ? { cursor: { column: "created_at", value: position.ts, id: position.id } }
        : {}),
    });
  }
  useEffect(() => {
    if (!open) return;
    let live = true;
    setBusy(true);
    setError("");
    setRows([]);
    setMore(false);
    setCursor(null);
    void read(null)
      .then((page) => {
        if (!live) return;
        setRows(page);
        setCursor(nextCursor(page, "created_at", SIZE));
        setMore(page.length === SIZE);
      })
      .catch((e) => {
        if (live) setError(e instanceof Error ? e.message : "Could not load approval history");
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
    // read is intentionally captured for this exact branch/open revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, storeId, allBranches, revision]);
  async function older() {
    if (busy || !cursor) return;
    setBusy(true);
    try {
      const page = await read(cursor);
      setRows((previous) => [
        ...new Map([...previous, ...page].map((row) => [String(row.id), row])).values(),
      ]);
      setCursor(nextCursor(page, "created_at", SIZE));
      setMore(page.length === SIZE);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load older approvals");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Approval history</DialogTitle>
        </DialogHeader>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Completed PIN, soft-token and request approvals. Offline Windows records sync when
            connected.
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => setRevision((x) => x + 1)}
          >
            Refresh
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              {["When / ticket", "Approval", "Action / branch"].map((title) => (
                <TableHead key={title}>{title}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const summary = approvalHistorySummary(row);
              return (
                <TableRow key={String(row.id)}>
                  <TableCell>
                    {formatDateTime(new Date(String(row.created_at)))}
                    <div className="text-xs text-muted-foreground">{summary.reference}</div>
                  </TableCell>
                  <TableCell>
                    {summary.label}
                    {summary.offline && (
                      <Badge variant="outline" className="ml-2">
                        Offline
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {String(row.action_key).replaceAll("_", " ")}
                    <div className="text-xs text-muted-foreground">
                      {String(row.store_id ?? "")}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {!rows.length && (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground">
                  {busy ? "Loading…" : "No completed approvals in this scope."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        {more && (
          <Button variant="outline" disabled={busy} onClick={() => void older()}>
            Load older approvals
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
