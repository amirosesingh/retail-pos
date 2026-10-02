import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  CloudOff,
  Cloud,
  Download,
  Eye,
  ShieldAlert,
  ShoppingCart,
  RefreshCw,
  Tag,
  MousePointerClick,
  Compass,
  PanelTop,
  UserRound,
  Settings2,
  List,
  Rows3,
  Wrench,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AUDIT_CATEGORIES,
  AUDIT_CATEGORY_LABELS,
  displayCategory,
  auditToCsv,
  logger,
  useAuditLogs,
  useSyncState,
  type AuditLog,
} from "@/lib/audit-log";
import { useAuth } from "@/lib/pos-auth";
import { usePos } from "@/lib/pos-store";
import { describeLog } from "@/lib/audit-format";
import { TablePagination, usePagination } from "@/platforms/web/components/pos/TablePagination";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { getPosCallerAuth } from "@/lib/pos-caller-auth";
import { getRecentRecordEdits } from "@/lib/record-edits.functions";
import type { RecordEditRow } from "@/lib/record-edits.server";
import { branchDisplayName } from "@/lib/human-readable";

export const Route = createFileRoute("/audit")({
  head: () => ({
    meta: [
      { title: "Audit Logs & Activity Trail — Retail" },
      {
        name: "description",
        content:
          "Filterable compliance trail of every click, sale, inventory edit and sync event captured across the point of sale.",
      },
      { property: "og:title", content: "Audit Logs & Activity Trail — Retail" },
      {
        property: "og:description",
        content: "Staff activity telemetry with detail inspector and CSV export.",
      },
    ],
  }),
  component: AuditPage,
});

type RangeKey = "all" | "today" | "yesterday" | "custom";

const categoryVisual: Record<string, { icon: typeof ShoppingCart; className: string }> = {
  sale: { icon: ShoppingCart, className: "bg-emerald-500/15 text-emerald-500" },
  payment: { icon: ShoppingCart, className: "bg-teal-500/15 text-teal-500" },
  refund: { icon: RefreshCw, className: "bg-orange-500/15 text-orange-500" },
  drawer: { icon: ShoppingCart, className: "bg-lime-500/15 text-lime-500" },
  discount: { icon: Tag, className: "bg-pink-500/15 text-pink-400" },
  inventory: { icon: Tag, className: "bg-sky-500/15 text-sky-500" },
  shift: { icon: Compass, className: "bg-cyan-500/15 text-cyan-500" },
  member: { icon: UserRound, className: "bg-violet-500/15 text-violet-500" },
  security: { icon: UserRound, className: "bg-rose-500/15 text-rose-400" },
  report: { icon: PanelTop, className: "bg-indigo-500/15 text-indigo-400" },
  settings: { icon: Settings2, className: "bg-amber-500/15 text-amber-500" },
  print: { icon: PanelTop, className: "bg-slate-500/15 text-slate-400" },
  browse: { icon: Compass, className: "bg-muted text-muted-foreground" },
  other: { icon: MousePointerClick, className: "bg-muted text-muted-foreground" },
};

const visualFor = (l: AuditLog) => {
  if (l.action.toLowerCase().includes("exchange"))
    return { icon: RefreshCw, className: "bg-orange-500/15 text-orange-500" };
  return categoryVisual[displayCategory(l.category)] ?? categoryVisual["other"]!;
};

const categoryLabel = (c: string) => AUDIT_CATEGORY_LABELS[displayCategory(c)] ?? c;

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

const isMistakeOrCorrection = (row: AuditLog) =>
  /error|fail|blocked|reject|mistake|correct|override|variance|void|refund|cancel|duplicate|unknown/i.test(
    `${row.action} ${JSON.stringify(row.details)}`,
  );

