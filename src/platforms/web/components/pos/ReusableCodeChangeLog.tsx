import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { routedQuery } from "@/core/api/db-query";
import { auditDetails } from "@/lib/audit-row-normalization";
import { formatDateTime } from "@/lib/time-zone";
import { nextCursor, type Cursor } from "@/lib/keyset";

type AuditRow = Record<string, unknown>;
const LIMIT = 100;
async function read(cursor: Cursor) {
  return routedQuery("audit_logs", {
    columns: "id,created_at,user_name,action_name,details",
    match: { target_module: "promotions" },
    orderBy: { column: "created_at", ascending: false },
    ...(cursor ? { cursor: { column: "created_at", value: cursor.ts, id: cursor.id } } : {}),
    limit: LIMIT,
  });
}
export function ReusableCodeChangeLog({ codeIds }: { codeIds: string[] }) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [cursor, setCursor] = useState<Cursor>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setBusy(true);
    void read(null)
      .then((page) => {
        if (!live) return;
        setRows(page);
        setCursor(nextCursor(page, "created_at", LIMIT));
        setMore(page.length === LIMIT);
      })
      .catch((e) => {
        if (live) setError(e instanceof Error ? e.message : "Could not read code changes");
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, []);
  async function loadMore() {
    if (busy || !cursor) return;
    setBusy(true);
    try {
      const page = await read(cursor);
      setRows((previous) => [
        ...new Map([...previous, ...page].map((row) => [String(row.id), row])).values(),
      ]);
      setCursor(nextCursor(page, "created_at", LIMIT));
      setMore(page.length === LIMIT);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read code changes");
    } finally {
      setBusy(false);
    }
  }
  const visible = rows.filter((row) => {
    const detail = auditDetails(row.details);
    return detail.promotionType === "code" || codeIds.includes(String(detail.promotionId));
  });
  return (
    <section className="space-y-2 py-3">
      <h3 className="text-sm font-medium">Reusable-code changes</h3>
      <p className="text-xs text-muted-foreground">
        Creation, editing and deletion from the permission-protected activity journal. Offline
        changes appear centrally after synchronization.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            {["When", "Code", "Action", "Staff"].map((title) => (
              <TableHead key={title}>{title}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((row) => (
            <TableRow key={String(row.id)}>
              <TableCell>{formatDateTime(new Date(String(row.created_at)))}</TableCell>
              <TableCell>{String(auditDetails(row.details).name ?? "—")}</TableCell>
              <TableCell>{String(row.action_name ?? "")}</TableCell>
              <TableCell>{String(row.user_name ?? "")}</TableCell>
            </TableRow>
          ))}
          {!visible.length && (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground">
                {busy ? "Loading…" : "No code changes in the loaded activity."}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {more && (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void loadMore()}>
          Load older changes
        </Button>
      )}
    </section>
  );
}
