import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ThemedSelect } from "@/platforms/web/components/pos/ThemedSelect";
import { Label } from "@/components/ui/label";
import { money, stockAt, usePos } from "@/lib/pos-store";
import type { BlockedDelete } from "@/lib/product-delete";
import type { Product } from "@/core/types/pos-types";
import { findMergeBlocks, type MergeBlock } from "@/lib/merge-guard";
import { useHeldOrders } from "@/lib/held-orders";

/**
 * Folds duplicate catalogue records (same item received twice under different
 * barcodes) into one master. Stock is added together and the losing barcodes
 * stay scannable as aliases.
 */
export function MergeProductsDialog({
  open,
  products,
  onOpenChange,
  onMerged,
  onBlocked,
}: {
  open: boolean;
  products: Product[];
  onOpenChange: (open: boolean) => void;
  onMerged?: () => void;
  onBlocked?: (blocked: BlockedDelete[]) => void;
}) {
  const { mergeProducts, currentStore, state } = usePos();
  const held = useHeldOrders();
  const [masterId, setMasterId] = useState(products[0]?.id ?? "");
  const [blocks, setBlocks] = useState<MergeBlock[]>([]);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (open) setMasterId(products[0]?.id ?? "");
  }, [open, products]);

  useEffect(() => {
    if (!open || products.length < 2) {
      setBlocks(current => current.length ? [] : current);
      setChecking(false);
      return;
    }
    let live = true;
    setChecking(true);
    void findMergeBlocks(products, state.bookings, held).then((found) => {
      if (!live) return;
      setBlocks(found);
      setChecking(false);
    });
    return () => {
      live = false;
    };
  }, [open, products, state.bookings, held]);

  const master = products.find((p) => p.id === masterId);
  const losers = products.filter((p) => p.id !== masterId);
  const totalStock = products.reduce((a, p) => a + stockAt(p, currentStore.id), 0);
  const aliases = [
    ...new Set(
      losers.flatMap((p) => [p.barcode, p.sku, ...(p.barcodes ?? [])].filter(Boolean)),
    ),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Merge duplicate products</DialogTitle>
          <DialogDescription>
            Keep one record and fold the others into it. Stock is added together and every old
            barcode keeps scanning to the item you keep.
          </DialogDescription>
        </DialogHeader>

        {products.length < 2 ? (
          <p className="text-sm text-muted-foreground">Select at least two products to merge.</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1">
              <Label className="text-xs">Record to keep</Label>
              <ThemedSelect
                value={masterId}
                onChange={setMasterId}
                ariaLabel="Product record to keep"
                options={products.map((p) => ({
                  value: p.id,
                  label: `${p.name} · ${p.barcode || p.sku}`,
                }))}
              />
            </div>

            <div className="rounded-md border border-border p-3 text-sm">
              <p className="font-medium">{master?.name}</p>
              <p className="text-muted-foreground">
                Combined stock at {currentStore.code}:{" "}
                <span className="numeric">{totalStock}</span> · price{" "}
                <span className="numeric">{money(master?.price ?? 0)}</span>
              </p>
              <p className="mt-2 text-xs text-muted-foreground">Barcodes kept as aliases</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {aliases.map((code) => (
                  <Badge key={code} variant="outline" className="numeric text-[10px]">
                    {code}
                  </Badge>
                ))}
                {!aliases.length && <span className="text-xs">—</span>}
              </div>
            </div>

            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              These {losers.length} record{losers.length > 1 ? "s" : ""} will be removed:
              <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                {losers.map((p) => (
                  <li key={p.id}>
                    {p.name} · {p.barcode || p.sku}
                  </li>
                ))}
              </ul>
            </div>

            {blocks.length > 0 && (
              <div className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
                <p className="font-medium">Merging is on hold until this work is finished:</p>
                <ul className="mt-1 list-disc pl-5">
                  {blocks.map((b) => (
                    <li key={`${b.productId}-${b.reason}`}>
                      {b.name} — {b.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={products.length < 2 || !masterId || checking || blocks.length > 0}
            onClick={async () => {
              const blocked = await mergeProducts(
                masterId,
                losers.map((p) => p.id),
              );
              toast.success(`Merged ${losers.length + 1} records into ${master?.name}`);
              onOpenChange(false);
              onMerged?.();
              if (blocked.length) onBlocked?.(blocked);
            }}
          >
            Merge products
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