const jsonObject = (value: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

const changedFields = (edit: RecordEditRow) => {
  const before = jsonObject(edit.before_value);
  const after = jsonObject(edit.after_value);
  return Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
};

function AuditPage() {
  const { can, staff, isAdmin } = useAuth();
  const { stores } = usePos();
  const logs = useAuditLogs();
  const sync = useSyncState();
  const [range, setRange] = useState<RangeKey>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [who, setWho] = useState("all");
  const [category, setCategory] = useState("all");
  const [module, setModule] = useState("all");
  const [showBrowse, setShowBrowse] = useState(false);
  const [riskOnly, setRiskOnly] = useState(false);
  const [mistakesOnly, setMistakesOnly] = useState(false);
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<AuditLog | null>(null);
  const [correctionDetail, setCorrectionDetail] = useState<RecordEditRow | null>(null);
  const [correctionGuideOpen, setCorrectionGuideOpen] = useState(false);
  const [corrections, setCorrections] = useState<RecordEditRow[]>([]);
  const [correctionsLoading, setCorrectionsLoading] = useState(true);
  const [view, setView] = useState<"table" | "stream">("table");

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const auth = await getPosCallerAuth();
        const result = await getRecentRecordEdits({ data: { ...auth, limit: 200 } });
        if (alive && result.ok) setCorrections(result.edits);
      } finally {
        if (alive) setCorrectionsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const modules = useMemo(
    () => Array.from(new Set(logs.map((l) => l.module).filter(Boolean))).sort(),
    [logs],
  );

  const rows = useMemo(() => {
    const now = new Date();
    const today = dayStart(now);
    const yesterday = today - 86_400_000;
    const text = q.trim().toLowerCase();
    return logs.filter((l) => {
      const t = new Date(l.at).getTime();
      if (range === "today" && t < today) return false;
      if (range === "yesterday" && (t < yesterday || t >= today)) return false;
      if (range === "custom") {
        if (from && t < new Date(`${from}T00:00:00`).getTime()) return false;
        if (to && t > new Date(`${to}T23:59:59`).getTime()) return false;
      }
      if (who !== "all" && l.staffId !== who) return false;
      const cat = displayCategory(l.category);
      if (category !== "all" && cat !== category) return false;
      // Screen views and searches are noise for a manager — off unless asked for.
      if (category !== "browse" && !showBrowse && cat === "browse") return false;
      if (module !== "all" && l.module !== module) return false;
      // Cashier trail: voids, price overrides and no-sale drawer opens only.
      if (
        riskOnly &&
        !["item_void", "price_override", "no_sale"].some((a) =>
          `${l.action} ${JSON.stringify(l.details)}`.includes(a),
        )
      )
        return false;
      if (mistakesOnly && !isMistakeOrCorrection(l)) return false;
      if (
        text &&
        !`${describeLog(l)} ${l.action} ${l.module} ${l.staffName} ${l.staffId} ${l.route} ${JSON.stringify(
          l.details,
        )}`
          .toLowerCase()
          .includes(text)
      )
        return false;
      return true;
    });
  }, [logs, range, from, to, who, category, module, showBrowse, riskOnly, mistakesOnly, q]);

  const pager = usePagination(rows, 25);

  if (!can("can_view_audit_trail")) {
    return (
      <AppShell>
        <div className="flex min-h-screen items-center justify-center p-6">
          <div className="max-w-sm rounded-lg border border-destructive/40 bg-destructive/10 p-6 text-center">
            <ShieldAlert className="mx-auto size-6 text-destructive" />
            <p className="mt-2 font-semibold">Permission required</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Your role does not allow access to the company activity trail.
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  function exportCsv() {
    const blob = new Blob([auditToCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    logger.log("sync", "Exported audit logs", "audit", { rows: rows.length, format: "csv" });
    toast.success(`Exported ${rows.length} log rows`);
  }

  return (
    <AppShell>
      <div className="space-y-5 p-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Audit logs &amp; activity trail</h1>
            <p className="text-sm text-muted-foreground">
              {rows.length} of {logs.length} events · local-first telemetry
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={sync.online ? "secondary" : "destructive"} className="gap-1">
              {sync.online ? <Cloud className="size-3" /> : <CloudOff className="size-3" />}
              {sync.online ? "Online" : "Offline"} · {sync.pending} pending
            </Badge>
            {isAdmin && (
              <Button variant="outline" onClick={() => setCorrectionGuideOpen(true)}>
                <Wrench className="size-4" /> Correct a record
              </Button>
            )}
            <Button variant="outline" onClick={exportCsv}>
              <Download className="size-4" /> Export logs
            </Button>
          </div>
        </header>

        <section className="grid gap-3 rounded-lg border border-border bg-card p-4 md:grid-cols-4">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Date range</Label>
            <Select value={range} onValueChange={(v) => setRange(v as RangeKey)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All time</SelectItem>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="yesterday">Yesterday</SelectItem>
                <SelectItem value="custom">Custom range</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Staff member</Label>
            <Select value={who} onValueChange={setWho}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All staff</SelectItem>
                <SelectItem value="admin">Store Admin</SelectItem>
                {staff.map((s) => (
                  <SelectItem key={s.id} value={s.staffId}>
                    {s.name} ({s.staffId})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {AUDIT_CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Search details</Label>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search action, module or payload"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Screen / module</Label>
            <Select value={module} onValueChange={setModule}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All screens</SelectItem>
                {modules.map((m) => (
                  <SelectItem key={m} value={m} className="capitalize">
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Browsing activity</Label>
            <Button
              type="button"
              variant={showBrowse ? "secondary" : "outline"}
              className="w-full justify-start"
              onClick={() => setShowBrowse((v) => !v)}
            >
              <Compass className="size-4" />
              {showBrowse ? "Shown" : "Hidden"}
            </Button>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Cashier trail</Label>
            <Button
              type="button"
              variant={riskOnly ? "secondary" : "outline"}
              className="w-full justify-start"
              onClick={() => setRiskOnly((v) => !v)}
            >
              <ShieldAlert className="size-4" />
              {riskOnly ? "Voids, overrides & no-sales" : "All actions"}
            </Button>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Mistakes &amp; corrections</Label>
            <Button
              type="button"
              variant={mistakesOnly ? "secondary" : "outline"}
              className="w-full justify-start"
              onClick={() => setMistakesOnly((value) => !value)}
            >
              <AlertTriangle className="size-4" />
              {mistakesOnly ? "Only exceptions shown" : "Show all activity"}
            </Button>
          </div>
          {range === "custom" && (
            <>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">From</Label>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">To</Label>
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </>
          )}
        </section>

        <div className="flex justify-end">
          <ToggleGroup
            type="single"
            value={view}
            onValueChange={(v) => v && setView(v as "table" | "stream")}
            variant="outline"
          >
            <ToggleGroupItem value="table" aria-label="Table view">
              <Rows3 className="size-4" /> Table
            </ToggleGroupItem>
            <ToggleGroupItem value="stream" aria-label="Activity stream view">
              <List className="size-4" /> Activity stream
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        {view === "stream" ? (
          <section className="rounded-lg border border-border bg-card">
            <ol className="relative p-4">
              {pager.pageItems.map((l) => {
                const { icon: Icon, className } = visualFor(l);
                return (
                  <li key={l.id} className="relative flex gap-3 pb-5 last:pb-0">
                    <div className="flex flex-col items-center">
                      <span
                        className={`grid size-8 shrink-0 place-items-center rounded-full ${className}`}
                      >
                        <Icon className="size-4" />
                      </span>
                      <span className="mt-1 w-px flex-1 bg-border" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">{describeLog(l)}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="numeric">{new Date(l.at).toLocaleString()}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {categoryLabel(l.category)}
                        </Badge>
                        <span className="capitalize">{l.module}</span>
                        <Badge
                          variant={l.synced_to_cloud ? "secondary" : "outline"}
                          className="text-[10px]"
                        >
                          {l.synced_to_cloud ? "synced" : "pending"}
                        </Badge>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2"
                          onClick={() => setDetail(l)}
                        >
                          <Eye className="size-3" /> Details
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
              {!rows.length && (
                <li className="py-10 text-center text-sm text-muted-foreground">
                  No activity matches these filters.
                </li>
              )}
            </ol>
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
          </section>
        ) : (
          <section className="rounded-lg border border-border bg-card">
            <Table clientDataControls={false}>
              <TableHeader>
                <TableRow>
                  <TableHead>Date &amp; time</TableHead>
                  <TableHead>Staff</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Action description</TableHead>
                  <TableHead>Sync</TableHead>
                  <TableHead className="text-right">Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pager.pageItems.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="numeric whitespace-nowrap text-muted-foreground">
                      {new Date(l.at).toLocaleString()}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {l.staffName}
                      <span className="numeric block text-[11px] text-muted-foreground">
                        {l.staffId}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{categoryLabel(l.category)}</Badge>
                    </TableCell>
                    <TableCell className="max-w-md">{describeLog(l)}</TableCell>
                    <TableCell>
                      <Badge variant={l.synced_to_cloud ? "secondary" : "outline"}>
                        {l.synced_to_cloud ? "synced" : "pending"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setDetail(l)}>
                        <Eye className="size-4" /> View details
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!rows.length && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                      No activity matches these filters.
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
          </section>
        )}

        <section className="rounded-lg border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
            <div>
              <h2 className="text-sm font-semibold">Posted-record correction history</h2>
              <p className="text-xs text-muted-foreground">
                Original records stay traceable; every authorised correction stores the old and new
                values.
              </p>
            </div>
            <Badge variant="outline">
              {correctionsLoading ? "Loading…" : `${corrections.length} corrections`}
            </Badge>
          </div>
          <Separator />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Record</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead>Changed fields</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Edited / authorised by</TableHead>
                <TableHead className="text-right">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {corrections.map((edit) => (
                <TableRow key={edit.id}>
                  <TableCell className="numeric whitespace-nowrap text-muted-foreground">
                    {new Date(edit.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <span className="capitalize">{edit.record_type.replaceAll("_", " ")}</span>
                    <span className="block text-xs text-muted-foreground">
                      {edit.reference || "Related record"}
                    </span>
                  </TableCell>
                  <TableCell>{branchDisplayName(stores, edit.store_id)}</TableCell>
                  <TableCell>{changedFields(edit).join(", ") || edit.action_key}</TableCell>
                  <TableCell className="max-w-xs">{edit.note || "No reason recorded"}</TableCell>
                  <TableCell>
                    {edit.edited_by_name || edit.edited_by || "Unknown user"}
                    <span className="block text-xs text-muted-foreground">
                      Approved by {edit.authorized_by || "permission rule"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => setCorrectionDetail(edit)}>
                      <Eye className="size-4" /> Compare
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!correctionsLoading && !corrections.length && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                    No posted-record corrections have been recorded yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </section>
      </div>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{detail?.action}</DialogTitle>
            <DialogDescription>
              {detail && new Date(detail.at).toLocaleString()} · {detail?.module}
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="space-y-4">
              <p className="rounded-md border border-border bg-muted/40 p-3 text-sm">
                {describeLog(detail)}
              </p>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <Row label="Staff" value={`${detail.staffName} (${detail.staffId})`} />
                <Row label="Category" value={categoryLabel(detail.category)} />
                <Row label="Route" value={detail.route} />
                <Row
                  label="Store"
                  value={
                    detail.storeId
                      ? (stores.find((store) => store.id === detail.storeId)?.name ??
                        "Unknown branch")
                      : "All branches"
                  }
                />
                <Row
                  label="Cloud sync"
                  value={
                    detail.synced_to_cloud
                      ? `synced ${new Date(detail.syncedAt!).toLocaleTimeString()}`
                      : "pending (queued locally)"
                  }
                />
              </dl>
              <Separator />
              <div>
                <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                  Action metadata
                </p>
                <pre className="numeric max-h-80 overflow-auto rounded-md border border-border bg-muted/40 p-3 text-xs">
                  {JSON.stringify(detail.details, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={correctionGuideOpen} onOpenChange={setCorrectionGuideOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Correct a business record safely</DialogTitle>
            <DialogDescription>
              Never repair financial data directly in Supabase. Use the matching workflow so totals,
              stock and the immutable correction trail stay together.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <CorrectionLink href="/receipts" title="Sale or payment mistake">
              Correct the tender as an administrator, or void/refund the wrong bill and issue the
              replacement bill.
            </CorrectionLink>
            <CorrectionLink href="/shifts" title="Shift closing mistake">
              Review the Z-report and record an administrator correction.
            </CorrectionLink>
            <CorrectionLink href="/stock-operations" title="Stock count mistake">
              Reopen the posted count as an administrator; the stock delta and before/after values
              are saved.
            </CorrectionLink>
            <CorrectionLink href="/purchasing" title="Receiving mistake">
              Reopen the received purchase as an administrator and post only the required stock
              difference.
            </CorrectionLink>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!correctionDetail} onOpenChange={(open) => !open && setCorrectionDetail(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              Correction · {correctionDetail?.reference || "Related record"}
            </DialogTitle>
            <DialogDescription>
              {correctionDetail && new Date(correctionDetail.created_at).toLocaleString()} ·
              original values remain in the audit history
            </DialogDescription>
          </DialogHeader>
          {correctionDetail && (
            <div className="space-y-4">
              <dl className="grid gap-2 text-sm sm:grid-cols-3">
                <Row label="Record" value={correctionDetail.record_type.replaceAll("_", " ")} />
                <Row label="Reason" value={correctionDetail.note || "No reason recorded"} />
                <Row label="Branch" value={branchDisplayName(stores, correctionDetail.store_id)} />
                <Row
                  label="Edited by"
                  value={
                    correctionDetail.edited_by_name || correctionDetail.edited_by || "Unknown user"
                  }
                />
                <Row
                  label="Authorised by"
                  value={correctionDetail.authorized_by || "Permission rule"}
                />
                <Row label="Action" value={correctionDetail.action_key.replaceAll("_", " ")} />
              </dl>
              <div className="grid gap-3 md:grid-cols-2">
                <ValuePanel title="Before" value={correctionDetail.before_value} />
                <ValuePanel title="After" value={correctionDetail.after_value} />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function CorrectionLink({
  href,
  title,
  children,
}: {
  href: string;
  title: string;
  children: string;
}) {
  return (
    <a
      href={href}
      className="rounded-lg border border-border p-4 transition-colors hover:bg-muted/40"
    >
      <span className="font-medium">{title}</span>
      <span className="mt-1 block text-sm text-muted-foreground">{children}</span>
    </a>
  );
}

function ValuePanel({ title, value }: { title: string; value: string }) {
  const parsed = jsonObject(value);
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">{title}</p>
      <pre className="numeric max-h-96 overflow-auto rounded-md border border-border bg-muted/40 p-3 text-xs">
        {JSON.stringify(parsed, null, 2)}
      </pre>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-2">
      <dt className="text-[11px] uppercase text-muted-foreground">{label}</dt>
      <dd className="break-words font-medium">{value}</dd>
    </div>
  );
}
