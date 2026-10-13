import { ReportTable as Table } from "@/platforms/web/components/pos/report-kit";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TablePagination, usePagination } from "@/platforms/web/components/pos/TablePagination";
import { useAuditLogs } from "@/lib/audit-log";
import { describeLog } from "@/lib/audit-format";
import {
  ReportHeader,
  StatCard,
  defaultRange,
  downloadReport,
  inRange,
  stamp,
} from "@/platforms/web/components/pos/report-kit";

export const Route = createFileRoute("/reports/activity")({
  head: () => ({
    meta: [
      { title: "Register Activity Report — Retail" },
      {
        name: "description",
        content:
          "Timeline of till operations: orders held and resumed, carts voided, bills split, refunds and drawer opens with timestamps.",
      },
      { property: "og:title", content: "Register Activity Report — Retail" },
      { property: "og:description", content: "Terminal operation timeline with full timestamps." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ActivityReport,
});

const REGISTER = new Set(["sale", "payment", "refund", "drawer", "discount"]);

function ActivityReport() {
  const logs = useAuditLogs();
  const init = defaultRange(7);
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [q, setQ] = useState("");

  const rows = useMemo(
    () =>
      logs
        .filter((l) => REGISTER.has(l.category) && inRange(l.at, from, to))
        .filter((l) => {
          const needle = q.trim().toLowerCase();
          return (
            !needle ||
            l.action.toLowerCase().includes(needle) ||
            l.staffName.toLowerCase().includes(needle) ||
            JSON.stringify(l.details).toLowerCase().includes(needle)
          );
        }),
    [logs, from, to, q],
  );

  const count = (re: RegExp) => rows.filter((l) => re.test(l.action)).length;
  const pager = usePagination(rows);

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[1600px] space-y-6 p-4 sm:p-6">
        <ReportHeader
          title="Register Activity Trail"
          subtitle="Everything that happened on the till, in plain English, with timestamps."
          from={from}
          to={to}
          onFrom={setFrom}
          onTo={setTo}
          onExport={() =>
            downloadReport("register-activity", [
              ["Time", "Staff", "Role", "Action", "Description", "Details"],
              ...rows.map((l) => [
                stamp(l.at),
                l.staffName,
                l.role,
                l.action,
                describeLog(l),
                JSON.stringify(l.details),
              ]),
            ])
          }
        >
          <div className="space-y-1">
            <Label className="text-sm">Search</Label>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="hold, void, split, receipt no…"
              className="h-9 w-64"
            />
          </div>
        </ReportHeader>

        <div className="grid gap-4 sm:grid-cols-4">
          <StatCard label="Events" value={String(rows.length)} />
          <StatCard label="Orders held" value={String(count(/hold/i))} />
          <StatCard label="Carts voided" value={String(count(/void/i))} />
          <StatCard label="Bills split" value={String(count(/split/i))} />
        </div>

        <div className="rounded-2xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Staff</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>What happened</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pager.pageItems.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="numeric whitespace-nowrap text-sm">{stamp(l.at)}</TableCell>
                  <TableCell>
                    {l.staffName}
                    <Badge variant="outline" className="ml-2 text-xs capitalize">
                      {l.role}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium">{l.action}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{describeLog(l)}</TableCell>
                </TableRow>
              ))}
              {!rows.length && (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    No register activity in this window.
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
            label="events"
            onPage={pager.setPage}
            onPageSize={pager.setPageSize}
          />
        </div>
      </div>
    </AppShell>
  );
}
