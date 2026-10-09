/**
 * Search & add product.
 *
 * Opens automatically when a scanned code matches nothing, so the cashier can
 * find the item by name, link the unknown barcode to an existing product, or
 * create the product on the spot without leaving the register.
 */
import { useEffect, useMemo, useState } from "react";
import { Barcode, Link2, PackagePlus, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { money, stockAt } from "@/lib/pos-store";
import { localTerminalId } from "@/lib/shift-hours";
import { nextSku, readSkuSettings } from "@/lib/sku";
import type { Product } from "@/core/types/pos-types";
import { searchSellingProducts, type ProductSearchField } from "@/lib/register/product-search";

type Field = ProductSearchField;

const FIELDS: { id: Field; label: string }[] = [
  { id: "all", label: "All items" },
  { id: "barcode", label: "Barcode / SKU" },
  { id: "name", label: "Item name" },
  { id: "category", label: "Category" },
  { id: "code", label: "Item code / serial" },
];

export function ProductSearchDialog({
  open,
  onOpenChange,
  query,
  onQueryChange,
  products,
  storeId,
  unknownCode,
  onAdd,
  onLinkBarcode,
  onCreateProduct,
  canLinkBarcode,
  canCreateProduct,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  query: string;
  onQueryChange: (v: string) => void;
  products: Product[];
  storeId: string;
  /** the code that failed to resolve, when the dialog opened from a scan */
  unknownCode: string | null;
  onAdd: (productId: string) => void;
  onLinkBarcode: (productId: string, code: string) => Promise<void> | void;
  onCreateProduct: (draft: {
    name: string;
    price: number;
    category: string;
    barcode: string;
    sku: string;
  }) => Promise<void> | void;
  canLinkBarcode: boolean;
  canCreateProduct: boolean;
}) {
  const [field, setField] = useState<Field>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setCreating(false);
      setSelected(null);
      setName("");
      setPrice("");
      setCategory("");
      setField("all");
    }
  }, [open]);

  const q = query.trim().toLowerCase();
  const [resultLimit, setResultLimit] = useState(100);
  useEffect(() => { setResultLimit(100); setSelected(null); }, [q, field, storeId, open]);
  const allResults = useMemo(
    () => searchSellingProducts(products, q, field),
    [products, q, field],
  );
  const results = allResults.slice(0, resultLimit);

  async function linkBarcode() {
    if (!selected || !unknownCode) return;
    setBusy(true);
    try {
      await onLinkBarcode(selected, unknownCode);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  async function createProduct() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Give the new product a name");
      return;
    }
    const value = Number(price);
    if (!Number.isFinite(value) || value < 0) {
      toast.error("Enter a valid selling price");
      return;
    }
    setBusy(true);
    try {
      const skuCfg = readSkuSettings();
      const generatedSku = async () =>
        nextSku(products.map((product) => product.sku), {
          storeId,
          terminalId: localTerminalId(),
        });
      const sku =
        skuCfg.mode === "auto" ? await generatedSku() : (unknownCode ?? (await generatedSku()));
      await onCreateProduct({
        name: trimmed,
        price: value,
        category: category.trim() || "General",
        barcode: unknownCode ?? "",
        sku,
      });
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create this product");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] max-w-4xl flex-col gap-3 overflow-hidden">
        <DialogHeader>
          <DialogTitle>Search &amp; add product</DialogTitle>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search by name, barcode, SKU or category…"
            className="numeric h-11 pl-9"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {FIELDS.map((f) => (
            <button
              key={f.id}
              onClick={() => setField(f.id)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                field === f.id
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex shrink-0 flex-col gap-3 rounded-md border border-border p-3">
            {unknownCode ? (
              <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
                <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-warning">
                  <Barcode className="size-3.5" /> Unrecognised code
                </p>
                <p className="numeric mt-1 break-all text-sm font-semibold">{unknownCode}</p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Pick an item below to add it to the bill.
              </p>
            )}

            {!creating && (canLinkBarcode || canCreateProduct) && (
              <div className="grid gap-2 sm:grid-cols-2">
                {canLinkBarcode && (
                  <Button
                    variant="outline"
                    disabled={!selected || !unknownCode || busy}
                    onClick={() => void linkBarcode()}
                  >
                    <Link2 className="size-4" /> Link barcode to selected item
                  </Button>
                )}
                {canCreateProduct && (
                  <Button disabled={busy} onClick={() => setCreating(true)}>
                    <PackagePlus className="size-4" /> Create new product with this barcode
                  </Button>
                )}
              </div>
            )}

            {creating && canCreateProduct && (
              <div className="space-y-2">
                <div className="grid gap-2 sm:grid-cols-3">
                  <div>
                    <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Name
                    </Label>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="mt-1 h-10"
                    />
                  </div>
                  <div>
                    <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Price
                    </Label>
                    <Input
                      value={price}
                      inputMode="decimal"
                      onChange={(e) => setPrice(e.target.value)}
                      className="numeric mt-1 h-10"
                    />
                  </div>
                  <div>
                    <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Category
                    </Label>
                    <Input
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      placeholder="General"
                      className="mt-1 h-10"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button className="flex-1" disabled={busy} onClick={() => void createProduct()}>
                    Save &amp; add
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={() => setCreating(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>

          <ScrollArea className="min-h-0 flex-1 rounded-md border border-border">
            <div className="flex flex-col gap-1 p-2">
              {results.map((p) => (
                <div
                  key={p.id}
                  className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border px-2 py-2 ${
                    selected === p.id ? "border-primary bg-primary/10" : "border-transparent"
                  }`}
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-md bg-surface-2 text-sm font-semibold text-muted-foreground">
                    {p.name.slice(0, 2).toUpperCase()}
                  </span>
                  <button className="min-w-0 text-left" onClick={() => setSelected(p.id)}>
                    <span className="block truncate text-sm font-medium">{p.name}</span>
                    <span className="numeric block truncate text-[11px] text-muted-foreground">
                      {p.barcode || "no barcode"} · {p.sku} · {stockAt(p, storeId)} in stock
                    </span>
                  </button>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="numeric text-sm font-semibold text-primary">
                      {money(p.price)}
                    </span>
                    <Button size="sm" onClick={() => onAdd(p.id)}>
                      Add
                    </Button>
                  </span>
                </div>
              ))}
              {results.length === 0 && (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  No products match “{query}”.
                </p>
              )}
              {allResults.length > results.length && (
                <Button variant="outline" onClick={() => setResultLimit(limit => limit + 100)}>
                  Show more ({results.length} of {allResults.length})
                </Button>
              )}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
