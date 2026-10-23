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

export const Route = createFileRoute("/reports/catalog")({
  head: () => ({
    meta: [
      { title: "Catalog Change History — Retail" },
      {
        name: "description",
        content:
          "Audit of every product added, renamed, repriced or restocked, with the staff member responsible and the exact time.",
      },
      { property: "og:title", content: "Catalog Change History — Retail" },
      { property: "og:description", content: "Product and stock edit history with timestamps." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CatalogReport,
});

function CatalogReport() {
  const logs = useAuditLogs();
  const init = defaultRange(90);
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [q, setQ] = useState("");

  const rows = useMemo(
    () =>
      logs
        .filter((l) => l.category === "inventory" && inRange(l.at, from, to))
        .filter((l) => {
          const needle = q.trim().toLowerCase();
          return (
            !needle ||
            l.action.toLowerCase().includes(needle) ||
            JSON.stringify(l.details).toLowerCase().includes(needle)
          );
        }),
    [logs, from, to, q],
  );

  const created = rows.filter((l) => /added|created|import/i.test(l.action)).length;
  const priced = rows.filter((l) => /price/i.test(l.action)).length;
  const stocked = rows.filter((l) => /stock|received/i.test(l.action)).length;
  const pager = usePagination(rows);

  return (
    <AppShell>
      <div className="pos-page-container">
        <ReportHeader
          title="Catalog Change History"
          subtitle="Product creations, price changes and stock movements with who and when."
          from={from}
          to={to}
          onFrom={setFrom}
          onTo={setTo}
          onExport={() =>
            downloadReport("catalog-changes", [
              ["Time", "Staff", "Action", "Description", "Details"],
              ...rows.map((l) => [
                stamp(l.at),
                l.staffName,
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
              placeholder="product, sku, price…"
              className="h-9 w-64"
            />
          </div>
        </ReportHeader>

        <div className="summary-grid grid gap-4 sm:grid-cols-4">
          <StatCard label="Changes" value={String(rows.length)} />
          <StatCard label="Products added" value={String(created)} />
          <StatCard label="Price edits" value={String(priced)} />
          <StatCard label="Stock movements" value={String(stocked)} />
        </div>

        <div className="rounded-2xl border border-border bg-card">
          <Table tableId="routes/reports.catalog#1">
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Staff</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>What changed</TableHead>
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
                    No catalog changes recorded in this window.
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
            label="changes"
            onPage={pager.setPage}
            onPageSize={pager.setPageSize}
          />
        </div>
      </div>
    </AppShell>
  );
}
