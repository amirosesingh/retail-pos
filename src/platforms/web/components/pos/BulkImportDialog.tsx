import { useCallback, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  RotateCcw,
  UploadCloud,
} from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
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
import { usePos } from "@/lib/pos-store";
import {
  DEFAULT_BATCH_SIZE,
  IMPORT_HEADERS,
  describeOutcome,
  importFailureReason,
  outcomeReportRows,
  planImportReview,
  resolveReviewConflict,
  reviewRowToImport,
  updateReviewRow,
  type ImportOutcome,
  type ImportReviewRow,
  type ImportReviewStatus,
  type RejectedRow,
} from "@/lib/product-import";
import { clearRun, findUnfinished, saveRun, type ImportRun } from "@/lib/import-journal";
import { parseProductImportFile } from "./product-import-file";
import { productCodes } from "@/lib/product-lookup";
import { lookupProductsByCodes } from "@/lib/product-search";
import type { Product } from "@/core/types/pos-types";
import { localDb } from "@/core/local-db/local-db";

const TEMPLATE_ROWS = [
  ["8901234500011", "Colombian Whole Bean 1kg", 24, 14.5, "Coffee", "bag", 40, 2],
  ["8901234500028", "Ceramic Pour-Over Dripper", 18.5, 9.25, "Merch", "each", 15, 1],
  ["8901234500035", "Cold Brew Concentrate 500ml", 9.75, 4.4, "Drinks", "bottle", 60, 1],
];

/** Only this many rows are drawn in the preview; a big file must not freeze it. */
const PREVIEW_LIMIT = 100;

const sourceBarcode = (row: Record<string, unknown>) => {
  for (const [header, value] of Object.entries(row)) {
    if (["barcode", "sku", "code"].includes(header.trim().toLowerCase().replace(/\s+/g, "_")))
      return String(value ?? "").trim();
  }
  return "";
};

