import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TablePagination, usePagination } from "@/platforms/web/components/pos/TablePagination";
import {
  ReportHeader,
  defaultRange,
  downloadCsv,
  inRange,
  stamp,
} from "@/platforms/web/components/pos/report-kit";
import { adminAccessToken } from "@/lib/admin-session";
import { listSystemAudit } from "@/lib/system-audit-client";
import { auditReportFields } from "@/lib/audit-report-format";
import { useAuth } from "@/lib/pos-auth";

export const Route = createFileRoute("/reports/history")({
  head: () => ({
    meta: [
      { title: "Edit History & Audit Trail — Retail" },
      {
        name: "description",
        content:
          "Permanent record of price overrides, voids, discounts, shift edits, account changes and sign-in attempts with actor, terminal and timestamp.",
      },
      { property: "og:title", content: "Edit History & Audit Trail — Retail" },
      {
        property: "og:description",
        content: "History of recorded actions and unverified client reports.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: EditHistoryReport,
});

type Row = {
  id: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  action_type: string;
  entity_affected: string | null;
  entity_id: string | null;
  old_value: string | null;
  new_value: string | null;
  terminal_id: string | null;
  store_id: string | null;
  note: string | null;
  created_at: string;
};

function EditHistoryReport() {
  const { can } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const init = defaultRange(30);
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);

  const load = useCallback(async () => {
    setLoading(true);
    const accessToken = await adminAccessToken();
    if (!accessToken) {
      setError("Sign in with a supervisor or administrator account to view the edit history.");
      setRows([]);
      setLoading(false);
      return;
    }
    const res = await listSystemAudit({ data: { accessToken, limit: 500 } });
    setError(res.ok ? "" : (res.error ?? "Could not load the edit history"));
    setRows((res.rows ?? []) as Row[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const dated = rows.filter((r) => inRange(r.created_at, from, to));
    if (!needle) return dated;
    return dated.filter((r) => {
      const display = auditReportFields(r);
      return [
        r.actor_name,
        r.actor_id,
        r.actor_role,
        r.action_type,
        r.entity_affected,
        r.entity_id,
        r.note,
        r.old_value,
        r.new_value,
        display.requestedBy,
        display.approvedBy,
        display.purpose,
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [rows, q, from, to]);

  const page = usePagination(filtered);

  const exportCsv = () => {
    downloadCsv("edit-history", [
      ["When", "Requested by", "Approved / acted by", "Role", "Action", "Outcome", "Method", "Where", "Requested value", "Purpose", "Reference", "Before", "After", "Terminal"],
      ...filtered.map((r) => {
        const display = auditReportFields(r);
        return [
          stamp(r.created_at), display.requestedBy, display.approvedBy,
          r.actor_role ?? "", display.action, display.outcome, display.method, display.location,
          display.requestedAmount, display.purpose, display.reference, r.old_value ?? "",
          r.new_value ?? "", r.terminal_id ?? "",
        ];
      }),
    ]);
  };

  if (!can("can_view_audit_trail")) {
    return (
      <AppShell>
        <div className="p-6 text-sm text-destructive">Permission required to view audit history.</div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-4 p-4">
        <ReportHeader
          title="Edit History"
          subtitle="Permanent history of recorded actions and unverified client reports. Entries cannot be changed or removed."
          from={from}
          to={to}
          onFrom={setFrom}
          onTo={setTo}
          onExport={exportCsv}
        >
          <div className="grid gap-1">
            <Label htmlFor="history-search">Search</Label>
            <Input
              id="history-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Person, action or reference"
              className="w-64"
            />
          </div>
          <Button variant="outline" onClick={() => void load()} disabled={loading}>
            Refresh
          </Button>
        </ReportHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading the edit history…</p>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !filtered.length ? (
          <p className="text-sm text-muted-foreground">No recorded actions yet.</p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Requested by</TableHead>
                    <TableHead>Approved / acted by</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Where / reference</TableHead>
                    <TableHead>Purpose / details</TableHead>
                    <TableHead>Terminal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {page.pageItems.map((r) => {
                    const display = auditReportFields(r);
                    return <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap text-xs">
                        {stamp(r.created_at)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {display.requestedBy || "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        <div className="font-medium">{display.approvedBy}</div>
                        {r.actor_role ? (
                          <Badge variant="outline" className="mt-1">
                            {r.actor_role}
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-sm">
                        <div>{display.action}</div>
                        {display.outcome ? <Badge variant="outline" className="mt-1">{display.outcome}</Badge> : null}
                      </TableCell>
                      <TableCell className="text-xs">
                        {display.method}
                      </TableCell>
                      <TableCell className="text-xs">
                        <div>{display.location}</div>
                        <div className="text-muted-foreground">{display.reference}</div>
                        {display.requestedAmount ? (
                          <div className="text-muted-foreground">Value: {display.requestedAmount}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="max-w-[26rem] text-xs text-muted-foreground">
                        <div className="text-foreground">{display.purpose}</div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.terminal_id ? r.terminal_id.slice(0, 8) : "—"}
                      </TableCell>
                    </TableRow>;
                  })}
                </TableBody>
              </Table>
            </div>
            <TablePagination
              page={page.page}
              pageCount={page.pageCount}
              pageSize={page.pageSize}
              total={page.total}
              from={page.from}
              to={page.to}
              label="entries"
              onPage={page.setPage}
              onPageSize={page.setPageSize}
            />
          </>
        )}
      </div>
    </AppShell>
  );
}
