import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpDown, RefreshCw, Search } from "lucide-react";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TablePagination } from "@/platforms/web/components/pos/TablePagination";
import { ThemedSelect } from "@/platforms/web/components/pos/ThemedSelect";
import { useDebounced } from "@/hooks/use-debounced";
import { useAuth } from "@/lib/pos-auth";
import { usePos } from "@/lib/pos-store";
import { cn } from "@/lib/utils";
import { notifyError } from "@/lib/notify";
import { friendlyReference, humanizeText } from "@/lib/human-readable";
import {
  APP_RESUME_EVENT,
  CONNECTIVITY_RESTORED_EVENT,
  connectivity,
} from "@/core/activation/connection-health";
import {
  EVENT_CATALOG,
  EVENT_LABELS,
  SEVERITY_TONE,
  isActivityLogMissing,
  listActivityEventPage,
  markActivitySeen,
  type ActivityEvent,
  type EventSeverity,
} from "@/lib/activity-events";

const ALERT_TYPES = EVENT_CATALOG.flatMap((group) =>
  group.types.map((entry) => ({ value: entry.type, label: entry.label })),
);

const when = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
};

const dateBound = (value: string, end = false) =>
  value ? new Date(`${value}T${end ? "23:59:59.999" : "00:00:00"}`).toISOString() : undefined;

