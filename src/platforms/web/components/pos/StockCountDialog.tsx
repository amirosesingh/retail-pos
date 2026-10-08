/**
 * Physical count workspace, in a dialog.
 *
 * Scan (or type) a code, enter the physical count, press Enter: the row lands
 * in a PO-style review queue with the variance and its cost impact, and focus
 * snaps straight back to the punch bar for the next item.
 *
 * The queue is the draft. The first counted line mints the record — id and
 * reference together — and every later change re-saves that same row, whether
 * the change is auto-saved after a pause or saved by hand from the button.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScanBarcode, Trash2, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ThemedSelect } from "@/platforms/web/components/pos/ThemedSelect";
import { useAuth } from "@/lib/pos-auth";
import { db } from "@/core/api/pos-db";
import { localTerminalId } from "@/lib/shift-hours";
import { money, stockAt, usePos } from "@/lib/pos-store";
import { resolveByBarcode } from "@/lib/product-lookup";
import { nextStockRef } from "@/lib/stock-ref";
import { saveRecordEditHistory, type EditGrant } from "@/lib/record-edit-flow";
import {
  STOCK_ADJUSTMENT_REASONS,
  type StockAdjustmentReason,
  type Store,
} from "@/core/types/pos-types";

export type CountRow = {
  productId: string;
  name: string;
  sku: string;
  category: string;
  subCategory: string;
  system: number;
  counted: number;
  cost: number;
};

export type StockRecordRow = {
  id: string;
  reference: string | null;
  store_id: string | null;
  store_code: string | null;
  staff_name: string | null;
  status: string;
  reason: string | null;
  note: string | null;
  lines: string | null;
  line_count: number | null;
  total_impact: number | null;
  pending_edit_request_id: string | null;
  pending_edit_by: string | null;
  pending_edit_at: string | null;
  posted_at: string | null;
  posted_by: string | null;
  updated_at: string | null;
  created_at: string | null;
};

export const parseLines = (raw: unknown): CountRow[] => {
  if (Array.isArray(raw)) return raw as CountRow[];
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CountRow[]) : [];
  } catch {
    return [];
  }
};

export function ReviewTable({
  rows,
  onRemove,
}: {
  rows: CountRow[];
  onRemove?: (id: string) => void;
}) {
  if (!rows.length) {
    return (
      <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Nothing queued yet.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>SKU</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Sub-category</TableHead>
            <TableHead className="text-right">System</TableHead>
            <TableHead className="text-right">Counted</TableHead>
            <TableHead className="text-right">Delta</TableHead>
            <TableHead className="text-right">Unit cost</TableHead>
            <TableHead className="text-right">Impact</TableHead>
            {onRemove && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const delta = r.counted - r.system;
            return (
              <TableRow key={r.productId}>
                <TableCell className="numeric">{r.sku || "—"}</TableCell>
                <TableCell>{r.name}</TableCell>
                <TableCell className="text-muted-foreground">{r.category || "—"}</TableCell>
                <TableCell className="text-muted-foreground">{r.subCategory || "—"}</TableCell>
                <TableCell className="numeric text-right">{r.system}</TableCell>
                <TableCell className="numeric text-right">{r.counted}</TableCell>
                <TableCell className="text-right">
                  <Badge
                    variant="outline"
                    className={`numeric ${
                      delta > 0
                        ? "border-success/40 text-success"
                        : delta < 0
                          ? "border-destructive/40 text-destructive"
                          : "text-muted-foreground"
                    }`}
                  >
                    {delta > 0 ? `+${delta}` : delta}
                  </Badge>
                </TableCell>
                <TableCell className="numeric text-right">{money(r.cost)}</TableCell>
                <TableCell className="numeric text-right">{money(delta * r.cost)}</TableCell>
                {onRemove && (
                  <TableCell className="text-right">
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Remove ${r.name}`}
                      onClick={() => onRemove(r.productId)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export function StockCountDialog({
  open,
  draft,
  targetStore,
  onOpenChange,
  onChanged,
  onDiscard,
  editGrant,
}: {
  open: boolean;
  /** A draft being resumed, or null for a fresh count. */
  draft?: StockRecordRow | null;
  /** Locked destination; later branch switches cannot redirect this count. */
  targetStore: Store;
  /** Set when a *posted* record was reopened under authorisation. */
  editGrant?: EditGrant | null;
  onOpenChange: (open: boolean) => void;
  /** Fires whenever the record list should be refreshed. */
  onChanged: () => void;
  /** Ask the page to confirm discarding this draft. */
  onDiscard: (id: string) => void;
}) {
  const { state, applyStockCount } = usePos();
  const { user } = useAuth();
  const products = state.products;
  const numbering = useMemo(
    () => state.settings.integrations.stockNumbering ?? {},
    [state.settings.integrations.stockNumbering],
  );

  const [code, setCode] = useState("");
  const [counted, setCounted] = useState("");
  const [rows, setRows] = useState<CountRow[]>([]);
  const [reason, setReason] = useState<StockAdjustmentReason | "">("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [tab, setTab] = useState("count");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [posting, setPosting] = useState(false);
  const postingRef = useRef(false);
  const codeRef = useRef<HTMLInputElement>(null);
  const countRef = useRef<HTMLInputElement>(null);
  const draftCreatedAt = useRef<string | null>(null);
  const draftIdentityPromiseRef = useRef<Promise<{ id: string; ref: string | null }> | null>(null);
  const draftIdentityRef = useRef<{ id: string; ref: string | null } | null>(null);
  const saveTailRef = useRef<Promise<void>>(Promise.resolve());
  const saveSequenceRef = useRef(0);
  const sessionRef = useRef(0);
  const postingAttemptRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const match = useMemo(() => resolveByBarcode(products, code), [products, code]);
  const totalImpact = rows.reduce((s, r) => s + (r.counted - r.system) * r.cost, 0);

  /** Load the dialog for a fresh count, or for the draft being resumed. */
  useEffect(() => {
    if (!open) return;
    sessionRef.current += 1;
    setCode("");
    setCounted("");
    setErrors([]);
    setTab("count");
    setDirty(false);
    postingAttemptRef.current =
      draft?.status === "posted" ? (editGrant?.requestId ?? crypto.randomUUID()) : null;
    if (draft) {
      const saved = parseLines(draft.lines);
      let moved = 0;
      const restored = saved.map((line) => {
        const product = products.find((p: (typeof products)[number]) => p.id === line.productId);
        const system = product ? stockAt(product, targetStore.id) : line.system;
        if (system !== line.system) moved += 1;
        return { ...line, system, cost: product?.cost ?? line.cost };
      });
      draftCreatedAt.current = draft.created_at ?? new Date().toISOString();
      setDraftId(draft.id);
      setReference(draft.reference ?? null);
      draftIdentityRef.current = { id: draft.id, ref: draft.reference ?? null };
      setRows(restored);
      setReason((draft.reason as StockAdjustmentReason) ?? "");
      setNote(draft.note ?? "");
      setSavedAt(draft.updated_at ?? null);
      if (moved)
        toast.info(
          `${moved} item${moved === 1 ? "'s" : "s'"} system stock changed since this draft was saved.`,
        );
    } else {
      draftCreatedAt.current = null;
      setDraftId(null);
      setReference(null);
      draftIdentityRef.current = null;
      setRows([]);
      setReason("");
      setNote("");
      setSavedAt(null);
    }
    // Only re-initialise when the dialog opens on a different record.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft?.id]);

  /**
   * The single write path. Auto-save and the Save draft button both call this,
   * and the promise tail serializes overlapping snapshots. Every scan that
   * lands while SQL/cloud is busy gets a later save instead of being mistaken
   * for the older in-flight write.
   */
  const persistDraft = useCallback(async (): Promise<{ id: string; ref: string | null } | null> => {
    if (!rows.length && !draftId) return Promise.resolve(null);
    let identity = draftIdentityRef.current;
    if (!identity) {
      if (!draftIdentityPromiseRef.current) {
        const id = draftId ?? crypto.randomUUID();
        draftIdentityPromiseRef.current = (async () => {
          const ref = reference ?? await nextStockRef(numbering, targetStore.code || targetStore.id);
          const created = { id, ref };
          draftIdentityRef.current = created;
          draftCreatedAt.current ??= new Date().toISOString();
          setDraftId(id); setReference(ref);
          return created;
        })();
      }
      try { identity = await draftIdentityPromiseRef.current; }
      finally { draftIdentityPromiseRef.current = null; }
    }
    const { id, ref } = identity;
    const snapshot = {
      reason: reason || null,
      note,
      lines: rows,
      totalImpact: rows.reduce((s, r) => s + (r.counted - r.system) * r.cost, 0),
      createdAt: draftCreatedAt.current ?? new Date().toISOString(),
    };
    const sequence = ++saveSequenceRef.current;
    const session = sessionRef.current;
    const run = saveTailRef.current
      .catch(() => undefined)
      .then(async () => {
        await db.saveStockCountDraft({
          id,
          reference: ref,
          storeId: targetStore.id,
          storeCode: targetStore.code ?? null,
          terminalId: localTerminalId(),
          staffId: user?.staffId ?? null,
          staffName: user?.name ?? null,
          status: "draft",
          ...snapshot,
        });
        if (session === sessionRef.current) {
          setSavedAt(new Date().toISOString());
          if (sequence === saveSequenceRef.current) setDirty(false);
          onChanged();
        }
        return { id, ref };
      });
    saveTailRef.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }, [rows, reason, note, draftId, reference, numbering, targetStore, user, onChanged]);

  /** Auto-save: the same write, after the counter pauses. */
  useEffect(() => {
    if (!open) return;
    if (draft?.status === "posted") return;
    if (!rows.length && !draftId) return;
    setDirty(true);
    timerRef.current = setTimeout(() => {
      void persistDraft().catch((error) => {
        setDirty(true);
        toast.error(
          error instanceof Error ? error.message : "Stock-count draft could not be saved.",
        );
      });
    }, 800);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [rows, reason, note, open, draftId, draft?.status, persistDraft]);

  const saveNow = async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    try {
      const saved = await persistDraft();
      if (saved) toast.success(saved.ref ? `Draft ${saved.ref} saved.` : "Draft saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Stock-count draft could not be saved.");
    }
  };

  /** A close waits for the newest draft snapshot instead of cancelling it. */
  const changeOpen = (nextOpen: boolean) => {
    if (nextOpen || postingRef.current || draft?.status === "posted" || !dirty) {
      onOpenChange(nextOpen);
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    void persistDraft()
      .then(() => onOpenChange(false))
      .catch((error) => {
        setDirty(true);
        toast.error(
          error instanceof Error
            ? error.message
            : "The latest stock-count changes could not be saved.",
        );
      });
  };

  const queue = (productId: string, qty: number) => {
    const p = products.find((x: (typeof products)[number]) => x.id === productId);
    if (!p) return;
    setRows((prev) => {
      const row: CountRow = {
        productId: p.id,
        name: p.name,
        sku: p.sku ?? "",
        category: p.category ?? "",
        subCategory: p.subCategory ?? "",
        system: stockAt(p, targetStore.id),
        counted: Math.max(0, Math.round(qty)),
        cost: p.cost ?? 0,
      };
      const idx = prev.findIndex((r) => r.productId === p.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = row;
        return next;
      }
      return [row, ...prev];
    });
  };

  const commitPunch = () => {
    if (!match) {
      toast.warning("No product matches that code.");
      codeRef.current?.select();
      return;
    }
    const qty = Number(counted);
    if (!counted.trim() || Number.isNaN(qty) || qty < 0) {
      toast.warning("Enter the physical counted quantity.");
      countRef.current?.focus();
      return;
    }
    queue(match.id, qty);
    setCode("");
    setCounted("");
    codeRef.current?.focus();
  };

  const post = async () => {
    if (postingRef.current) return;
    if (!reason) {
      toast.warning("Choose a reason before posting this count.");
      return;
    }
    const entries = rows
      .filter((r) => r.counted !== r.system)
      .map((r) => ({ productId: r.productId, counted: r.counted }));
    if (!entries.length) {
      toast.warning("Nothing to post — every counted quantity matches the system.");
      return;
    }
    postingRef.current = true;
    setPosting(true);
    try {
      if (timerRef.current) clearTimeout(timerRef.current);
      // What the record looked like before this posting, kept for the audit
      // trail whenever an already-posted count is being corrected.
      const before =
        draft?.status === "posted"
          ? {
              reason: draft.reason ?? "",
              note: draft.note ?? "",
              lines: parseLines(draft.lines),
              lineCount: draft.line_count ?? 0,
              totalImpact: Number(draft.total_impact ?? 0),
              postedAt: draft.posted_at,
              postedBy: draft.posted_by,
            }
          : null;
      const saved = draft?.status === "posted" ? null : await persistDraft();
      const persistedDraftId = saved?.id ?? draftId;
      const adjustmentAttemptId =
        draft?.status === "posted"
          ? (postingAttemptRef.current ??= editGrant?.requestId ?? crypto.randomUUID())
          : persistedDraftId;
      await applyStockCount(
        entries,
        reason,
        note,
        targetStore.id,
        persistedDraftId,
        user?.name ?? null,
        { lines: rows, totalImpact },
        adjustmentAttemptId,
      );
      if (before && draftId) {
        const deltas: Record<string, number> = {};
        for (const r of rows) {
          if (r.counted !== r.system) deltas[r.productId] = r.counted - r.system;
        }
        await saveRecordEditHistory({
          kind: "stock_count",
          recordId: draftId,
          ...(reference ? { reference } : {}),
          storeId: draft?.store_id ?? targetStore.id,
          actionKey: "edit_posted_stock",
          grant: editGrant ?? null,
          before,
          after: {
            reason,
            note,
            lines: rows,
            lineCount: rows.length,
            totalImpact: Number(
              rows.reduce((a, r) => a + (r.counted - r.system) * r.cost, 0).toFixed(2),
            ),
          },
          stockDeltas: deltas,
        });
      }
      toast.success(
        `${entries.length} item${entries.length === 1 ? "" : "s"} adjusted${reference ? ` · ${reference}` : ""}.`,
      );
      onChanged();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Stock count could not be posted.");
    } finally {
      postingRef.current = false;
      setPosting(false);
    }
  };

  const importFile = async (file: File) => {
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const sheetName = wb.SheetNames[0];
      if (!sheetName) throw new Error("empty");
      const sheet = wb.Sheets[sheetName];
      if (!sheet) throw new Error("empty");
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
      const problems: string[] = [];
      raw.forEach((r, i) => {
        const key = String(r["barcode"] ?? r["sku"] ?? r["code"] ?? "").trim();
        const qty = Number(r["counted"] ?? r["quantity"] ?? r["qty"]);
        if (!key) return problems.push(`Row ${i + 2}: no barcode or SKU`);
        const p = resolveByBarcode(products, key);
        if (!p) return problems.push(`Row ${i + 2}: "${key}" is not in the catalogue`);
        if (Number.isNaN(qty) || qty < 0)
          return problems.push(`Row ${i + 2}: invalid counted quantity`);
        queue(p.id, qty);
      });
      setErrors(problems);
      toast.success(`Imported ${raw.length - problems.length} row(s).`);
    } catch {
      toast.error("That file could not be read. Use .xlsx or .csv.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[92vh] w-[min(96vw,1100px)] max-w-none overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {draft?.status === "posted"
              ? "Edit posted stock count"
              : draft
                ? "Resume stock count"
                : "New stock count"}
            {reference ? <span className="ml-2 font-mono text-sm">{reference}</span> : null}
          </DialogTitle>
          <DialogDescription>
            Writing to {targetStore.code || targetStore.id} · {targetStore.name}. This branch is
            locked for the count; nothing changes stock until it is posted.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="space-y-4">
          <TabsList>
            <TabsTrigger value="count">
              <ScanBarcode className="mr-2 size-4" /> Physical count
            </TabsTrigger>
            <TabsTrigger value="import">
              <UploadCloud className="mr-2 size-4" /> Bulk import
            </TabsTrigger>
          </TabsList>

          <TabsContent value="count" className="space-y-4">
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="grid gap-3 sm:grid-cols-[2fr_1fr_auto]">
                <div>
                  <Label htmlFor="so-code">Scan or type a barcode / SKU</Label>
                  <Input
                    id="so-code"
                    ref={codeRef}
                    autoFocus
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (match) countRef.current?.focus();
                        else toast.warning("No product matches that code.");
                      }
                    }}
                    placeholder="Scanner input lands here"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {match
                      ? `${match.name} · system stock ${stockAt(match, targetStore.id)}`
                      : "Waiting for a scan…"}
                  </p>
                </div>
                <div>
                  <Label htmlFor="so-count">Physical counted qty</Label>
                  <Input
                    id="so-count"
                    ref={countRef}
                    inputMode="numeric"
                    value={counted}
                    onChange={(e) => setCounted(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitPunch();
                      }
                    }}
                    placeholder="0"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {match && counted.trim() && !Number.isNaN(Number(counted))
                      ? `Delta ${Number(counted) - stockAt(match, targetStore.id) >= 0 ? "+" : ""}${
                          Number(counted) - stockAt(match, targetStore.id)
                        }`
                      : "Press Enter to queue"}
                  </p>
                </div>
                <div className="flex items-end">
                  <Button onClick={commitPunch}>Add to queue</Button>
                </div>
              </div>
            </div>

            {draftId && draft?.status !== "posted" && (
              <p className="text-xs text-muted-foreground">
                Draft saved automatically
                {savedAt ? ` · last saved ${new Date(savedAt).toLocaleTimeString()}` : ""}
              </p>
            )}

            <ReviewTable
              rows={rows}
              onRemove={(id) => setRows((p) => p.filter((r) => r.productId !== id))}
            />
          </TabsContent>

          <TabsContent value="import" className="space-y-4">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const file = e.dataTransfer.files[0];
                if (file) void importFile(file);
              }}
              className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-10 text-center ${
                dragging ? "border-primary bg-primary/5" : "border-border"
              }`}
            >
              <UploadCloud className="size-8 text-muted-foreground" />
              <p className="text-sm">Drop an .xlsx or .csv with columns barcode/sku and counted.</p>
              <label className="cursor-pointer text-sm text-primary underline">
                or choose a file
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void importFile(file);
                  }}
                />
              </label>
            </div>
            {errors.length > 0 && (
              <ul className="space-y-1 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
            <ReviewTable
              rows={rows}
              onRemove={(id) => setRows((p) => p.filter((r) => r.productId !== id))}
            />
          </TabsContent>
        </Tabs>

        <div className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-[220px_1fr_auto]">
          <div>
            <Label>Reason</Label>
            <ThemedSelect
              value={reason}
              onChange={(v) => setReason(v as StockAdjustmentReason)}
              options={STOCK_ADJUSTMENT_REASONS.map((r) => ({ value: r.value, label: r.label }))}
              ariaLabel="Adjustment reason"
            />
          </div>
          <div>
            <Label htmlFor="so-note">Note</Label>
            <Textarea
              id="so-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional context for the audit trail"
            />
          </div>
          <div className="flex flex-wrap items-end justify-end gap-3">
            <span className="numeric text-sm text-muted-foreground">
              Impact {money(totalImpact)}
            </span>
            {draft?.status !== "posted" && (
              <Button variant="outline" onClick={saveNow} disabled={!rows.length || !dirty}>
                Save draft
              </Button>
            )}
            {draftId && draft?.status !== "posted" && (
              <Button variant="outline" onClick={() => onDiscard(draftId)}>
                Discard draft
              </Button>
            )}
            <Button onClick={post} disabled={!rows.length || posting}>
              Post adjustments
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
