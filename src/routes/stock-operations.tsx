import { reconcileLiveRows } from "@/lib/live-state";
import { formatDateTime as posDisplayDateTime } from "@/lib/time-zone";
import { notifyError } from "@/lib/notify";
/**
 * Stock Operations — the only place stock quantities change by hand.
 *
 * The page itself is the record book: every count, draft or posted, with its
 * reference number. Counting happens in a dialog, so a session can be opened
 * from the list and closed again without losing the page you were on.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeftRight, ClipboardList, Lock, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ThemedSelect } from "@/platforms/web/components/pos/ThemedSelect";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/lib/pos-auth";
import { db } from "@/core/api/pos-db";
import { localDb } from "@/core/local-db/local-db";
import { money, usePos } from "@/lib/pos-store";
import { subscribeDataChange, subscribeSettingsChange } from "@/lib/sync-engine";
import { canEditPosted } from "@/lib/stock-ref";
import { useManagerGate } from "@/lib/manager-gate";
import {
  beginPostedEdit,
  continuePostedEdit,
  myServerId,
  withdrawPostedEdit,
  type EditGrant,
} from "@/lib/record-edit-flow";
import {
  StockCountDialog,
  type StockRecordRow,
} from "@/platforms/web/components/pos/StockCountDialog";
import { StockRecordView } from "@/platforms/web/components/pos/StockRecordView";

const ALL = "all";

function StockOperationsPage() {
  const { state, currentStore } = usePos();
  const { authorize } = useManagerGate();

  const { user, isAdmin, isSupervisor } = useAuth();
  const multiBranch = state.stores.length > 1;
  const mayPickCountStore = multiBranch && (isAdmin || isSupervisor);

  const [tab, setTab] = useState("records");
  const [countStoreId, setCountStoreId] = useState(currentStore.id);
  const [activeCountStoreId, setActiveCountStoreId] = useState(currentStore.id);
  const [records, setRecords] = useState<StockRecordRow[]>([]);
  const [loading, setLoading] = useState(false);
  const refreshSequence = useRef(0);
  const loadedScope = useRef<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [branchFilter, setBranchFilter] = useState<string>("current");
  const [countOpen, setCountOpen] = useState(false);
  const [resuming, setResuming] = useState<StockRecordRow | null>(null);
  const [viewing, setViewing] = useState<StockRecordRow | null>(null);
  const [discardTarget, setDiscardTarget] = useState<string | null>(null);
  const [editGrant, setEditGrant] = useState<EditGrant | null>(null);
  const [meId, setMeId] = useState("");
  const [busyRow, setBusyRow] = useState("");

  useEffect(() => {
    setCountStoreId(currentStore.id);
  }, [currentStore.id]);

  useEffect(() => {
    void myServerId().then(setMeId).catch(error => notifyError(error, "Reading stock count identity"));
  }, []);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    const scope = `${branchFilter}:${currentStore.id}`;
    const initial = loadedScope.current !== scope;
    setLoading(initial);
    if (initial) setRecords([]);
    try {
      const list = (await db.listStockCountRecords({
        storeId: branchFilter === ALL ? null : currentStore.id,
      })) as unknown as StockRecordRow[];
      if (sequence !== refreshSequence.current) return;
      loadedScope.current = scope;
      setRecords(previous => reconcileLiveRows(previous, list));
      setViewing(current => current ? list.find(row => row.id === current.id) ?? current : null);
      setReadError(null);
    } catch (error) {
      if (sequence !== refreshSequence.current) return;
      setReadError(error instanceof Error ? error.message : "Stock count records could not be read.");
    } finally {
      if (sequence === refreshSequence.current) setLoading(false);
    }
  }, [branchFilter, currentStore.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const wake = () => { void refresh(); };
    const offData = subscribeDataChange((change) => {
      if (change.table === "stock_count_drafts") wake();
    });
    const offSettings = subscribeSettingsChange((change) => {
      if (change.reason === "desktop:pull-complete" || change.reason === "reconnect") wake();
    });
    const offLocal = localDb()?.onBusinessChanged?.((change) => {
      if (change.kind === "stock") wake();
    });
    const interval = window.setInterval(wake, 60_000);
    window.addEventListener("focus", wake);
    return () => {
      offData();
      offSettings();
      offLocal?.();
      window.clearInterval(interval);
      window.removeEventListener("focus", wake);
    };
  }, [refresh]);

  const visible = useMemo(
    () => records.filter((r) => statusFilter === ALL || r.status === statusFilter),
    [records, statusFilter],
  );
  const activeStores = useMemo(
    () => state.stores.filter((store) => store.active !== false),
    [state.stores],
  );
  const openDrafts = records.filter((r) => r.status === "draft").length;

  const startNew = () => {
    const targetId = mayPickCountStore ? countStoreId : currentStore.id;
    const target = activeStores.find((store) => store.id === targetId);
    if (!target) {
      setCountStoreId(currentStore.id);
      toast.error("That branch is archived. Choose an active branch before starting the count.");
      return;
    }
    setResuming(null);
    setActiveCountStoreId(target.id);
    setCountOpen(true);
    toast.info(`New stock count will write to ${target.name}`, {
      description: `Branch ${target.code || target.id}. This destination is locked for the count.`,
    });
  };

  const resume = (row: StockRecordRow) => {
    setActiveCountStoreId(row.store_id ?? currentStore.id);
    setResuming(row);
    setCountOpen(true);
  };

  /** Reopening a posted count always goes through the configured authorisation. */
  const editPosted = async (row: StockRecordRow) => {
    setBusyRow(row.id);
    try {
      const outcome = await beginPostedEdit(authorize, {
        action: "edit_posted_stock",
        recordKind: "stock_count",
        recordId: row.id,
        reference: row.reference ?? row.id,
        title: "Edit a posted stock record",
        storeId: row.store_id ?? currentStore.id,
        detail: `${row.reference ?? row.id} · ${row.line_count ?? 0} lines`,
      });
      if (outcome.kind === "open") {
        setEditGrant(outcome.grant);
        resume(row);
      } else if (outcome.kind === "queued") {
        await refresh();
      }
    } finally {
      setBusyRow("");
    }
  };

  /** Come back to a record whose edit was sent for approval. */
  const continueEdit = async (row: StockRecordRow) => {
    setBusyRow(row.id);
    try {
      const res = await continuePostedEdit("stock_count", row.id);
      if (res.open) {
        setEditGrant(res.grant ?? null);
        resume(row);
      }
      await refresh();
    } finally {
      setBusyRow("");
    }
  };

  const withdrawEdit = async (row: StockRecordRow) => {
    setBusyRow(row.id);
    try {
      if (await withdrawPostedEdit("stock_count", row.id)) await refresh();
    } finally {
      setBusyRow("");
    }
  };

  const discardDraft = async (id: string) => {
    try {
      await db.setStockCountDraftStatus(id, "discarded", user?.name ?? null);
      setDiscardTarget(null);
      setCountOpen(false);
      toast.success("Draft discarded — no stock was changed.");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Draft could not be discarded.");
    }
  };

  const recordActions = (r: StockRecordRow) => <>
                          <Button size="sm" variant="ghost" onClick={() => setViewing(r)}>
                            View
                          </Button>
                          {r.status === "draft" ? (
                            <>
                              <Button size="sm" onClick={() => resume(r)}>
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setDiscardTarget(r.id)}
                              >
                                Discard
                              </Button>
                            </>
                          ) : r.status === "posted" && isAdmin ? (
                            r.pending_edit_request_id ? (
                              (r.pending_edit_by ?? "").toLowerCase() === meId.toLowerCase() &&
                              !!meId ? (
                                <>
                                  <Button
                                    size="sm"
                                    disabled={busyRow === r.id}
                                    onClick={() => void continueEdit(r)}
                                  >
                                    Continue edit
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={busyRow === r.id}
                                    onClick={() => void withdrawEdit(r)}
                                  >
                                    Withdraw
                                  </Button>
                                </>
                              ) : (
                                <Badge variant="outline" className="border-primary/40 text-primary">
                                  <Lock className="mr-1 size-3" /> Pending edit
                                  {r.pending_edit_by ? ` · ${r.pending_edit_by}` : ""}
                                </Badge>
                              )
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={busyRow === r.id}
                                onClick={() => void editPosted(r)}
                                title="Editing a posted count needs authorisation."
                              >
                                {canEditPosted() ? (
                                  <Pencil className="mr-1 size-3" />
                                ) : (
                                  <Lock className="mr-1 size-3" />
                                )}{" "}
                                Edit
                              </Button>
                            )
                          ) : null}
  </>;

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-6xl space-y-4 p-4">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="h-auto max-w-full flex-wrap">
            <TabsTrigger value="records">
              <ClipboardList className="mr-2 size-4" /> Stock count records
              {openDrafts > 0 && (
                <Badge variant="outline" className="ml-2 numeric">
                  {openDrafts} draft
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="transfers">
              <ArrowLeftRight className="mr-2 size-4" /> Transfers
            </TabsTrigger>
          </TabsList>

          <TabsContent value="records" className="space-y-4">
            {readError && <p role="alert" className="text-sm text-destructive">Stock count records: {readError}</p>}
            <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-border bg-card p-3 sm:p-4">
              <div className="grid w-full min-w-0 grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-end sm:gap-3">
                <div className="min-w-0 sm:w-44">
                  <ThemedSelect
                    value={statusFilter}
                    onChange={setStatusFilter}
                    options={[
                      { value: ALL, label: "All statuses" },
                      { value: "draft", label: "Draft" },
                      { value: "posted", label: "Posted" },
                      { value: "discarded", label: "Discarded" },
                    ]}
                    ariaLabel="Status filter"
                  />
                </div>
                {multiBranch && (
                  <div className="min-w-0 sm:w-52">
                    <ThemedSelect
                      value={branchFilter}
                      onChange={setBranchFilter}
                      options={[
                        { value: "current", label: `This branch · ${currentStore.name}` },
                        { value: ALL, label: "All branches" },
                      ]}
                      ariaLabel="Branch filter"
                    />
                  </div>
                )}
              </div>
              <div className="flex w-full min-w-0 items-end gap-2 sm:w-auto sm:flex-wrap">
                {mayPickCountStore ? (
                  <div className="min-w-0 flex-1 sm:w-64 sm:flex-none">
                    <p className="mb-1 text-[11px] font-medium text-muted-foreground">
                      New count writes to
                    </p>
                    <ThemedSelect
                      value={countStoreId}
                      onChange={setCountStoreId}
                      options={activeStores.map((store) => ({
                        value: store.id,
                        label: `${store.code || store.id} · ${store.name}`,
                      }))}
                      ariaLabel="Stock count destination branch"
                    />
                  </div>
                ) : null}
                <Button className="shrink-0" onClick={startNew}>
                  <Plus className="mr-2 size-4" /> New count
                </Button>
              </div>
            </div>

            {loading ? (
              <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                Loading records…
              </p>
            ) : visible.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                No stock count records yet. Start one with “New count”.
              </p>
            ) : (
              <>
              <div className="space-y-3 md:hidden">
                {visible.map(r => <article key={r.id} className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-all font-mono text-sm font-medium">{r.reference || "—"}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{r.store_code || r.store_id || "—"}</p>
                    </div>
                    <Badge status={r.status} variant="outline" className="shrink-0 text-[10px] capitalize">{r.status}</Badge>
                  </div>
                  <div className="relative grid grid-cols-[1fr_1fr_6rem] items-start gap-2 text-xs">
                    <div><dt className="text-muted-foreground">Items</dt><dd className="numeric font-medium">{r.line_count ?? 0}</dd></div>
                    <div><dt className="text-muted-foreground">Impact</dt><dd className="numeric font-medium">{money(Number(r.total_impact ?? 0))}</dd></div>
                  <details className="col-span-3 text-xs">
                    <summary className="absolute right-0 top-0 cursor-pointer rounded py-2 text-right font-medium text-primary">More details</summary>
                    <dl className="col-span-3 grid grid-cols-2 gap-3 py-2 [&_dd]:break-words [&_dt]:text-muted-foreground">
                      <div><dt>Created</dt><dd>{r.created_at ? posDisplayDateTime(new Date(r.created_at)) : "—"}</dd></div>
                      <div><dt>Created by</dt><dd>{r.staff_name || "—"}</dd></div>
                      <div><dt>Posted</dt><dd>{r.posted_at ? posDisplayDateTime(new Date(r.posted_at)) : "—"}</dd></div>
                      <div><dt>Posted by</dt><dd>{r.posted_by || "—"}</dd></div>
                    </dl>
                  </details>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">{recordActions(r)}</div>
                </article>)}
              </div>
              <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
                <Table managed summaryFormats={{ Amount: money, "Net impact": money, "Estimated cost": money }}>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reference</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Branch</TableHead>
                      <TableHead className="text-right">Items</TableHead>
                      <TableHead className="text-right">Impact</TableHead>
                      <TableHead>Created by</TableHead>
                      <TableHead>Posted by</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.map((r) => (
                      <TableRow key={r.id} summaryValues={{ Items: Number(r.line_count ?? 0), "Net impact": Number(r.total_impact ?? 0) }}>
                        <TableCell className="font-mono">{r.reference || "—"}</TableCell>
                        <TableCell>
                          <Badge status={r.status}
                            variant="outline"
                            className={`capitalize ${
                              r.status === "posted"
                                ? "border-success/40 text-success"
                                : r.status === "discarded"
                                  ? "text-muted-foreground"
                                  : "border-primary/40 text-primary"
                            }`}
                          >
                            {r.status}
                          </Badge>
                        </TableCell>
                        <TableCell
                          title={
                            r.posted_at
                              ? `Posted ${posDisplayDateTime(new Date(r.posted_at))}`
                              : undefined
                          }
                        >
                          {r.created_at ? posDisplayDateTime(new Date(r.created_at)) : "—"}
                        </TableCell>
                        <TableCell>{r.store_code || r.store_id || "—"}</TableCell>
                        <TableCell className="numeric text-right">{r.line_count ?? 0}</TableCell>
                        <TableCell className="numeric text-right">
                          {money(Number(r.total_impact ?? 0))}
                        </TableCell>
                        <TableCell>{r.staff_name || "—"}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {r.posted_by || "—"}
                        </TableCell>
                        <TableCell className="space-x-2 whitespace-nowrap text-right">
                          {recordActions(r)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="transfers">
            <div className="rounded-xl border border-border bg-card p-6 text-sm">
              <p className="font-medium">Branch and cluster transfers</p>
              <p className="mt-1 text-muted-foreground">
                Transfers keep their own in-transit state until the receiving branch confirms.
              </p>
              <Button asChild className="mt-4">
                <Link to="/transfers">Open transfers</Link>
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <StockCountDialog
        open={countOpen}
        draft={resuming}
        targetStore={state.stores.find((store) => store.id === activeCountStoreId) ?? currentStore}
        editGrant={editGrant}
        onOpenChange={(open) => {
          setCountOpen(open);
          if (!open) {
            setResuming(null);
            setEditGrant(null);
            void refresh();
          }
        }}
        onChanged={() => void refresh()}
        onDiscard={(id) => setDiscardTarget(id)}
      />

      <StockRecordView record={viewing} onOpenChange={(open) => !open && setViewing(null)} />

      <AlertDialog open={!!discardTarget} onOpenChange={(open) => !open && setDiscardTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this draft count?</AlertDialogTitle>
            <AlertDialogDescription>
              The counted lines are kept for the audit trail but the draft is closed. No stock
              levels change.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep draft</AlertDialogCancel>
            <AlertDialogAction onClick={() => discardTarget && discardDraft(discardTarget)}>
              Discard draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

export const Route = createFileRoute("/stock-operations")({
  head: () => ({
    meta: [
      { title: "Stock Operations — Retail" },
      {
        name: "description",
        content:
          "Every stock count record with its reference number, plus barcode-driven counting, bulk imports and branch transfers.",
      },
      { property: "og:title", content: "Stock Operations — Retail" },
      {
        property: "og:description",
        content:
          "Reference-numbered stock count records, drafts and posted adjustments in one list.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StockOperationsPage,
});