function AlertsHistory() {
  const { isSupervisor, user } = useAuth();
  const { stores, state } = usePos();
  const [rows, setRows] = useState<ActivityEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [query, setQuery] = useState("");
  const settledQuery = useDebounced(query, 250);
  const [type, setType] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [storeId, setStoreId] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sort, setSort] = useState("created_at.desc");
  const [selected, setSelected] = useState<ActivityEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(false);
  const requestSequence = useRef(0);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => setPage(1), [settledQuery, type, severity, storeId, from, to, sort, pageSize]);

  const load = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setBusy(true);
    try {
      const [sortBy, sortDirection] = sort.split(".") as [
        "created_at" | "severity" | "event_type" | "store_id" | "title",
        "asc" | "desc",
      ];
      const result = await listActivityEventPage({
        limit: pageSize,
        offset: (page - 1) * pageSize,
        query: settledQuery.trim() || undefined,
        types: type === "all" ? undefined : [type],
        severities: severity === "all" ? undefined : [severity as EventSeverity],
        storeId: storeId === "all" ? undefined : storeId,
        from: dateBound(from),
        to: dateBound(to, true),
        sortBy,
        sortDirection,
      });
      if (requestId !== requestSequence.current) return;
      setRows(result.rows);
      setTotal(result.total);
      setMissing(isActivityLogMissing());
      markActivitySeen(
        result.rows[0]?.createdAt ?? new Date().toISOString(),
        user?.staffId ?? user?.name ?? "",
      );
    } catch (error) {
      if (requestId === requestSequence.current) notifyError(error, "Loading alerts");
    } finally {
      if (requestId === requestSequence.current) setBusy(false);
    }
  }, [
    from,
    page,
    pageSize,
    settledQuery,
    severity,
    sort,
    storeId,
    to,
    type,
    user?.name,
    user?.staffId,
  ]);

  useEffect(() => {
    if (isSupervisor) void load();
  }, [isSupervisor, load]);

  useEffect(() => {
    if (!isSupervisor) return;
    const recover = () => {
      if (connectivity() === "online") void load();
    };
    window.addEventListener(APP_RESUME_EVENT, recover);
    window.addEventListener(CONNECTIVITY_RESTORED_EVENT, recover);
    return () => {
      window.removeEventListener(APP_RESUME_EVENT, recover);
      window.removeEventListener(CONNECTIVITY_RESTORED_EVENT, recover);
    };
  }, [isSupervisor, load]);

  const storeNames = useMemo(
    () => new Map(stores.map((store) => [store.id, store.name])),
    [stores],
  );
  const refs = useMemo(
    () => ({ stores, products: state.products, members: state.members, sales: state.sales }),
    [stores, state.products, state.members, state.sales],
  );
  const branchName = (id: string) => storeNames.get(id) ?? "Unknown branch";
  const eventText = (value: string) => humanizeText(value, refs);
  if (!isSupervisor)
    return (
      <AppShell>
        <p className="p-6 text-sm text-muted-foreground">
          Alerts history is available to supervisors and admins.
        </p>
      </AppShell>
    );

  return (
    <AppShell>
      <div className="space-y-4 p-3 sm:p-4 lg:p-6">
        <header>
          <h1 className="text-xl font-semibold">Alerts history</h1>
          <p className="text-sm text-muted-foreground">
            Every system alert, with branch, item, quantity, delivery state and full details.
          </p>
        </header>
        {missing && (
          <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
            The activity log is not installed on this database yet. Run the current Supabase schema
            once to enable alert history.
          </p>
        )}

        <section className="grid grid-cols-1 gap-3 rounded-lg border border-border p-3 sm:grid-cols-2 xl:grid-cols-7">
          <div className="space-y-1 sm:col-span-2 xl:col-span-2">
            <Label className="text-xs">Search</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Message, item, person or reference"
              />
            </div>
          </div>
          <Filter label="Category">
            <ThemedSelect
              value={type}
              onChange={setType}
              options={[{ value: "all", label: "All categories" }, ...ALERT_TYPES]}
            />
          </Filter>
          <Filter label="Importance">
            <ThemedSelect
              value={severity}
              onChange={setSeverity}
              options={[
                { value: "all", label: "All severities" },
                { value: "critical", label: "Critical" },
                { value: "warning", label: "Warning" },
                { value: "info", label: "Information" },
              ]}
            />
          </Filter>
          <Filter label="Branch">
            <ThemedSelect
              value={storeId}
              onChange={setStoreId}
              options={[
                { value: "all", label: "All branches" },
                ...stores.map((store) => ({ value: store.id, label: store.name })),
              ]}
            />
          </Filter>
          <Filter label="From">
            <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </Filter>
          <Filter label="To">
            <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </Filter>
          <Filter label="Sort">
            <ThemedSelect
              value={sort}
              onChange={setSort}
              options={[
                { value: "created_at.desc", label: "Newest first" },
                { value: "created_at.asc", label: "Oldest first" },
                { value: "severity.asc", label: "Importance" },
                { value: "event_type.asc", label: "Category" },
                { value: "store_id.asc", label: "Branch" },
              ]}
            />
          </Filter>
          <div className="flex items-end">
            <Button
              className="w-full"
              variant="outline"
              onClick={() => void load()}
              disabled={busy}
            >
              <RefreshCw className={cn("size-4", busy && "animate-spin")} /> Refresh
            </Button>
          </div>
        </section>

        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date & time</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Item / alert</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead className="text-right">Quantity / amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">
                  <ArrowUpDown className="ml-auto size-4" />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    {busy ? "Loading alerts…" : "No alerts match these filters."}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => {
                  const cleared = row.clearedBy.length > 0;
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap text-xs">
                        {when(row.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            "whitespace-nowrap text-[10px]",
                            SEVERITY_TONE[row.severity],
                          )}
                        >
                          {EVENT_LABELS[row.type] ?? row.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-md text-xs">
                        <p className="font-medium">{eventText(row.title)}</p>
                        <p className="line-clamp-2 text-muted-foreground">
                          {row.message
                            ? eventText(row.message)
                            : friendlyReference(row.entityId, refs)}
                        </p>
                        {row.entityId && (
                          <p className="mt-0.5 text-[10px] text-muted-foreground">
                            Related: {friendlyReference(row.entityId, refs)}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">{branchName(row.storeId)}</TableCell>
                      <TableCell className="numeric text-right text-xs">
                        {row.amount == null ? "—" : row.amount.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-xs">
                        <span className="block">{cleared ? "Acknowledged" : "Active"}</span>
                        <span className="capitalize text-[10px] text-muted-foreground">
                          Delivery: {row.whatsappStatus}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => setSelected(row)}>
                          View details
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
          <TablePagination
            page={Math.min(page, pageCount)}
            pageCount={pageCount}
            pageSize={pageSize}
            total={total}
            from={total ? (page - 1) * pageSize + 1 : 0}
            to={Math.min(page * pageSize, total)}
            label="alerts"
            onPage={setPage}
            onPageSize={setPageSize}
          />
        </div>
      </div>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Alert details</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-4 text-sm">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className={SEVERITY_TONE[selected.severity]}>
                  {selected.severity}
                </Badge>
                <Badge variant="outline">{EVENT_LABELS[selected.type] ?? selected.type}</Badge>
              </div>
              <div>
                <p className="font-semibold">{eventText(selected.title)}</p>
                <p className="mt-1 whitespace-pre-wrap text-muted-foreground">
                  {selected.message ? eventText(selected.message) : "No additional message."}
                </p>
              </div>
              <dl className="grid grid-cols-1 gap-3 rounded-md bg-muted/40 p-3 sm:grid-cols-2">
                <Detail label="Created / received" value={when(selected.createdAt)} />
                <Detail label="Branch" value={branchName(selected.storeId)} />
                <Detail
                  label="Related item / record"
                  value={friendlyReference(selected.entityId, refs)}
                />
                <Detail
                  label="Quantity / amount"
                  value={selected.amount == null ? "—" : selected.amount.toLocaleString()}
                />
                <Detail
                  label="User / activity"
                  value={
                    [selected.actorName, selected.actorRole].filter(Boolean).join(" · ") || "System"
                  }
                />
                <Detail label="Terminal" value={selected.terminalName || "This terminal"} />
                <Detail label="Delivery status" value={selected.whatsappStatus} />
                <Detail label="Cleared by" value={selected.clearedBy.join(", ") || "Not cleared"} />
              </dl>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words font-medium capitalize">{value}</dd>
    </div>
  );
}

export const Route = createFileRoute("/alerts")({
  head: () => ({
    meta: [
      { title: "Alerts History — Retail" },
      { name: "description", content: "Searchable, filterable history of every POS alert." },
    ],
  }),
  component: AlertsHistory,
});
