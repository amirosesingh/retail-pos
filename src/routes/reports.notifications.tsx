import { formatDateTime as posDisplayDateTime } from "@/lib/time-zone";
import {
  ReportTable as Table,
  downloadReport,
  ReportFilters,
} from "@/platforms/web/components/pos/report-kit";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Download, LoaderCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { Button } from "@/components/ui/button";
import { useAnimatedItems } from "@/components/ui/animated-list";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemedSelect } from "@/platforms/web/components/pos/ThemedSelect";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TablePagination, usePagination } from "@/platforms/web/components/pos/TablePagination";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/pos-auth";
import { usePos } from "@/lib/pos-store";
import { humanizeText } from "@/lib/human-readable";
import {
  EVENT_CATALOG,
  EVENT_LABELS,
  SEVERITY_TONE,
  clearActivityEntry,
  activityAcknowledgedBy,
  isActivityLogMissing,
  listActivityEvents,
  markActivitySeen,
  mergeRemoteActivityPreferences,
  toCsv,
  type ActivityEvent,
  type EventSeverity,
} from "@/lib/activity-events";

const TYPE_OPTIONS = [
  { value: "all", label: "All events" },
  ...EVENT_CATALOG.flatMap((g) => g.types.map((t) => ({ value: t.type, label: t.label }))),
];

const SEVERITY_OPTIONS = [
  { value: "all", label: "Any importance" },
  { value: "critical", label: "Critical" },
  { value: "warning", label: "Warning" },
  { value: "info", label: "Information" },
];

const STATUS_OPTIONS = [
  { value: "all", label: "Active and history" },
  { value: "active", label: "Active notifications" },
  { value: "history", label: "Cleared by me" },
];

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : posDisplayDateTime(d);
};

