import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Download, LoaderCircle, RefreshCw, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { Button } from "@/components/ui/button";
import { useAnimatedItems } from "@/components/ui/animated-list";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemedSelect } from "@/platforms/web/components/pos/ThemedSelect";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  { value: "history", label: "Cleared history" },
];

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
};

function NotificationsReport() {
  const { can, isSupervisor, user } = useAuth();
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
    if (isSupervisor) void load();
  }, [isSupervisor, load]);

  const filtered = useMemo(() => {
    const needle = actor.trim().toLowerCase();
    return rows.filter((row) => {
      const inHistory = row.clearedBy.length > 0;
      if (status === "active" && inHistory) return false;
      if (status === "history" && !inHistory) return false;
      if (!needle) return true;
      return (
        row.actorName.toLowerCase().includes(needle) ||
        row.title.toLowerCase().includes(needle) ||
        row.message.toLowerCase().includes(needle)
      );
    });
  }, [rows, actor, status]);

  const updatePreference = async (row: ActivityEvent) => {
    const inHistory = row.clearedBy.length > 0;
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

  if (!isSupervisor) {
    return (
      <AppShell>
        <p className="p-6 text-sm text-muted-foreground">
          The activity log is available to supervisors and admins.
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-4 p-4">
        {missing && (
          <p className="rounded-md border border-border bg-surface-2 p-3 text-xs text-muted-foreground">
            The activity log needs a database update. Follow the existing-database upgrade
            instructions in <span className="font-medium">docs/database-upgrade.md</span>.
          </p>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <div className="mr-auto">
            <h1 className="text-lg font-semibold">Activity & notifications</h1>
            <p className="text-xs text-muted-foreground">
              Every recorded sign-in, shift, sale, drawer open and staff change, with WhatsApp
              delivery status.
            </p>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Event</Label>
            <ThemedSelect
              className="h-9 w-56"
              value={type}
              onChange={setType}
              options={TYPE_OPTIONS}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Importance</Label>
            <ThemedSelect
              className="h-9 w-40"
              value={severity}
              onChange={setSeverity}
              options={SEVERITY_OPTIONS}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Status</Label>
            <ThemedSelect
              className="h-9 w-44"
              value={status}
              onChange={setStatus}
              options={STATUS_OPTIONS}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Search</Label>
            <Input
              className="h-9 w-52"
              placeholder="Person or text"
              value={actor}
              onChange={(e) => setActor(e.target.value)}
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={busy}>
            <RefreshCw className={cn("size-4", busy && "animate-spin")} /> Refresh
          </Button>
          {can("can_export_reports") && (
            <Button variant="secondary" size="sm" onClick={exportCsv}>
              <Download className="size-4" /> Export CSV
            </Button>
          )}
        </div>

        <div className="rounded-lg border border-border">
          <Table>
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
                  <TableCell colSpan={9} className="py-8 text-center text-xs text-muted-foreground">
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
                    <TableCell className="text-xs">{when(r.createdAt)}</TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "rounded border px-1.5 py-0.5 text-[10px]",
                          SEVERITY_TONE[r.severity],
                        )}
                      >
                        {EVENT_LABELS[r.type] ?? r.type}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs">
                      <p className="font-medium">{humanizeText(r.title, refs)}</p>
                      {r.message && (
                        <p className="text-muted-foreground">{humanizeText(r.message, refs)}</p>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.actorName || "—"}
                      {r.actorRole && (
                        <span className="block text-[10px] capitalize text-muted-foreground">
                          {r.actorRole}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{r.terminalName || "—"}</TableCell>
                    <TableCell className="text-xs">
                      {stores.find((store) => store.id === r.storeId)?.name ?? "Unknown branch"}
                    </TableCell>
                    <TableCell className="text-xs capitalize">{r.whatsappStatus}</TableCell>
                    <TableCell className="text-xs">
                      {r.clearedBy.length > 0
                        ? "History"
                        : "Active"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-[10px]"
                        disabled={preferenceBusy === r.id || r.clearedBy.length > 0}
                        onClick={() => void updatePreference(r)}
                      >
                        {preferenceBusy === r.id ? (
                          <LoaderCircle className="size-3 animate-spin" />
                        ) : r.clearedBy.length > 0 ? (
                          <RotateCcw className="size-3" />
                        ) : (
                          <Check className="size-3" />
                        )}
                        {preferenceBusy === r.id
                          ? "Saving…"
                          : r.clearedBy.length > 0
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
