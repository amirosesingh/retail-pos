import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useDebounced } from "@/hooks/use-debounced";

import {
  ArrowLeftRight,
  Combine,
  FileSpreadsheet,
  Inbox,
  History,
  Plus,
  Search,
  Trash2,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { money, stockAt, usePos } from "@/lib/pos-store";
import { useAuth } from "@/lib/pos-auth";
import { useVisibility } from "@/lib/ui-visibility";

import { productVisibleAt } from "@/lib/branch-policy";
import { TablePagination, usePagination } from "@/platforms/web/components/pos/TablePagination";
import { Switch } from "@/components/ui/switch";
import { BulkImportDialog } from "@/platforms/web/components/pos/BulkImportDialog";
import { MergeProductsDialog } from "@/platforms/web/components/pos/MergeProductsDialog";
import { commitLabel } from "@/core/api/pos-db";
import { notifyError } from "@/lib/notify";
import { ProductDeleteBlockedDialog } from "@/platforms/web/components/pos/ProductDeleteBlockedDialog";
import type { BlockedDelete } from "@/lib/product-delete";
import { ThemedSelect } from "@/platforms/web/components/pos/ThemedSelect";
import { exportProductsXlsx } from "@/lib/product-export";
import {
  groupList,
  isActive,
  selectableUnits,
  subCategoryList,
  topCategories,
  useCategories,
  useUnits,
} from "@/lib/catalog-meta";
import { checkCodeAvailable } from "@/lib/product-lookup";

import { ItemActivityDrawer } from "@/platforms/web/components/pos/ItemActivityDrawer";
import { OtherSourcesPopover } from "@/platforms/web/components/pos/OtherSourcesPopover";
import type { Product } from "@/core/types/pos-types";
import { nextSku, peekSku, readSkuSettings } from "@/lib/sku";

export const Route = createFileRoute("/inventory")({
  head: () => ({
    meta: [
      { title: "Inventory — Retail" },
      {
        name: "description",
        content:
          "Track stock levels, costs, margins and reorder alerts for every product in the store.",
      },
      { property: "og:title", content: "Inventory — Retail" },
      { property: "og:description", content: "Stock levels, costs and reorder alerts." },
    ],
  }),
  component: Inventory,
});

const blank = (storeId: string): Product => ({
  id: crypto.randomUUID(),
  name: "",
  sku: "",
  barcode: "",
  category: "General",
  price: 0,
  cost: 0,
  ecomPrice: 0,
  ecomVisible: false,
  stockByStore: { [storeId]: 0 },
  reorderLevel: 10,
  taxRate: 0.05,
});

/** Sentinel for "no value picked" — Radix selects cannot hold an empty value. */
const NONE = "__none";

/** List options plus a blank choice, keeping any legacy value that is off-list. */
const pickerOptions = (names: string[], current?: string) => [
  { value: NONE, label: "— none —" },
  ...[...new Set([...names, ...(current ? [current] : [])])]
    .sort()
    .map((n) => ({ value: n, label: n })),
];

function Inventory() {
  const {
    state,
    stores,
    currentStore,
    upsertProduct,
    upsertProductPriceOverride,
    removeProduct,
    removeProducts,
    patchProducts,
    archiveProducts,
    restoreProducts,
  } = usePos();
  const [branchPriceOnly, setBranchPriceOnly] = useState(false);
  const { can } = useAuth();
  const { visible } = useVisibility();
  // Money columns need the reporting permission *and* the administrator's
  // "show cost & margin" switch for this role.
  const showMoney = can("can_view_sales_reports") && visible("inventory.costColumns");
  const showStockValue = can("can_view_sales_reports") && visible("inventory.stockValue");

  const canEdit = can("can_add_new_product");
  const canPrice = can("can_edit_product_price");

  const canBulk = can("can_bulk_edit_products");
  const canMerge = can("can_merge_products");
  const canEcom = canPrice;
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Product | null>(null);
  const [aliasDraft, setAliasDraft] = useState("");
  const [variantLabel, setVariantLabel] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [blocked, setBlocked] = useState<BlockedDelete[]>([]);
  const [deleting, setDeleting] = useState<string[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [catFilter, setCatFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [subFilter, setSubFilter] = useState("all");
  const [bulkCategory, setBulkCategory] = useState("");

  const [logTarget, setLogTarget] = useState<Product | null>(null);

  const [skuOverride, setSkuOverride] = useState(false);
  const autoSku = readSkuSettings().mode === "auto";
  const categories = useCategories();
  const units = useUnits();

  /**
   * Names on offer: everything set up in settings that is still active, plus
   * anything products already carry. A retired entry drops out of the list but
   * stays offered on the product that is still filed under it.
   */
  const retired = useMemo(
    () => new Set(categories.filter((c) => !isActive(c)).map((c) => c.name)),
    [categories],
  );
  const offer = (names: Set<string>, keep?: string | null) =>
    [...names].filter((n) => !retired.has(n) || n === keep).sort();

  const categoryNames = useMemo(() => {
    const names = new Set<string>(topCategories(categories).map((c) => c.name));
    state.products.forEach((p) => p.category && names.add(p.category));
    return offer(names, draft?.category);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories, state.products, retired, draft?.category]);

  const groupNames = useMemo(() => {
    const names = new Set<string>(groupList(categories).map((c) => c.name));
    state.products.forEach((p) => p.group && names.add(p.group));
    return offer(names, draft?.group);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories, state.products, retired, draft?.group]);

  const subNames = useMemo(() => {
    const names = new Set<string>(subCategoryList(categories).map((c) => c.name));
    state.products.forEach((p) => p.subCategory && names.add(p.subCategory));
    return offer(names, draft?.subCategory);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories, state.products, retired, draft?.subCategory]);

  // A big catalogue must not be re-scanned on every keystroke or re-render:
  // the search text settles first, then one pass produces the visible rows.
  const settledQuery = useDebounced(query, 200);
  const rows = useMemo(() => {
    const needle = settledQuery.trim().toLowerCase();
    return state.products.filter((p) => {
      if (!productVisibleAt(state.settings, p, state.currentStoreId)) return false;
      if (showArchived ? p.archived !== true : p.archived === true) return false;
      if (catFilter !== "all" && p.category !== catFilter) return false;
      if (groupFilter !== "all" && (p.group ?? "") !== groupFilter) return false;
      if (subFilter !== "all" && (p.subCategory ?? "") !== subFilter) return false;
      if (!needle) return true;
      // Cheapest fields first — most searches stop on the name.
      return `${p.name} ${p.sku} ${p.barcode} ${(p.barcodes ?? []).join(" ")} ${(p.variants ?? [])
        .map((v) => `${v.code} ${v.label ?? ""}`)
        .join(" ")} ${p.category} ${p.group ?? ""} ${p.subCategory ?? ""}`
        .toLowerCase()
        .includes(needle);
    });
  }, [
    state.products,
    state.settings,
    state.currentStoreId,
    showArchived,
    catFilter,
    groupFilter,
    subFilter,
    settledQuery,
  ]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const selectedProducts = useMemo(
    () => state.products.filter((p) => selectedSet.has(p.id)),
    [state.products, selectedSet],
  );
  const pager = usePagination(rows, 25);
  const pageRows = pager.pageItems;
  const allShownSelected = pageRows.length > 0 && pageRows.every((p) => selectedSet.has(p.id));

  function toggle(id: string, on: boolean) {
    setSelected((prev) => (on ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)));
  }

  function goToTransfers(kind: "transfer" | "request") {
    if (!selected.length) {
      toast.error("Select at least one product first");
      return;
    }
    navigate({ to: "/transfers", search: { items: selected.join(","), kind } });
  }

  const { lowStock, stockValue } = useMemo(() => {
    let value = 0;
    const low: Product[] = [];
    for (const p of state.products) {
      const qty = stockAt(p, currentStore.id);
      value += p.cost * qty;
      if (qty <= p.reorderLevel) low.push(p);
    }
    return { lowStock: low, stockValue: value };
  }, [state.products, currentStore.id]);

  return (
    <AppShell>
      <div className="space-y-5 p-3 sm:p-4 lg:p-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Inventory · {currentStore.name}</h1>
            <p className="text-sm text-muted-foreground">
              {state.products.length} products ·{" "}
              {showStockValue && (
                <>
                  stock value <span className="numeric">{money(stockValue)}</span> ·{" "}
                </>
              )}
              <span className="text-warning">{lowStock.length} below reorder level</span>
            </p>
          </div>
          <div className="flex w-full flex-wrap gap-2 lg:w-auto lg:justify-end">
            <div className="relative min-w-0 flex-1 sm:flex-none">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search products"
                className="w-full pl-9 sm:w-56"
              />
            </div>
            {canEdit && (
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                📥 Bulk Import from Excel
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => {
                void exportProductsXlsx(rows, stores, `products-${currentStore.code}`);
                toast.success(`Exporting ${rows.length} products to Excel`);
              }}
            >
              <FileSpreadsheet className="size-4" /> Export to Excel
            </Button>
            {canEdit && (
              <Dialog
                open={!!draft}
                onOpenChange={(o) => {
                  setDraft(o ? (draft ?? blank(currentStore.id)) : null);
                  if (!o) setBranchPriceOnly(false);
                }}
              >
                <DialogTrigger asChild>
                  <Button onClick={() => { setBranchPriceOnly(false); setDraft(blank(currentStore.id)); }}>
                    <Plus className="size-4" /> New product
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{draft?.name ? "Edit product" : "New product"}</DialogTitle>
                  </DialogHeader>
                  {draft && (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Field label="Name" className="sm:col-span-2">
                        <Input
                          value={draft.name}
                          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                        />
                      </Field>
                      <Field label="SKU">
                        <Input
                          value={draft.sku}
                          readOnly={autoSku && !skuOverride}
                          placeholder={autoSku ? peekSku(state.products.map((p) => p.sku)) : ""}
                          onChange={(e) => setDraft({ ...draft, sku: e.target.value })}
                        />
                        {autoSku && (
                          <button
                            type="button"
                            className="mt-1 text-[11px] text-muted-foreground underline"
                            onClick={() => setSkuOverride((v) => !v)}
                          >
                            {skuOverride ? "Use automatic number" : "Override this code"}
                          </button>
                        )}
                      </Field>
                      <Field label="Barcode">
                        <Input
                          value={draft.barcode}
                          onChange={(e) => setDraft({ ...draft, barcode: e.target.value })}
                        />
                      </Field>
                      <Field label="Category">
                        <ThemedSelect
                          value={draft.category || NONE}
                          ariaLabel="Category"
                          placeholder="Choose a category"
                          onChange={(v) => setDraft({ ...draft, category: v === NONE ? "" : v })}
                          options={pickerOptions(categoryNames, draft?.category)}
                        />
                      </Field>
                      <Field label="Group">
                        <ThemedSelect
                          value={draft.group || NONE}
                          ariaLabel="Group"
                          placeholder="Choose a group"
                          onChange={(v) => setDraft({ ...draft, group: v === NONE ? "" : v })}
                          options={pickerOptions(groupNames, draft?.group)}
                        />
                      </Field>
                      <Field label="Sub-category">
                        <ThemedSelect
                          value={draft.subCategory || NONE}
                          ariaLabel="Sub-category"
                          placeholder="Choose a sub-category"
                          onChange={(v) => setDraft({ ...draft, subCategory: v === NONE ? "" : v })}
                          options={pickerOptions(subNames, draft?.subCategory)}
                        />
                      </Field>
                      <Field label="Unit of measure">
                        <ThemedSelect
                          value={draft.unit ?? "pcs"}
                          onChange={(v) => setDraft({ ...draft, unit: v })}
                          ariaLabel="Unit of measure"
                          options={selectableUnits(units, draft.unit).map((u) => ({
                            value: u.code,
                            label: `${u.code} · ${u.name}${u.allowDecimal ? " (decimal)" : ""}`,
                          }))}
                        />
                      </Field>
                      <Field label="Barcode variants" className="sm:col-span-2">
                        <div className="flex flex-wrap gap-1">
                          {(draft.variants ?? []).map((v) => (
                            <Badge
                              key={v.code}
                              variant="outline"
                              className="numeric gap-1 text-[11px]"
                            >
                              {v.code}
                              {v.label ? ` · ${v.label}` : ""}
                              <button
                                type="button"
                                className="text-destructive"
                                aria-label={`Remove variant ${v.code}`}
                                onClick={() =>
                                  setDraft({
                                    ...draft,
                                    variants: (draft.variants ?? []).filter(
                                      (x) => x.code !== v.code,
                                    ),
                                  })
                                }
                              >
                                ×
                              </button>
                            </Badge>
                          ))}
                          {(draft.barcodes ?? []).map((code) => (
                            <Badge
                              key={code}
                              variant="outline"
                              className="numeric gap-1 text-[11px]"
                            >
                              {code}
                              <button
                                type="button"
                                className="text-destructive"
                                aria-label={`Remove barcode ${code}`}
                                onClick={() =>
                                  setDraft({
                                    ...draft,
                                    barcodes: (draft.barcodes ?? []).filter((b) => b !== code),
                                  })
                                }
                              >
                                ×
                              </button>
                            </Badge>
                          ))}
                        </div>
                        <div className="mt-1 flex flex-col gap-2 sm:flex-row">
                          <Input
                            value={aliasDraft}
                            placeholder="Scan or type another barcode for this item"
                            onChange={(e) => setAliasDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key !== "Enter") return;
                              e.preventDefault();
                              const code = aliasDraft.trim();
                              if (!code) return;
                              const problem = checkCodeAvailable(state.products, code, draft.id);
                              if (problem) {
                                toast.error(problem);
                                return;
                              }
                              setDraft({
                                ...draft,
                                variants: [
                                  ...(draft.variants ?? []).filter((v) => v.code !== code),
                                  { code, label: variantLabel.trim() || undefined },
                                ],
                              });
                              setAliasDraft("");
                              setVariantLabel("");
                            }}
                          />
                          <Input
                            value={variantLabel}
                            placeholder="Label (colour, size, pack)"
                            className="w-full sm:w-56"
                            onChange={(e) => setVariantLabel(e.target.value)}
                          />
                        </div>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Press Enter in the barcode box to add. Codes already used anywhere in the
                          catalogue are refused, and every variant scans to this product.
                        </p>
                      </Field>
                      <Field label="Tax rate %">
                        <Input
                          className="numeric"
                          value={draft.taxRate * 100}
                          onChange={(e) =>
                            setDraft({ ...draft, taxRate: (Number(e.target.value) || 0) / 100 })
                          }
                        />
                      </Field>
                      <Field label="Price">
                        <Input
                          disabled={!canPrice}
                          className="numeric"
                          value={draft.price}
                          onChange={(e) =>
                            setDraft({ ...draft, price: Number(e.target.value) || 0 })
                          }
                        />
                      </Field>
                      <Field label="E-com price">
                        <Input
                          disabled={!canPrice}
                          className="numeric"
                          value={draft.ecomPrice ?? 0}
                          onChange={(e) =>
                            setDraft({ ...draft, ecomPrice: Number(e.target.value) || 0 })
                          }
                        />
                      </Field>
                      {state.products.some((product) => product.id === draft.id) && (
                        <Field label="Price scope" className="sm:col-span-2">
                          <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                            <div>
                              <p className="text-sm font-medium">Use these prices only at {currentStore.name}</p>
                              <p className="text-[11px] text-muted-foreground">
                                Keeps the global product price unchanged. Only Price and E-com price are saved in this mode.
                              </p>
                            </div>
                            <Switch checked={branchPriceOnly} onCheckedChange={setBranchPriceOnly} />
                          </div>
                        </Field>
                      )}
                      <Field label="Cost">
                        <Input
                          disabled={!canPrice || branchPriceOnly}
                          className="numeric"
                          value={draft.cost}
                          onChange={(e) =>
                            setDraft({ ...draft, cost: Number(e.target.value) || 0 })
                          }
                        />
                      </Field>
                      <Field label={`Stock · ${currentStore.code}`}>
                        <Input
                          className="numeric"
                          value={stockAt(draft, currentStore.id)}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              stockByStore: {
                                ...draft.stockByStore,
                                [currentStore.id]: Number(e.target.value) || 0,
                              },
                            })
                          }
                        />
                      </Field>
                      <Field label="Reorder level">
                        <Input
                          className="numeric"
                          value={draft.reorderLevel}
                          onChange={(e) =>
                            setDraft({ ...draft, reorderLevel: Number(e.target.value) || 0 })
                          }
                        />
                      </Field>
                    </div>
                  )}
                  <DialogFooter>
                    <Button
                      onClick={async () => {
                        if (!draft?.name.trim()) {
                          toast.error("Product name is required");
                          return;
                        }
                        const sku =
                          draft.sku.trim() ||
                          (autoSku ? nextSku(state.products.map((p) => p.sku)) : "");
                        try {
                          // Saved only once the write is confirmed stored.
                          const target = branchPriceOnly
                            ? await upsertProductPriceOverride(draft.id, draft.price, draft.ecomPrice)
                            : await upsertProduct({ ...draft, sku });
                          setDraft(null);
                          setBranchPriceOnly(false);
                          setSkuOverride(false);
                          toast.success(`Product saved — ${commitLabel(target).toLowerCase()}`);
                        } catch (e) {
                          notifyError(e, "Saving the product");
                        }
                      }}
                    >
                      Save product
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </header>

        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-3">
          <div className="space-y-1">
            <Label className="text-xs">View</Label>
            <Button
              size="sm"
              variant={showArchived ? "default" : "outline"}
              onClick={() => {
                setShowArchived((v) => !v);
                setSelected([]);
              }}
            >
              {showArchived ? "Showing archived" : "Show archived"}
            </Button>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Category</Label>
            <ThemedSelect
              value={catFilter}
              onChange={(v) => {
                setCatFilter(v);
                setGroupFilter("all");
                setSubFilter("all");
              }}
              ariaLabel="Filter by category"
              className="w-48"
              options={[
                { value: "all", label: "All categories" },
                ...categoryNames.map((c) => ({ value: c, label: c })),
              ]}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Group</Label>
            <ThemedSelect
              value={groupFilter}
              onChange={(v) => {
                setGroupFilter(v);
                setSubFilter("all");
              }}
              ariaLabel="Filter by group"
              className="w-48"
              options={[
                { value: "all", label: "All groups" },
                ...groupNames.map((c) => ({ value: c, label: c })),
              ]}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Sub-category</Label>
            <ThemedSelect
              value={subFilter}
              onChange={setSubFilter}
              ariaLabel="Filter by sub-category"
              className="w-48"
              options={[
                { value: "all", label: "All sub-categories" },
                ...subNames.map((c) => ({ value: c, label: c })),
              ]}
            />
          </div>
          <p className="pb-2 text-xs text-muted-foreground">
            Showing <span className="numeric">{rows.length}</span> of{" "}
            <span className="numeric">{state.products.length}</span> products
          </p>
        </div>

        {selected.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/5 px-4 py-3">
            <p className="text-sm">
              <span className="numeric font-semibold">{selected.length}</span> product
              {selected.length > 1 ? "s" : ""} selected
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setSelected([])}>
                Clear
              </Button>
              <Button variant="outline" size="sm" onClick={() => goToTransfers("request")}>
                <Inbox className="size-4" /> Request selected
              </Button>
              <Button size="sm" onClick={() => goToTransfers("transfer")}>
                <ArrowLeftRight className="size-4" /> Transfer selected
              </Button>
              {canBulk && (
                <>
                  <Input
                    value={bulkCategory}
                    onChange={(e) => setBulkCategory(e.target.value)}
                    placeholder="Move to category…"
                    className="h-8 w-44"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      const name = bulkCategory.trim();
                      if (!name) return toast.error("Type the category to move them to");
                      await patchProducts(selected, { category: name });
                      setBulkCategory("");
                      toast.success(`${selected.length} products moved to ${name}`);
                    }}
                  >
                    Apply category
                  </Button>
                </>
              )}
              {canMerge && selected.length > 1 && (
                <Button size="sm" variant="outline" onClick={() => setMergeOpen(true)}>
                  <Combine className="size-4" /> Merge duplicates
                </Button>
              )}
              {canBulk && (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={deleting.length > 0}
                  onClick={async () => {
                    if (
                      !window.confirm(
                        `Delete ${selected.length} product${selected.length > 1 ? "s" : ""}? This cannot be undone.`,
                      )
                    )
                      return;
                    setDeleting(selected);
                    try {
                      const failed = await removeProducts(selected);
                      const done = selected.length - failed.length;
                      if (done) toast.success(`${done} product${done > 1 ? "s" : ""} deleted`);
                      setSelected(failed.map((f) => f.id));
                      if (failed.length) setBlocked(failed);
                    } finally {
                      setDeleting([]);
                    }
                  }}
                >
                  <Trash2 className="size-4" />{" "}
                  {deleting.length > 1 ? "Checking sales history…" : "Delete selected"}
                </Button>
              )}
            </div>
          </div>
        )}

        <div className="rounded-lg border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allShownSelected}
                    onCheckedChange={(v) => setSelected(v ? pageRows.map((p) => p.id) : [])}
                    aria-label="Select all products"
                  />
                </TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Sub-category</TableHead>
                {showMoney && <TableHead className="text-right">Cost</TableHead>}
                <TableHead className="text-right">Price</TableHead>
                {showMoney && <TableHead className="text-right">Margin</TableHead>}
                {canEcom && <TableHead className="text-center">On web</TableHead>}
                <TableHead className="text-center">Stock · {currentStore.code}</TableHead>
                <TableHead className="text-center">Other stores</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Checkbox
                      checked={selected.includes(p.id)}
                      onCheckedChange={(v) => toggle(p.id, !!v)}
                      aria-label={`Select ${p.name}`}
                    />
                  </TableCell>
                  <TableCell>
                    <button
                      className="text-left font-medium hover:text-primary"
                      onClick={() => { setBranchPriceOnly(false); setDraft(p); }}
                    >
                      {p.name}
                    </button>
                    <div className="numeric text-[11px] text-muted-foreground">
                      {p.sku} · {p.barcode}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{p.category}</TableCell>
                  <TableCell className="text-muted-foreground">{p.subCategory || "—"}</TableCell>
                  {showMoney && (
                    <TableCell className="numeric text-right">{money(p.cost)}</TableCell>
                  )}
                  <TableCell className="numeric text-right">{money(p.price)}</TableCell>
                  {showMoney && (
                    <TableCell className="numeric text-right text-accent">
                      {p.price ? `${Math.round(((p.price - p.cost) / p.price) * 100)}%` : "—"}
                    </TableCell>
                  )}
                  {canEcom && (
                    <TableCell className="text-center">
                      <Switch
                        checked={!!p.ecomVisible}
                        onCheckedChange={async (v) => {
                          try {
                            await upsertProduct({ ...p, ecomVisible: v });
                            toast.success(
                              `${p.name} ${v ? "published to" : "hidden from"} the web store`,
                            );
                          } catch (e) {
                            notifyError(e, "Updating the web store visibility");
                          }
                        }}
                        aria-label={`E-commerce visibility for ${p.name}`}
                      />
                    </TableCell>
                  )}
                  <TableCell>
                    <div className="flex items-center justify-center gap-1">
                      <Badge
                        variant="outline"
                        className={`numeric justify-center ${
                          stockAt(p, currentStore.id) <= p.reorderLevel
                            ? "border-warning/50 text-warning"
                            : ""
                        }`}
                      >
                        {stockAt(p, currentStore.id)} in stock
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <OtherSourcesPopover product={p} stores={stores} currentStoreId={currentStore.id} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="icon"
                      variant="ghost"
                      title="View activity log"
                      aria-label={`View activity for ${p.name}`}
                      onClick={() => setLogTarget(p)}
                    >
                      <History className="size-4" />
                    </Button>
                    {canEdit && (
                      <Button
                        size="icon"
                        variant="ghost"
                        disabled={deleting.includes(p.id)}
                        title={deleting.includes(p.id) ? "Checking sales history…" : "Delete"}
                        onClick={async () => {
                          setDeleting((d) => [...d, p.id]);
                          try {
                            const failed = await removeProduct(p.id);
                            if (failed.length) setBlocked(failed);
                            else toast.success("Product removed");
                          } finally {
                            setDeleting((d) => d.filter((id) => id !== p.id));
                          }
                        }}
                      >
                        {deleting.includes(p.id) ? (
                          <Loader2 className="size-4 animate-spin text-muted-foreground" />
                        ) : (
                          <Trash2 className="size-4 text-destructive" />
                        )}
                      </Button>
                    )}
                    {canEdit && p.archived && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          void restoreProducts([p.id]).catch((error) =>
                            notifyError(error, "Restoring product"),
                          )
                        }
                      >
                        Restore
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePagination
            page={pager.page}
            pageCount={pager.pageCount}
            pageSize={pager.pageSize}
            total={pager.total}
            from={pager.from}
            to={pager.to}
            label="items"
            onPage={pager.setPage}
            onPageSize={pager.setPageSize}
          />
        </div>
      </div>
      {canEdit && <BulkImportDialog open={importOpen} onOpenChange={setImportOpen} />}
      {canMerge && (
        <MergeProductsDialog
          open={mergeOpen}
          products={selectedProducts}
          onOpenChange={setMergeOpen}
          onMerged={() => setSelected([])}
          onBlocked={setBlocked}
        />
      )}
      <ProductDeleteBlockedDialog
        blocked={blocked}
        onClose={() => setBlocked([])}
        onHide={async (ids) => {
          try {
            await archiveProducts(ids);
            setBlocked([]);
            toast.success(`${ids.length > 1 ? "Products" : "Product"} archived — history kept`);
          } catch (error) {
            notifyError(error, "Archiving products");
          }
        }}
      />
      <ItemActivityDrawer product={logTarget} onClose={() => setLogTarget(null)} />
    </AppShell>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1 ${className}`}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