function templateSheet() {
  const ws = XLSX.utils.aoa_to_sheet([[...IMPORT_HEADERS], ...TEMPLATE_ROWS]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Products");
  return wb;
}

export function BulkImportDialog({
  open,
  onOpenChange,
  mode = "inventory",
  onReceivingRows,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  mode?: "inventory" | "receiving" | "transfer";
  onReceivingRows?: (
    rows: Array<{ product: Product; quantity: number; cost: number; price: number }>,
  ) => void;
}) {
  const { state, currentStore, importProducts } = usePos();
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [busy, setBusy] = useState<"" | "reading" | "saving">("");
  const [rows, setRows] = useState<ImportReviewRow[] | null>(null);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [resume, setResume] = useState<ImportRun | null>(null);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState("");
  const [filter, setFilter] = useState<"all" | ImportReviewStatus>("all");
  const [selected, setSelected] = useState<number[]>([]);
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkUnit, setBulkUnit] = useState("");

  const reset = useCallback(() => {
    setRows(null);
    setProgress(0);
    setProgressLabel("");
    setBusy("");
    setFileName("");
    setResume(null);
    setFilter("all");
    setSelected([]);
    setBulkCategory("");
    setBulkUnit("");
  }, []);

  function downloadTemplate(kind: "xlsx" | "csv") {
    XLSX.writeFile(templateSheet(), `inventory-import-template.${kind}`, { bookType: kind });
  }

  function downloadReport(o: ImportOutcome) {
    const ws = XLSX.utils.aoa_to_sheet(outcomeReportRows(o));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Rows not imported");
    XLSX.writeFile(wb, `import-report-${o.importId.slice(0, 8)}.xlsx`);
  }

  async function handleFile(file: File) {
    setFileName(file.name);
    setBusy("reading");
    setRows(null);
    setOutcome(null);
    setProgress(4);
    setProgressLabel("Reading the file…");

    const records = await parseProductImportFile(file, ({ percent, label }) => {
      setProgress(percent);
      setProgressLabel(label);
    }).catch(() => null);
    if (!records) {
      setBusy("");
      toast.error("Could not read that file — use the .xlsx or .csv template");
      return;
    }

    setProgress(92);
    setProgressLabel(`Checking ${records.length.toLocaleString()} rows against SQL…`);
    await new Promise((r) => setTimeout(r, 0));

    let catalogue: Product[];
    try {
      const local = localDb();
      const localState = await local?.database?.getState?.().catch(() => null);
      catalogue = await lookupProductsByCodes(records.map(sourceBarcode), state.products, {
        // A configured Electron terminal owns a complete SQL Server snapshot
        // and can verify imports offline. Web/mobile must not mistake a partial
        // browser catalogue for the authoritative database.
        allowLocalFallback: Boolean(
          localState?.enabled &&
          localState.connected &&
          (localState.tradingReady ?? localState.connected),
        ),
      });
    } catch (error) {
      setBusy("");
      toast.error(importFailureReason(error));
      return;
    }
    // One pass over the file and the matched catalogue — no per-row queries.
    const plan = planImportReview(records, catalogue, {
      quantityRequired: mode !== "inventory",
    });

    setProgress(100);
    setBusy("");
    setRows(plan.rows);
    setResume(findUnfinished(`${mode}:${file.name}`, currentStore.id) ?? null);
    if (!plan.rows.length) toast.error("No product rows found in that file");
  }

  async function run(continueRun: ImportRun | null) {
    if (!rows?.length) return;
    const readyRows = rows.flatMap((row) => {
      const ready = reviewRowToImport(row);
      return ready ? [ready] : [];
    });
    const attention: RejectedRow[] = rows
      .filter((row) => !reviewRowToImport(row))
      .map((row) => ({
        line: row.line,
        barcode: row.barcode,
        name: row.name,
        reason:
          row.issue ??
          (row.status === "conflict"
            ? `Resolve conflicting ${row.conflictFields.join(", ")}`
            : `Complete ${row.missingFields.join(", ")}`),
      }));
    if (!readyRows.length) {
      toast.error("Complete or resolve at least one row before importing");
      return;
    }
    const importId = continueRun?.importId ?? crypto.randomUUID();
    const startedAt = continueRun?.startedAt ?? new Date().toISOString();
    const done = new Set(continueRun?.done ?? []);
    const total = rows.length;

    setBusy("saving");
    setProgress(0);
    setProgressLabel(
      `${mode === "inventory" ? "Saving" : "Preparing"} ${readyRows.length - done.size} ready products…`,
    );

    try {
      const journal: ImportRun = {
        importId,
        fileName: `${mode}:${fileName}`,
        storeId: currentStore.id,
        startedAt,
        updatedAt: startedAt,
        total,
        created: continueRun?.created ?? 0,
        restocked: continueRun?.restocked ?? 0,
        done: [...done],
        skipped: attention,
        failed: [],
        pending: [],
      };
      saveRun(journal);

      const rowsToSave =
        mode !== "inventory"
          ? readyRows.map((row) => ({ ...row, updateExisting: false }))
          : readyRows;
      const result = await importProducts(rowsToSave, {
        importId,
        batchSize: DEFAULT_BATCH_SIZE,
        alreadyDone: [...done],
        applyStock: mode === "inventory",
        onProgress: (saved, count) => {
          const pct = Math.round((saved / Math.max(1, count)) * 100);
          setProgress(pct);
          setProgressLabel(`Saved ${saved} of ${count} products… ${pct}%`);
        },
        // Written down as each batch lands, so a crash never loses the trail.
        onBatchSaved: (keys, totals) => {
          journal.done.push(...keys);
          journal.created = (continueRun?.created ?? 0) + totals.created;
          journal.restocked = (continueRun?.restocked ?? 0) + totals.restocked;
          saveRun(journal);
        },
      });

      const finished: ImportOutcome = {
        importId,
        fileName,
        startedAt,
        finishedAt: new Date().toISOString(),
        total,
        created: journal.created,
        restocked: journal.restocked,
        skipped: attention,
        failed: result.failed,
        pending: result.pending,
      };
      journal.failed = result.failed;
      journal.pending = result.pending;
      if (!result.failed.length && !result.pending.length) {
        journal.finishedAt = finished.finishedAt;
        saveRun(journal);
        clearRun(importId);
      } else {
        saveRun(journal);
      }

      if (mode !== "inventory" && onReceivingRows) {
        const byCode = new Map<string, Product>();
        result.savedProducts.forEach((product) =>
          productCodes(product).forEach((code) => byCode.set(code, product)),
        );
        const saved = new Set(result.savedKeys);
        onReceivingRows(
          readyRows
            .filter((row) => saved.has(row.key))
            .flatMap((row) => {
              const product = byCode.get(row.key);
              return product
                ? [{ product, quantity: row.stock, cost: row.cost, price: row.price }]
                : [];
            }),
        );
      }
      setOutcome(finished);
      if (result.failed.length || result.pending.length) {
        toast.error(describeOutcome(finished));
      } else {
        toast.success(describeOutcome(finished));
      }
    } catch (error) {
      toast.error(importFailureReason(error));
    } finally {
      setBusy("");
    }
  }

  const counts = (rows ?? []).reduce<Record<ImportReviewStatus, number>>(
    (sum, row) => ({ ...sum, [row.status]: sum[row.status] + 1 }),
    { ready: 0, new_product: 0, missing_information: 0, conflict: 0 },
  );
  const filtered = (rows ?? []).filter((row) => filter === "all" || row.status === filter);
  const preview = filtered.slice(0, PREVIEW_LIMIT);
  const selectedSet = new Set(selected);

  const patchRow = (line: number, patch: Parameters<typeof updateReviewRow>[1]) =>
    setRows(
      (current) =>
        current?.map((row) => (row.line === line ? updateReviewRow(row, patch) : row)) ?? null,
    );

  const applyBulk = () => {
    if (!selected.length) return toast.error("Select rows to update first");
    if (!bulkCategory.trim() && !bulkUnit.trim())
      return toast.error("Enter a category or unit to apply");
    setRows(
      (current) =>
        current?.map((row) =>
          selectedSet.has(row.line)
            ? updateReviewRow(row, {
                ...(bulkCategory.trim() ? { category: bulkCategory.trim() } : {}),
                ...(bulkUnit.trim() ? { unit: bulkUnit.trim() } : {}),
              })
            : row,
        ) ?? null,
    );
  };

  return (
    <>
      <Dialog
        open={open && !outcome}
        onOpenChange={(o) => {
          if (busy) return; // never close mid-save
          if (!o) reset();
          onOpenChange(o);
        }}
      >
        <DialogContent className="max-h-[92vh] max-w-[min(96vw,90rem)] overflow-hidden">
          <DialogHeader>
            <DialogTitle>
              {mode === "receiving"
                ? "Import receiving lines"
                : mode === "transfer"
                  ? "Import transfer lines"
                  : "Bulk import from Excel / CSV"}
            </DialogTitle>
            <DialogDescription>
              {mode === "receiving"
                ? "Known products are linked to the invoice. New products are created with zero stock; quantities post only when the invoice is finalized."
                : mode === "transfer"
                  ? "Known products are added to the transfer. Complete missing product details here; stock moves only after the transfer is approved, dispatched and received."
                  : `Rows are added to ${currentStore.name}. Matching barcodes top up existing stock.`}
            </DialogDescription>
          </DialogHeader>

          {!rows && !busy && (
            <>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) void handleFile(f);
                }}
                onClick={() => inputRef.current?.click()}
                className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
                  dragging ? "border-success bg-success/10" : "border-border bg-surface-2"
                }`}
              >
                <UploadCloud className="size-8 text-muted-foreground" />
                <p className="text-sm font-medium">
                  Drag &amp; drop your{" "}
                  {mode === "inventory"
                    ? "store inventory"
                    : mode === "receiving"
                      ? "supplier"
                      : "transfer"}{" "}
                  spreadsheet (.xlsx, .csv) here
                </p>
                <p className="text-xs text-muted-foreground">or click to browse your files</p>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleFile(f);
                    e.target.value = "";
                  }}
                />
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => downloadTemplate("xlsx")}
                  className="text-xs text-primary underline-offset-4 hover:underline"
                >
                  Download Excel template (.xlsx)
                </button>
                <button
                  onClick={() => downloadTemplate("csv")}
                  className="text-xs text-primary underline-offset-4 hover:underline"
                >
                  Download CSV template
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Expected headers: {IMPORT_HEADERS.join(" · ")}
              </p>
            </>
          )}

          {busy && (
            <div className="space-y-2">
              <p className="flex items-center gap-2 text-sm text-success">
                <FileSpreadsheet className="size-4" /> {progressLabel}
              </p>
              <Progress value={progress} className="h-2 [&>div]:bg-success" />
              <p className="text-[11px] text-muted-foreground">
                Keep this window open — progress is written down as it goes, so an interruption
                never loses what was already saved.
              </p>
            </div>
          )}

          {rows && !busy && (
            <div className="min-h-0 space-y-3 overflow-hidden">
              <p className="text-xs text-muted-foreground">
                {fileName} · {rows.length.toLocaleString()} product rows ·{" "}
                {(counts.ready + counts.new_product).toLocaleString()} ready ·{" "}
                {(counts.missing_information + counts.conflict).toLocaleString()} require attention
              </p>

              {resume && (
                <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                  An earlier run of this file stopped after {resume.done.length} rows. Continue and
                  only the remaining {Math.max(0, rows.length - resume.done.length)} are saved —
                  nothing is created twice.
                </div>
              )}

              <div className="flex flex-wrap gap-2" role="group" aria-label="Import row filters">
                {(
                  [
                    ["all", "All", rows.length],
                    ["ready", "Ready", counts.ready],
                    ["new_product", "New products", counts.new_product],
                    ["missing_information", "Missing information", counts.missing_information],
                    ["conflict", "Conflicts", counts.conflict],
                  ] as const
                ).map(([value, label, count]) => (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant={filter === value ? "default" : "outline"}
                    onClick={() => setFilter(value)}
                  >
                    {label} <span className="numeric opacity-70">{count.toLocaleString()}</span>
                  </Button>
                ))}
              </div>

              <div className="grid gap-2 rounded-md border border-border bg-surface-2 p-2 sm:grid-cols-[1fr_1fr_auto]">
                <Input
                  value={bulkCategory}
                  onChange={(event) => setBulkCategory(event.target.value)}
                  placeholder="Category for selected rows"
                />
                <Input
                  value={bulkUnit}
                  onChange={(event) => setBulkUnit(event.target.value)}
                  placeholder="Unit for selected rows"
                />
                <Button type="button" variant="outline" onClick={applyBulk}>
                  Apply to {selected.length || "selected"}
                </Button>
              </div>

              <div className="max-h-[48vh] overflow-auto rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-9">
                        <Checkbox
                          aria-label="Select visible rows"
                          checked={
                            preview.length > 0 && preview.every((row) => selectedSet.has(row.line))
                          }
                          onCheckedChange={(checked) =>
                            setSelected((current) => {
                              const next = new Set(current);
                              preview.forEach((row) =>
                                checked ? next.add(row.line) : next.delete(row.line),
                              );
                              return [...next];
                            })
                          }
                        />
                      </TableHead>
                      <TableHead>Barcode / SKU</TableHead>
                      <TableHead>Product name</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead className="text-right">Stock</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Resolve</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.map((r) => (
                      <TableRow
                        key={`${r.key}-${r.line}`}
                        className={`data-row-lazy ${
                          r.status === "missing_information" || r.status === "conflict"
                            ? "bg-warning/5"
                            : ""
                        }`}
                      >
                        <TableCell>
                          <Checkbox
                            aria-label={`Select row ${r.line}`}
                            checked={selectedSet.has(r.line)}
                            onCheckedChange={(checked) =>
                              setSelected((current) =>
                                checked
                                  ? [...new Set([...current, r.line])]
                                  : current.filter((line) => line !== r.line),
                              )
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            className="numeric h-8 min-w-32"
                            value={r.barcode}
                            aria-invalid={r.missingFields.includes("barcode")}
                            onChange={(event) => patchRow(r.line, { barcode: event.target.value })}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            className="h-8 min-w-44"
                            value={r.name}
                            aria-invalid={
                              r.missingFields.includes("name") || r.conflictFields.includes("name")
                            }
                            onChange={(event) => patchRow(r.line, { name: event.target.value })}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            className="h-8 min-w-32"
                            value={r.category}
                            aria-invalid={r.conflictFields.includes("category")}
                            onChange={(event) => patchRow(r.line, { category: event.target.value })}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            className="h-8 w-24"
                            value={r.unit}
                            aria-invalid={r.conflictFields.includes("unit")}
                            onChange={(event) => patchRow(r.line, { unit: event.target.value })}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            className="numeric h-8 w-24 text-right"
                            inputMode="decimal"
                            value={r.price ?? ""}
                            aria-invalid={
                              r.missingFields.includes("price") ||
                              r.conflictFields.includes("price")
                            }
                            onChange={(event) =>
                              patchRow(r.line, {
                                price:
                                  event.target.value === "" ? null : Number(event.target.value),
                              })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            className="numeric h-8 w-24 text-right"
                            inputMode="decimal"
                            value={r.cost ?? ""}
                            aria-invalid={
                              r.missingFields.includes("cost") || r.conflictFields.includes("cost")
                            }
                            onChange={(event) =>
                              patchRow(r.line, {
                                cost: event.target.value === "" ? null : Number(event.target.value),
                              })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            className="numeric h-8 w-20 text-right"
                            inputMode="numeric"
                            value={r.stock}
                            aria-invalid={r.missingFields.includes("stock")}
                            onChange={(event) =>
                              patchRow(r.line, { stock: Number(event.target.value) })
                            }
                          />
                        </TableCell>
                        <TableCell className="min-w-36">
                          <Badge
                            variant={
                              r.status === "ready" || r.status === "new_product"
                                ? "outline"
                                : "secondary"
                            }
                          >
                            {r.status === "ready"
                              ? "Validated"
                              : r.status === "new_product"
                                ? "New product · Ready"
                                : r.status === "missing_information"
                                  ? "Information required"
                                  : "Conflict"}
                          </Badge>
                          {(r.issue ||
                            r.missingFields.length > 0 ||
                            r.conflictFields.length > 0) && (
                            <p className="mt-1 max-w-52 text-[11px] text-warning">
                              {r.issue ??
                                (r.missingFields.length
                                  ? `Complete: ${r.missingFields.join(", ")}`
                                  : `Check: ${r.conflictFields.join(", ")}`)}
                            </p>
                          )}
                        </TableCell>
                        <TableCell>
                          {r.status === "conflict" && r.existingProduct ? (
                            <div className="flex min-w-48 gap-1">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setRows(
                                    (current) =>
                                      current?.map((row) =>
                                        row.line === r.line
                                          ? resolveReviewConflict(row, "database")
                                          : row,
                                      ) ?? null,
                                  )
                                }
                              >
                                Use database
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setRows(
                                    (current) =>
                                      current?.map((row) =>
                                        row.line === r.line
                                          ? resolveReviewConflict(row, "import")
                                          : row,
                                      ) ?? null,
                                  )
                                }
                              >
                                Use import
                              </Button>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {r.existingProductId ? "Update stock" : "Create product"}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {filtered.length > PREVIEW_LIMIT && (
                <p className="text-[11px] text-muted-foreground">
                  Showing the first {PREVIEW_LIMIT.toLocaleString()} of{" "}
                  {filtered.length.toLocaleString()} filtered rows. Ready rows outside the preview
                  are still processed.
                </p>
              )}

              <div className="flex justify-between gap-2">
                <Button variant="outline" onClick={reset}>
                  Choose another file
                </Button>
                <Button
                  className="bg-success text-background hover:bg-success/90"
                  disabled={counts.ready + counts.new_product === 0}
                  onClick={() => void run(resume)}
                >
                  <Download className="size-4" />
                  {resume
                    ? "Continue import"
                    : mode !== "inventory"
                      ? `Add ${(counts.ready + counts.new_product).toLocaleString()} ready lines`
                      : `Import ${(counts.ready + counts.new_product).toLocaleString()} ready items`}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Import result — every row accounted for */}
      <Dialog
        open={!!outcome}
        onOpenChange={(o) => {
          if (!o) {
            setOutcome(null);
            reset();
            onOpenChange(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import result</DialogTitle>
          </DialogHeader>
          {outcome && (
            <div className="space-y-3 text-sm">
              <p className="flex items-center gap-2 text-success">
                <CheckCircle2 className="size-4" />
                {describeOutcome(outcome)}
              </p>
              <ul className="space-y-1 text-muted-foreground">
                <li className="numeric">Rows in the file: {outcome.total}</li>
                <li className="numeric">New products created: {outcome.created}</li>
                <li className="numeric">
                  Existing products {mode === "inventory" ? "restocked" : "matched"}:{" "}
                  {outcome.restocked}
                </li>
                <li className="numeric">Skipped: {outcome.skipped.length}</li>
                <li className="numeric">Failed: {outcome.failed.length}</li>
                <li className="numeric">Still pending: {outcome.pending.length}</li>
              </ul>

              {(outcome.skipped.length > 0 ||
                outcome.failed.length > 0 ||
                outcome.pending.length > 0) && (
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  <p className="flex items-center gap-1 font-semibold">
                    <AlertTriangle className="size-3.5" /> Not saved
                  </p>
                  {[...outcome.skipped, ...outcome.failed, ...outcome.pending]
                    .slice(0, 8)
                    .map((e) => (
                      <p key={`${e.line}-${e.reason}`}>
                        Row {e.line} ({e.barcode}): {e.reason}
                      </p>
                    ))}
                  {outcome.skipped.length + outcome.failed.length + outcome.pending.length > 8 && (
                    <p>
                      +{outcome.skipped.length + outcome.failed.length + outcome.pending.length - 8}{" "}
                      more in the report
                    </p>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                {outcome.skipped.length + outcome.failed.length + outcome.pending.length > 0 && (
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => downloadReport(outcome)}
                  >
                    <RotateCcw className="size-4" /> Download row report
                  </Button>
                )}
                <Button
                  className="flex-1"
                  onClick={() => {
                    setOutcome(null);
                    reset();
                    onOpenChange(false);
                  }}
                >
                  Done
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
