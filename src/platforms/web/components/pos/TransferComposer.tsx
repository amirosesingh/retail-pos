/**
 * The full-window basket used to raise a stock request or a direct transfer.
 *
 * It is deliberately one component for both: the only real difference is
 * which branch is the source and which is the destination, so the wording
 * and the direction flip on `kind` while the picking, the spreadsheet import
 * and the stock figures stay identical.
 */
import { useMemo, useRef, useState } from "react";
import { Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { ProductPicker } from "@/platforms/web/components/pos/ProductPicker";
import { Fact, Panel } from "@/platforms/web/components/pos/TransferWorkspace";
import { stockAt, usePos } from "@/lib/pos-store";
import { availableAt, planDeduction, subWarehouses } from "@/lib/locations";
import { branchPolicy } from "@/lib/branch-policy";
import { groupOf, normalizeTransferQuantity, scopeBetween } from "@/lib/stock-transfers";
import { groupName, useStoreGroups } from "@/lib/store-groups";
import type { TransferItem, TransferKind } from "@/core/types/pos-types";
import { TablePagination, usePagination } from "@/platforms/web/components/pos/TablePagination";
import { BulkImportDialog } from "@/platforms/web/components/pos/BulkImportDialog";

export type ComposerResult = {
  otherStoreId: string;
  items: { productId: string; qty: number }[];
  note: string;
};

export function TransferComposer({
  kind,
  submitLabel,
  initialProductIds,
  onSubmit,
}: {
  kind: TransferKind;
  submitLabel: string;
  /** basket handed over from another page, one unit per product */
  initialProductIds?: string[];
  onSubmit: (result: ComposerResult) => void | Promise<void>;
}) {
  const { state, stores, allStores, currentStore, moveStock } = usePos();
  const others = useMemo(
    () =>
      stores.filter(
        (s) => s.id !== currentStore.id && branchPolicy(state.settings, s.id).allowTransfers,
      ),
    [stores, currentStore.id, state.settings],
  );

  const [otherStoreId, setOtherStoreId] = useState(others[0]?.id ?? "");
  const [items, setItems] = useState<TransferItem[]>(() =>
    (initialProductIds ?? []).map((productId) => ({ productId, qty: 1 })),
  );
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const submittingRef = useRef(false);

  const otherStore = stores.find((s) => s.id === otherStoreId);
  const productOf = (id: string) => state.products.find((p) => p.id === id) ?? null;
  const sourceStoreId = kind === "transfer" ? currentStore.id : otherStoreId;
  const sourceLevels = subWarehouses(allStores, currentStore.id);
  const crossGroup =
    Boolean(otherStoreId) && scopeBetween(currentStore, otherStore) === "INTER_GROUP";
  const groups = useStoreGroups();

  function addItem(productId: string, amount = 1) {
    const add = Math.max(1, Math.round(amount) || 1);
    setItems((prev) =>
      prev.some((i) => i.productId === productId)
        ? prev.map((i) => (i.productId === productId ? { ...i, qty: i.qty + add } : i))
        : [...prev, { productId, qty: add }],
    );
  }

  async function submit() {
    if (submittingRef.current) return;
    const clean = items
      .map((i) => ({ productId: i.productId, qty: Math.floor(Number(i.qty) || 0) }))
      .filter((i) => i.qty > 0);
    if (!clean.length || !otherStoreId) {
      toast.error("Add at least one product with a quantity, and pick a store");
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      if (kind === "transfer") {
        // With sub-warehouse levels the check — and the pick — spans every level.
        for (const i of clean) {
          const p = productOf(i.productId);
          const plan = p ? planDeduction(p, allStores, currentStore.id, i.qty) : null;
          if (!p || !plan || plan.shortBy > 0) {
            toast.error(
              `Short by ${plan?.shortBy ?? i.qty} × ${p?.name ?? "item"} at ${currentStore.name}`,
              { description: "Nothing has been moved. Reduce the quantity or restock first." },
            );
            return;
          }
        }
        // Consolidate the picked levels into the sending location so the
        // dispatch deduction leaves the right shelf empty.
        if (sourceLevels.length)
          for (const i of clean) {
            const p = productOf(i.productId);
            if (!p) continue;
            for (const pick of planDeduction(p, allStores, currentStore.id, i.qty).picks) {
              if (pick.storeId === currentStore.id) continue;
              await moveStock(i.productId, pick.qty, pick.storeId, currentStore.id);
            }
          }
      }
      await onSubmit({ otherStoreId, items: clean, note });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "The stock movement could not be saved.",
      );
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const totalUnits = items.reduce((a, i) => a + (Number(i.qty) || 0), 0);
  const linePagination = usePagination(items, 25);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <Fact
          label={kind === "request" ? "Requesting branch" : "Sending branch"}
          value={`${currentStore.code} · ${currentStore.name}`}
        />
        <Fact
          label={kind === "request" ? "Supplying branch" : "Destination branch"}
          value={otherStore ? `${otherStore.code} · ${otherStore.name}` : "Not chosen"}
        />
        <Fact label="Cluster" value={`${groupOf(currentStore)} → ${groupOf(otherStore)}`} />
        <Fact label="Lines · units" value={`${items.length} · ${totalUnits}`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,620px)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Panel title="Add products" description="Scan a barcode, or search by name / SKU.">
            <ProductPicker
              products={state.products}
              storeId={sourceStoreId || currentStore.id}
              storeCode={stores.find((s) => s.id === sourceStoreId)?.code}
              destinationStoreId={kind === "transfer" ? otherStoreId : currentStore.id}
              destinationStoreCode={kind === "transfer" ? otherStore?.code : currentStore.code}
              onPick={(p, qty) => addItem(p.id, qty)}
            />

            <div className="flex flex-wrap items-center gap-2 pt-3">
              <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                <Upload className="size-3.5" /> Import Excel / CSV
              </Button>
            </div>
          </Panel>

          <Panel title={kind === "request" ? "Supplying branch" : "Destination branch"}>
            <Select value={otherStoreId} onValueChange={setOtherStoreId}>
              <SelectTrigger>
                <SelectValue placeholder="Select store" />
              </SelectTrigger>
              <SelectContent>
                {others.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.code} · {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!others.length && (
              <p className="pt-2 text-xs text-muted-foreground">
                No other branch is set up to exchange stock with this one.
              </p>
            )}
            {crossGroup && (
              <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                {groupName(groups, groupOf(currentStore))} and{" "}
                {groupName(groups, groupOf(otherStore))} are different groups, so this request
                always waits for an authorised approver — someone other than you — before any stock
                moves. On arrival each line is matched into the receiving group's own catalogue by
                barcode.
              </p>
            )}
            <div className="mt-4 space-y-1">
              <Label htmlFor="transfer-note">Note</Label>
              <Textarea
                id="transfer-note"
                value={note}
                rows={3}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Anything the other branch should know"
              />
            </div>
          </Panel>
        </div>

        <Panel
          title="Lines"
          description={
            kind === "request"
              ? "What you are asking for, with the supplying branch's stock alongside."
              : "What is going in the box, checked against your own shelf."
          }
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Here</TableHead>
                <TableHead className="text-right">Source</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {linePagination.pageItems.map((i) => {
                const p = productOf(i.productId);
                const plan =
                  kind === "transfer" && p && sourceLevels.length
                    ? planDeduction(p, allStores, currentStore.id, i.qty)
                    : null;
                return (
                  <TableRow key={i.productId}>
                    <TableCell>
                      <div className="text-sm">{p?.name ?? "Unknown item"}</div>
                      <div className="numeric text-[11px] text-muted-foreground">
                        {p?.barcode || p?.sku || "no code"}
                      </div>
                      {plan &&
                        (plan.shortBy > 0 ? (
                          <div className="numeric text-[11px] text-destructive">
                            Short by {plan.shortBy} · {availableAt(p!, allStores, currentStore.id)}{" "}
                            across all levels
                          </div>
                        ) : (
                          <div className="numeric text-[11px] text-primary">
                            Picking {plan.picks.map((x) => `${x.qty} from ${x.name}`).join(" · ")}
                          </div>
                        ))}
                    </TableCell>
                    <TableCell className="numeric text-right text-muted-foreground">
                      {p ? stockAt(p, currentStore.id) : 0}
                    </TableCell>
                    <TableCell className="numeric text-right text-muted-foreground">
                      {p && sourceStoreId ? stockAt(p, sourceStoreId) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        className="numeric ml-auto h-9 w-24 text-right"
                        value={String(i.qty)}
                        onChange={(e) =>
                          setItems((prev) =>
                            prev.map((x) =>
                              x.productId === i.productId
                                ? {
                                    ...x,
                                    qty: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                                  }
                                : x,
                            ),
                          )
                        }
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Remove line"
                        onClick={() =>
                          setItems((prev) => prev.filter((x) => x.productId !== i.productId))
                        }
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!items.length && (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    No lines yet — search for a product on the left.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <TablePagination
            page={linePagination.page}
            pageCount={linePagination.pageCount}
            pageSize={linePagination.pageSize}
            total={linePagination.total}
            from={linePagination.from}
            to={linePagination.to}
            label="lines"
            onPage={linePagination.setPage}
            onPageSize={linePagination.setPageSize}
          />

          <div className="flex justify-end pt-5">
            <Button
              onClick={() => void submit()}
              disabled={submitting || !items.length || !otherStoreId}
              aria-busy={submitting}
            >
              {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
              {submitting ? "Submitting…" : submitLabel} ·{" "}
              <span className="numeric">{totalUnits}</span>
            </Button>
          </div>
        </Panel>
      </div>
      <BulkImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        mode="transfer"
        onReceivingRows={(rows) => {
          setItems((current) => {
            const merged = current.map((line) => ({ ...line }));
            for (const row of rows) {
              const quantity = normalizeTransferQuantity(row.quantity);
              if (!quantity) continue;
              const hit = merged.find((line) => line.productId === row.product.id);
              if (hit) hit.qty += quantity;
              else merged.push({ productId: row.product.id, qty: quantity });
            }
            return merged;
          });
        }}
      />
    </div>
  );
}