function NotificationsReport() {
  const { can, user } = useAuth();
  const mayViewAudit = can("can_view_audit_trail");
  const { stores, state } = usePos();
  const refs = useMemo(
    () => ({ stores, products: state.products, members: state.members, sales: state.sales }),
    [stores, state.products, state.members, state.sales],
  );
  const [rows, setRows] = useState<ActivityEvent[]>([]);
  const [type, setType] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [status, setStatus] = useState("all");
  const [actor, setActor] = useState("");
  const [busy, setBusy] = useState(false);
  const [preferenceBusy, setPreferenceBusy] = useState("");
  const [missing, setMissing] = useState(false);
  const meKey = user?.staffId ?? user?.name ?? "";

  const load = useCallback(async () => {
    setBusy(true);
    const list = await listActivityEvents({
      limit: 500,
      types: type === "all" ? undefined : [type],
      severities: severity === "all" ? undefined : [severity as EventSeverity],
    });
    setRows(list);
    mergeRemoteActivityPreferences(meKey, list);
    setMissing(isActivityLogMissing());
    markActivitySeen(list[0]?.createdAt ?? new Date().toISOString(), meKey);
    setBusy(false);
  }, [type, severity, meKey]);

  useEffect(() => {
    if (mayViewAudit) void load();
  }, [mayViewAudit, load]);

  const filtered = useMemo(() => {
    const needle = actor.trim().toLowerCase();
    return rows.filter((row) => {
      const inHistory = activityAcknowledgedBy(row,meKey);
      if (status === "active" && inHistory) return false;
      if (status === "history" && !inHistory) return false;
      if (!needle) return true;
      return (
        row.actorName.toLowerCase().includes(needle) ||
        row.title.toLowerCase().includes(needle) ||
        row.message.toLowerCase().includes(needle)
      );
    });
  }, [rows, actor, status, meKey]);

  const updatePreference = async (row: ActivityEvent) => {
    const inHistory = activityAcknowledgedBy(row,meKey);
    if (inHistory) return;
    setPreferenceBusy(row.id);
    const saved = await clearActivityEntry(meKey, row.id);
    if (!saved)
      toast.error("Could not update notification history. Check the connection and try again.");
    else await load();
    setPreferenceBusy("");
  };

  const page = usePagination(filtered);
  const visible = page.pageItems;
  const eventKey = useCallback((row: ActivityEvent) => row.id, []);
  const animated = useAnimatedItems(visible, eventKey);

  const exportCsv = () => {
    const url = URL.createObjectURL(
      new Blob([toCsv(filtered)], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `activity-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!mayViewAudit) {
    return (
      <AppShell>
        <p className="p-6 text-sm text-muted-foreground">
          Your account needs audit trail permission to view the activity log.
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="pos-page-container">
        {missing && (
          <p className="rounded-md border border-border bg-surface-2 p-3 text-sm text-muted-foreground">
            The activity log needs a database update. Follow the existing-database upgrade
            instructions in <span className="font-medium">docs/database-upgrade.md</span>.
          </p>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <div className="mr-auto">
            <h1 className="text-2xl font-semibold tracking-tight">Activity & notifications</h1>
            <p className="text-sm text-muted-foreground page-description">
              Every recorded sign-in, shift, sale, drawer open and staff change, with WhatsApp
              delivery status.
            </p>
          </div>
          <ReportFilters title="Activity & notifications filters">
            <div className="space-y-1">
              <Label className="text-xs">Event</Label>
              <ThemedSelect
                className="h-9 w-56"
                value={type}
                onChange={setType}
                options={TYPE_OPTIONS}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Importance</Label>
              <ThemedSelect
                className="h-9 w-40"
                value={severity}
                onChange={setSeverity}
                options={SEVERITY_OPTIONS}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <ThemedSelect
                className="h-9 w-44"
                value={status}
                onChange={setStatus}
                options={STATUS_OPTIONS}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Search</Label>
              <Input
                className="h-9 w-52"
                placeholder="Person or text"
                value={actor}
                onChange={(e) => setActor(e.target.value)}
              />
            </div>
          </ReportFilters>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={busy}>
            <RefreshCw className={cn("size-4", busy && "animate-spin")} /> Refresh
          </Button>
          {can("can_export_reports") && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadReport("activity-notifications", [
                  [
                    "Date & time",
                    "Event",
                    "Importance",
                    "Title",
                    "Message",
                    "Person",
                    "Terminal",
                    "Branch",
                    "Delivery",
                    "Status",
                  ],
                  ...filtered.map((row) => [
                    when(row.createdAt),
                    EVENT_LABELS[row.type] ?? row.type,
                    row.severity,
                    humanizeText(row.title, refs),
                    humanizeText(row.message ?? "", refs),
                    row.actorName || "System",
                    row.terminalName || "",
                    stores.find((store) => store.id === row.storeId)?.name ?? row.storeId,
                    row.whatsappStatus,
                    activityAcknowledgedBy(row,meKey) ? "Cleared by me" : "Active",
                  ]),
                ])
              }
            >
              <Download className="size-4" /> Export Excel
            </Button>
          )}
          {can("can_export_reports") && (
            <Button variant="secondary" size="sm" onClick={exportCsv}>
              <Download className="size-4" /> Export CSV
            </Button>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card">
          <Table tableId="routes/reports.notifications#1">
            <TableHeader>
              <TableRow>
                <TableHead className="w-44">When</TableHead>
                <TableHead className="w-40">Event</TableHead>
                <TableHead>What happened</TableHead>
                <TableHead className="w-40">Person</TableHead>
                <TableHead className="w-32">Terminal</TableHead>
                <TableHead className="w-24">Branch</TableHead>
                <TableHead className="w-28">WhatsApp</TableHead>
                <TableHead className="w-20">Status</TableHead>
                <TableHead className="w-20 text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {animated.rendered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                    No events match these filters.
                  </TableCell>
                </TableRow>
              ) : (
                animated.rendered.map(({ key, item: r, phase }) => (
                  <TableRow
                    key={key}
                    className="ui-animated-table-row"
                    data-state={phase}
                    onAnimationEnd={(event) => {
                      if (event.target === event.currentTarget) animated.settle(key, phase);
                    }}
                  >
                    <TableCell className="text-sm">{when(r.createdAt)}</TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "rounded border px-1.5 py-0.5 text-xs",
                          SEVERITY_TONE[r.severity],
                        )}
                      >
                        {EVENT_LABELS[r.type] ?? r.type}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">
                      <p className="font-medium">{humanizeText(r.title, refs)}</p>
                      {r.message && (
                        <p className="text-muted-foreground">{humanizeText(r.message, refs)}</p>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {r.actorName || "—"}
                      {r.actorRole && (
                        <span className="block text-xs capitalize text-muted-foreground">
                          {r.actorRole}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{r.terminalName || "—"}</TableCell>
                    <TableCell className="text-sm">
                      {stores.find((store) => store.id === r.storeId)?.name ?? "Unknown branch"}
                    </TableCell>
                    <TableCell className="text-sm capitalize">{r.whatsappStatus}</TableCell>
                    <TableCell className="text-sm">
                      {activityAcknowledgedBy(r,meKey) ? "Cleared by me" : "Active"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="min-h-11 px-2 text-xs"
                        disabled={preferenceBusy === r.id || activityAcknowledgedBy(r,meKey)}
                        onClick={() => void updatePreference(r)}
                      >
                        {preferenceBusy === r.id ? (
                          <LoaderCircle className="size-3 animate-spin" />
                        ) : (
                          <Check className="size-3" />
                        )}
                        {preferenceBusy === r.id
                          ? "Saving…"
                          : activityAcknowledgedBy(r,meKey)
                            ? "Cleared"
                            : "Clear"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
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
          label="events"
          onPage={page.setPage}
          onPageSize={page.setPageSize}
        />
      </div>
    </AppShell>
  );
}

export const Route = createFileRoute("/reports/notifications")({
  head: () => ({
    meta: [
      { title: "Activity & Notifications Log — Retail" },
      {
        name: "description",
        content:
          "Searchable history of sign-ins, shift changes, sales, refunds, drawer opens and staff edits, with WhatsApp delivery status and CSV export.",
      },
      { property: "og:title", content: "Activity & Notifications Log — Retail" },
      {
        property: "og:description",
        content: "Every till event with who did it, where, and whether an alert went out.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: NotificationsReport,
});
