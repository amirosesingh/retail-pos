import { ReportTable as Table } from "@/platforms/web/components/pos/report-kit";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemedSelect } from "@/platforms/web/components/pos/ThemedSelect";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TablePagination, usePagination } from "@/platforms/web/components/pos/TablePagination";
import { useAuditLogs, type AuditLog } from "@/lib/audit-log";
import { describeLog } from "@/lib/audit-format";
import { money, usePos } from "@/lib/pos-store";
import {
  ReportHeader,
  StatCard,
  defaultRange,
  downloadReport,
  inRange,
  stamp,
} from "@/platforms/web/components/pos/report-kit";

export const Route = createFileRoute("/reports/voids")({
  head: () => ({
    meta: [
      { title: "Void & Refund History — Retail" },
      {
        name: "description",
        content:
          "Who voided carts, deleted lines, cancelled bills and issued refunds, with the value involved, the reason given and the approving supervisor.",
      },
      { property: "og:title", content: "Void & Refund History — Retail" },
      {
        property: "og:description",
        content: "Full void, cancellation and refund trail per cashier.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: VoidsReport,
});

/** Actions that remove value from a ticket or a completed bill. */
const VOID_ACTIONS: Record<string, "void" | "refund" | "line" | "cancel"> = {
  "Cart voided": "void",
  "Ticket cleared": "void",
  "Held ticket discarded": "void",
  "Line removed": "line",
  "Line deleted": "line",
  "Quantity reduced": "line",
  "Bill refunded": "refund",
  "Sale refunded": "refund",
  "Bill cancelled": "cancel",
  "Sale cancelled": "cancel",
};

const KIND_LABEL = {
  void: "Cart void",
  refund: "Refund",
  line: "Line removal",
  cancel: "Bill cancelled",
} as const;

const valueOf = (l: AuditLog) => {
  const d = l.details ?? {};
  for (const k of ["total", "amount", "value", "refundTotal", "lineTotal"]) {
    const n = Number(d[k]);
    if (Number.isFinite(n) && n) return Math.abs(n);
  }
  return 0;
};

const reasonOf = (l: AuditLog) => {
  const d = l.details ?? {};
  return String(d["reason"] ?? d["note"] ?? d["comment"] ?? "") || "—";
};

const approverOf = (l: AuditLog) => {
  const d = l.details ?? {};
  return String(d["approvedBy"] ?? d["supervisor"] ?? d["overrideBy"] ?? "") || "—";
};

function VoidsReport() {
  const logs = useAuditLogs();
  const { stores } = usePos();
  const init = defaultRange(30);
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const [kind, setKind] = useState("all");
  const [staff, setStaff] = useState("all");
  const [q, setQ] = useState("");

  const events = useMemo(
    () =>
      logs
        .filter((l) => VOID_ACTIONS[l.action])
        .map((l) => ({ log: l, kind: VOID_ACTIONS[l.action]!, value: valueOf(l) })),
    [logs],
  );

  const staffNames = useMemo(
    () => [...new Set(events.map((e) => e.log.staffName).filter(Boolean))].sort(),
    [events],
  );

  const rows = useMemo(
    () =>
      events
        .filter((e) => inRange(e.log.at, from, to))
        .filter((e) => kind === "all" || e.kind === kind)
        .filter((e) => staff === "all" || e.log.staffName === staff)
        .filter((e) => {
          const needle = q.trim().toLowerCase();
          if (!needle) return true;
          return (
            describeLog(e.log).toLowerCase().includes(needle) ||
            e.log.action.toLowerCase().includes(needle) ||
            reasonOf(e.log).toLowerCase().includes(needle)
          );
        })
        .sort((a, b) => b.log.at.localeCompare(a.log.at)),
    [events, from, to, kind, staff, q],
  );

  /** Per-person tally so an outlier stands out immediately. */
  const perStaff = useMemo(() => {
    const map = new Map<
      string,
      { voids: number; refunds: number; lines: number; cancels: number; value: number }
    >();
    for (const e of rows) {
      const key = e.log.staffName || e.log.staffId || "Unknown";
      const cur = map.get(key) ?? { voids: 0, refunds: 0, lines: 0, cancels: 0, value: 0 };
      if (e.kind === "void") cur.voids += 1;
      else if (e.kind === "refund") cur.refunds += 1;
      else if (e.kind === "line") cur.lines += 1;
      else cur.cancels += 1;
      cur.value += e.value;
      map.set(key, cur);
    }
    return [...map.entries()].sort(
      (a, b) => b[1].voids + b[1].refunds - (a[1].voids + a[1].refunds),
    );
  }, [rows]);

  const pager = usePagination(rows);
  const totalValue = rows.reduce((a, e) => a + e.value, 0);
  const refunds = rows.filter((e) => e.kind === "refund").length;
  const voids = rows.filter((e) => e.kind === "void").length;
  const storeName = (id: string | null) => (id && stores.find((s) => s.id === id)?.code) || "—";

  return (
    <AppShell>
      <div className="pos-page-container">
        <ReportHeader
          title="Void & Refund History"
          subtitle="Every void, line removal, cancellation and refund — who did it, when, why and for how much."
          from={from}
          to={to}
          onFrom={setFrom}
          onTo={setTo}
          onExport={() =>
            downloadReport("void-refund-history", [
              [
                "Time",
                "Type",
                "Staff",
                "Role",
                "Store",
                "Value",
                "Reason",
                "Approved by",
                "Detail",
              ],
              ...rows.map((e) => [
                stamp(e.log.at),
                KIND_LABEL[e.kind],
                e.log.staffName,
                e.log.role,
                storeName(e.log.storeId),
                e.value ? e.value.toFixed(2) : "",
                reasonOf(e.log),
                approverOf(e.log),
                describeLog(e.log),
              ]),
            ])
          }
        >
          <div className="space-y-1">
            <Label className="text-sm">Type</Label>
            <ThemedSelect
              value={kind}
              onChange={setKind}
              ariaLabel="Filter by event type"
              className="w-44"
              options={[
                { value: "all", label: "All events" },
                { value: "void", label: "Cart voids" },
                { value: "line", label: "Line removals" },
                { value: "refund", label: "Refunds" },
                { value: "cancel", label: "Bill cancellations" },
              ]}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-sm">Staff</Label>
            <ThemedSelect
              value={staff}
              onChange={setStaff}
              ariaLabel="Filter by staff member"
              className="w-44"
              options={[
                { value: "all", label: "Everyone" },
                ...staffNames.map((n) => ({ value: n, label: n })),
              ]}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-sm">Search</Label>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="reason, bill, action…"
              className="h-9 w-56"
            />
          </div>
        </ReportHeader>

        <div className="summary-grid grid gap-4 sm:grid-cols-4">
          <StatCard label="Events" value={String(rows.length)} />
          <StatCard label="Cart voids" value={String(voids)} />
          <StatCard label="Refunds" value={String(refunds)} />
          <StatCard label="Value removed" value={money(totalValue)} />
        </div>

        <div className="rounded-2xl border border-border bg-card">
          <div className="border-b border-border px-4 py-2 text-sm font-medium">Per person</div>
          <Table tableId="routes/reports.voids#1">
            <TableHeader>
              <TableRow>
                <TableHead>Staff</TableHead>
                <TableHead className="text-right">Voids</TableHead>
                <TableHead className="text-right">Line removals</TableHead>
                <TableHead className="text-right">Refunds</TableHead>
                <TableHead className="text-right">Cancellations</TableHead>
                <TableHead className="text-right">Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {perStaff.map(([name, v]) => (
                <TableRow key={name}>
                  <TableCell className="font-medium">{name}</TableCell>
                  <TableCell className="numeric text-right">{v.voids}</TableCell>
                  <TableCell className="numeric text-right">{v.lines}</TableCell>
                  <TableCell className="numeric text-right">{v.refunds}</TableCell>
                  <TableCell className="numeric text-right">{v.cancels}</TableCell>
                  <TableCell className="numeric text-right">{money(v.value)}</TableCell>
                </TableRow>
              ))}
              {!perStaff.length && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    No voids or refunds in this window.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="rounded-2xl border border-border bg-card">
          <Table tableId="routes/reports.voids#2">
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Staff</TableHead>
                <TableHead>Store</TableHead>
                <TableHead>What happened</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="text-right">Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pager.pageItems.map((e) => (
                <TableRow key={e.log.id}>
                  <TableCell className="numeric whitespace-nowrap text-sm">
                    {stamp(e.log.at)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {KIND_LABEL[e.kind]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {e.log.staffName}
                    <span className="block text-xs text-muted-foreground">{e.log.role}</span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {storeName(e.log.storeId)}
                  </TableCell>
                  <TableCell className="max-w-[26rem] text-sm">{describeLog(e.log)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {reasonOf(e.log)}
                    {approverOf(e.log) !== "—" && (
                      <span className="block text-xs">approved by {approverOf(e.log)}</span>
                    )}
                  </TableCell>
                  <TableCell className="numeric text-right">
                    {e.value ? money(e.value) : "—"}
                  </TableCell>
                </TableRow>
              ))}
              {!rows.length && (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    Nothing matches these filters.
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
