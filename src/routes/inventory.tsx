import { canUseEcommerceDevice } from "@/lib/ecommerce-device";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useDebounced } from "@/hooks/use-debounced";

import {
  Archive,
  MoreHorizontal,
  ArrowLeftRight,
  Combine,
  FileSpreadsheet,
  Inbox,
  History,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
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

import { createCatalogueVisibility } from "@/lib/branch-policy";
import { TablePagination, usePagination } from "@/platforms/web/components/pos/TablePagination";
import { Switch } from "@/components/ui/switch";
import { BulkImportDialog } from "@/platforms/web/components/pos/BulkImportDialog";
import { MergeProductsDialog } from "@/platforms/web/components/pos/MergeProductsDialog";
import { commitLabel } from "@/core/api/pos-db";
import { notifyError } from "@/lib/notify";
import { ProductDeleteBlockedDialog } from "@/platforms/web/components/pos/ProductDeleteBlockedDialog";
import type { BlockedDelete } from "@/lib/product-delete";
import { ThemedSelect } from "@/platforms/web/components/pos/ThemedSelect";
import { exportProductsXlsx, productsForExport, type ProductExportScope } from "@/lib/product-export";
import {
  groupList,
  isActive,
  selectableUnits,
  subCategoryList,
  topCategories,
  useCategories,
  useUnits,
} from "@/lib/catalog-meta";
import {
  checkCodeAvailable,
  findDuplicateProductCodes,
  productCodeProblems,
  type DuplicateProductCode,
} from "@/lib/product-lookup";

import { ItemActivityDrawer } from "@/platforms/web/components/pos/ItemActivityDrawer";
import { OtherSourcesPopover } from "@/platforms/web/components/pos/OtherSourcesPopover";
import type { Product } from "@/core/types/pos-types";
import { nextSku, peekSku, readSkuSettings } from "@/lib/sku";
import { localTerminalId } from "@/lib/shift-hours";
import { cn } from "@/lib/utils";
import { inventoryMetrics, inventoryUnitMargin, isLowStock, needsCostReview } from "@/lib/inventory-metrics";
import { AnimatedMetric } from "@/platforms/web/components/pos/AnimatedMetric";
import { InventorySummaryCards } from "@/platforms/web/components/pos/InventorySummaryCards";
import { InventoryCatalogueStatus } from "@/platforms/web/components/pos/InventoryCatalogueStatus";
import { totalUnitCost } from "@/lib/total-unit-cost";
import { TotalUnitCostDialog } from "@/platforms/web/components/pos/TotalUnitCostDialog";

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

const blank = (storeId: string, taxRate = 0): Product => ({
  id: crypto.randomUUID(),
  name: "",
  sku: "",
  barcode: "",
  category: "Default",
  price: 0,
  cost: 0,
  ecomPrice: 0,
  ecomVisible: false,
  stockByStore: { [storeId]: 0 },
  reorderLevel: 10,
  taxRate,
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
    ready: inventoryReady,
    loadPhase,
    stores,
    currentStore,
    upsertProduct,
    upsertProductPriceOverride,
    patchProducts,
    archiveProducts,
    restoreProducts,
  } = usePos();
  const [branchPriceOnly, setBranchPriceOnly] = useState(false);
  const { can, isAdmin } = useAuth();
  const { visible } = useVisibility();
  // Money columns need the reporting permission *and* the administrator's
  // "show cost & margin" switch for this role.
  const showMoney = can("can_view_cost_margin") && visible("inventory.costColumns");
  const showStockValue = can("can_view_cost_margin") && visible("inventory.stockValue");
  const catalogueVisible = useMemo(() => createCatalogueVisibility(state.settings, state.stores, state.transfers), [state.settings, state.stores, state.transfers]);

  const canCreate = can("can_add_new_product");
  const canEditDetails = can("can_edit_product_details");
  const canArchive = can("can_archive_product");
  const canRestore = can("can_restore_product");
  const canPublish = can("can_publish_product");
  const canLinkBarcode = can("can_link_product_barcode");
  const canAdjustStock = can("can_adjust_stock");
  const canPrice = can("can_edit_product_price");

  const canBulk = can("can_bulk_edit_products");
  const canMerge = can("can_merge_products");
  const canEcom = canUseEcommerceDevice() && state.settings.integrations.ecommerceEnabled !== false && canPublish && visible("inventory.ecommerce");
  const canOpenEditor = canCreate || canEditDetails || canPrice || canAdjustStock || canLinkBarcode;
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Product | null>(null);
  const [aliasDraft, setAliasDraft] = useState("");
  const [variantLabel, setVariantLabel] = useState("");
  const [variantCost, setVariantCost] = useState("");
  const [variantPrice, setVariantPrice] = useState("");
  const [selectedIds, setSelected] = useState<string[]>([]);
  const selected = useMemo(() => selectedIds.filter(id => state.products.some(product => product.id === id && catalogueVisible(product, state.currentStoreId))), [selectedIds, state.products, catalogueVisible, state.currentStoreId]);
  useEffect(() => { setSelected([]); }, [state.currentStoreId]);
  const [expandedProducts, setExpandedProducts] = useState<string[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [unitCostEdit, setUnitCostEdit] = useState<{ ids: string[]; initialTarget: "default" | "selected"; productName?: string } | null>(null);
  const [blocked, setBlocked] = useState<BlockedDelete[]>([]);
  const [deleting, setDeleting] = useState<string[]>([]);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [catFilter, setCatFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [subFilter, setSubFilter] = useState("all");
  const [bulkCategory, setBulkCategory] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [columnControlsTarget, setColumnControlsTarget] = useState<HTMLDivElement | null>(null);
  const [skuFilter, setSkuFilter] = useState("");
  const [costReviewOnly, setCostReviewOnly] = useState(false);
  const [stockFilter, setStockFilter] = useState("all");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [minMargin, setMinMargin] = useState("");
  const [duplicateRows, setDuplicateRows] = useState<DuplicateProductCode[]>([]);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const duplicateAuditDone = useRef(false);
  const draftIsExisting = !!draft && state.products.some((product) => product.id === draft.id);
  const canChangeDetails = draftIsExisting ? canEditDetails : canCreate;

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
      if (!catalogueVisible(p, state.currentStoreId)) return false;
      if (showArchived ? p.archived !== true : p.archived === true) return false;
      if (catFilter !== "all" && p.category !== catFilter) return false;
      if (groupFilter !== "all" && (p.group ?? "") !== groupFilter) return false;
      if (subFilter !== "all" && (p.subCategory ?? "") !== subFilter) return false;
      const skuNeedle = skuFilter.trim().toLowerCase();
      if (skuNeedle && !`${p.sku} ${p.barcode}`.toLowerCase().includes(skuNeedle)) return false;
      const branchStock = stockAt(p, state.currentStoreId);
      if (stockFilter === "in" && branchStock <= 0) return false;
      if (stockFilter === "out" && branchStock !== 0) return false;
      if (stockFilter === "low" && !isLowStock(branchStock, p.reorderLevel)) return false;
      if (stockFilter === "negative" && branchStock >= 0) return false;
      if (showMoney && costReviewOnly && !needsCostReview(p.cost)) return false;
      if (minPrice !== "" && p.price < Number(minPrice)) return false;
      if (maxPrice !== "" && p.price > Number(maxPrice)) return false;
      const margin = inventoryUnitMargin(p, state.settings.integrations.totalUnitCost);
      if (minMargin !== "" && (margin === null || margin < Number(minMargin))) return false;
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
    catalogueVisible,
    state.currentStoreId,
    showArchived,
    catFilter,
    groupFilter,
    subFilter,
    settledQuery,
    skuFilter,
    stockFilter,
    costReviewOnly,
    showMoney,
    minPrice,
    maxPrice,
    minMargin,
  ]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const selectedProducts = useMemo(
    () => state.products.filter((p) => selectedSet.has(p.id)),
    [state.products, selectedSet],
  );
  const pager = usePagination(rows, 25);
  const duplicatePager = usePagination(duplicateRows, 10);
  const pageRows = pager.pageItems;
  const allShownSelected = pageRows.length > 0 && pageRows.every((p) => selectedSet.has(p.id));

  useEffect(() => {
    if (duplicateAuditDone.current || !state.products.length) return;
    duplicateAuditDone.current = true;
    const duplicates = findDuplicateProductCodes(state.products);
    setDuplicateRows(duplicates);
    if (duplicates.length) setDuplicateOpen(true);
  }, [state.products]);

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

  const catalogProducts = useMemo(
    () =>
      state.products.filter((product) =>
        catalogueVisible(product, state.currentStoreId),
      ),
    [state.products, catalogueVisible, state.currentStoreId],
  );
  const costReviewCount = catalogProducts.filter(product => (showArchived ? product.archived === true : product.archived !== true) && needsCostReview(product.cost)).length;
  const metrics = useMemo(
    () => inventoryMetrics(catalogProducts, currentStore.id),
    [catalogProducts, currentStore.id],
  );
  const archivedCount = useMemo(
    () => catalogProducts.filter(product => product.archived === true).length,
    [catalogProducts],
  );
  // Describe only filters the rows above actually apply; toggling Archive retains them.
  const appliedFilters = [
    settledQuery.trim() && "Search",
    catFilter !== "all" && `Category: ${catFilter}`,
    groupFilter !== "all" && `Group: ${groupFilter}`,
    subFilter !== "all" && `Sub-category: ${subFilter}`,
    skuFilter.trim() && "SKU / barcode",
    stockFilter !== "all" && `Stock: ${{ in: "In stock", out: "Out of stock", low: "Low stock", negative: "Negative stock" }[stockFilter] ?? stockFilter}`,
    showMoney && costReviewOnly && "Cost review",
    minPrice !== "" && `Min price: ${minPrice}`,
    maxPrice !== "" && `Max price: ${maxPrice}`,
    minMargin !== "" && (showMoney ? `Min margin: ${minMargin}%` : "Margin filter"),
  ].filter((filter): filter is string => typeof filter === "string" && filter.length > 0);

  const totalUnitCostValue = useMemo(() => {
    let value = 0;
    for (const product of catalogProducts) {
      if (product.archived === true) continue;
      const quantity = stockAt(product, currentStore.id);
      if (quantity === 0) continue;
      const cost = totalUnitCost(product.cost, product.id, state.settings.integrations.totalUnitCost);
      if (cost === null) return null;
      value += cost * quantity;
    }
    return value;
  }, [catalogProducts, currentStore.id, state.settings.integrations.totalUnitCost]);

  function exportCatalogue(scope: ProductExportScope) {
    const products = productsForExport(catalogProducts, scope, currentStore.id);
    if (!products.length) {
      toast.info("No products match this export choice");
      return;
    }
    setExportOpen(false);
    void exportProductsXlsx(products, stores, `products-${currentStore.code}-${scope}`, showMoney, canEcom)
      .then(() => toast.success(`Exported ${products.length} products to Excel`))
      .catch(error => notifyError(error, "Exporting products"));
  }

  return (
    <AppShell>
      <div className="pos-page-container">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Inventory · {currentStore.name}</h1>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:flex-wrap lg:w-auto lg:justify-end">
            <div className="col-span-2 flex w-full min-w-0 items-center gap-2 sm:w-auto">
              <div className="relative min-w-0 flex-1 sm:flex-none">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search products" aria-label="Search products"
                  className="w-full pl-9 pr-11 sm:w-64"
                />
                <Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1/2 size-8 -translate-y-1/2" aria-label="Advanced product filters" title="Advanced filters" onClick={() => setAdvanced(true)}><SlidersHorizontal className="size-4" /></Button>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => { setShowArchived(value => !value); setSelected([]); }}>
              <Archive className="size-4" /> {showArchived ? "Show active" : "Show archived"}
            </Button>
            <div ref={setColumnControlsTarget} className="flex items-center [&>button]:w-full sm:[&>button]:w-auto" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="outline" size="sm" aria-label="Inventory actions"><MoreHorizontal className="size-4" />Actions</Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-w-[calc(100vw-2rem)]">
                {showMoney && (costReviewCount > 0 || costReviewOnly) && <DropdownMenuItem onSelect={() => { setCostReviewOnly(value => !value); setSelected([]); }}>
                  {costReviewOnly ? "Clear cost review" : `Review costs · ${costReviewCount}`}
                </DropdownMenuItem>}
                {canBulk && <DropdownMenuItem onSelect={() => setImportOpen(true)}>Import from Excel</DropdownMenuItem>}
                <DropdownMenuItem onSelect={() => {
                  const duplicates = findDuplicateProductCodes(state.products);
                  setDuplicateRows(duplicates);
                  if (!duplicates.length) toast.success("No duplicate SKU or barcode values found");
                  else setDuplicateOpen(true);
                }}>Check duplicate codes</DropdownMenuItem>
                <DropdownMenuSeparator />
                {isAdmin && showMoney && <DropdownMenuItem onSelect={() => setUnitCostEdit({ ids: selected, initialTarget: selected.length ? "selected" : "default" })}><SlidersHorizontal className="size-4" />Total Unit Cost rules</DropdownMenuItem>}
                <DropdownMenuItem onSelect={() => setExportOpen(true)}><FileSpreadsheet className="size-4" />Export to Excel</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {unitCostEdit && <TotalUnitCostDialog open onOpenChange={open => { if (!open) setUnitCostEdit(null); }} selected={unitCostEdit.ids} initialTarget={unitCostEdit.initialTarget} productName={unitCostEdit.productName} />}
            <Dialog open={exportOpen} onOpenChange={setExportOpen}>
              <DialogContent className="max-w-sm">
                <DialogHeader><DialogTitle>Export products to Excel</DialogTitle></DialogHeader>
                <p className="text-sm text-muted-foreground">Choose which products to include from this branch's catalogue.</p>
                <div className="grid gap-2">
                  <Button variant="outline" onClick={() => exportCatalogue("all")}>All active and archived</Button>
                  <Button variant="outline" onClick={() => exportCatalogue("active")}>Active products</Button>
                  <Button variant="outline" onClick={() => exportCatalogue("active-in-stock")}>Active with stock at this branch</Button>
                  <Button variant="outline" onClick={() => exportCatalogue("archived")}>Archived products only</Button>
                </div>
              </DialogContent>
            </Dialog>

            {canOpenEditor && (
              <Dialog
                open={!!draft}
                onOpenChange={(o) => {
                  setDraft(
                    o
                      ? (draft ??
                          blank(
                            currentStore.id,
                            state.settings.tax.enabled ? state.settings.tax.rate / 100 : 0,
                          ))
                      : null,
                  );
                  if (!o) setBranchPriceOnly(false);
                }}
              >
                {canCreate && (
                  <DialogTrigger asChild>
                    <Button size="sm"
                      onClick={() => {
                        setBranchPriceOnly(false);
                        setDraft(
                          blank(
                            currentStore.id,
                            state.settings.tax.enabled ? state.settings.tax.rate / 100 : 0,
                          ),
                        );
                      }}
                    >
                      <Plus className="size-4" /> New product
                    </Button>
                  </DialogTrigger>
                )}
                <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
                  <DialogHeader>
                    <DialogTitle>{draft?.name ? "Edit product" : "New product"}</DialogTitle>
                  </DialogHeader>
                  {draft && (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Field label="Name" className="sm:col-span-2">
                        <Input
                          disabled={!canChangeDetails}
                          value={draft.name}
                          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                        />
                      </Field>
                      <Field label="SKU">
                        <Input
                          disabled={!canChangeDetails}
                          value={draft.sku}
                          readOnly={autoSku && !skuOverride}
                          placeholder={autoSku ? peekSku(state.products.map((p) => p.sku)) : ""}
                          onChange={(e) => setDraft({ ...draft, sku: e.target.value })}
                        />
                        {autoSku && (
                          <button
                            type="button"
                            className="mt-1 text-[11px] text-muted-foreground underline disabled:opacity-50"
                            disabled={!canChangeDetails}
                            onClick={() => setSkuOverride((v) => !v)}
                          >
                            {skuOverride ? "Use automatic number" : "Override this code"}
                          </button>
                        )}
                      </Field>
                      <Field label="Barcode">
                        <Input
                          disabled={!canChangeDetails}
                          value={draft.barcode}
                          onChange={(e) => setDraft({ ...draft, barcode: e.target.value })}
                        />
                      </Field>
                      <Field label="Category">
                        <ThemedSelect
                          disabled={!canChangeDetails}
                          value={draft.category || NONE}
                          ariaLabel="Category"
                          placeholder="Choose a category"
                          onChange={(v) => setDraft({ ...draft, category: v === NONE ? "" : v })}
                          options={pickerOptions(categoryNames, draft?.category)}
                        />
                      </Field>
                      <Field label="Group">
                        <ThemedSelect
                          disabled={!canChangeDetails}
                          value={draft.group || NONE}
                          ariaLabel="Group"
                          placeholder="Choose a group"
                          onChange={(v) => setDraft({ ...draft, group: v === NONE ? "" : v })}
                          options={pickerOptions(groupNames, draft?.group)}
                        />
                      </Field>
                      <Field label="Sub-category">
                        <ThemedSelect
                          disabled={!canChangeDetails}
                          value={draft.subCategory || NONE}
                          ariaLabel="Sub-category"
                          placeholder="Choose a sub-category"
                          onChange={(v) => setDraft({ ...draft, subCategory: v === NONE ? "" : v })}
                          options={pickerOptions(subNames, draft?.subCategory)}
                        />
                      </Field>
                      <Field label="Unit of measure">
                        <ThemedSelect
                          disabled={!canChangeDetails}
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
                        {!!(draft.variants ?? []).length && (
                          <div className="mb-2 overflow-x-auto rounded-md border">
                            <div
                              className={cn(
                                "grid min-w-[680px] items-center gap-2 border-b bg-muted/40 px-2 py-1.5 text-xs font-medium text-muted-foreground",
                                showMoney
                                  ? "grid-cols-[minmax(10rem,1.4fr)_minmax(9rem,1fr)_7rem_7rem_2rem]"
                                  : "grid-cols-[minmax(10rem,1.4fr)_minmax(9rem,1fr)_7rem_2rem]",
                              )}
                            >
                              <span>Barcode</span>
                              <span>Label / variation</span>
                              {showMoney && <span>Purchase Cost</span>}
                              <span>Selling price</span>
                              <span className="sr-only">Remove</span>
                            </div>
                            {(draft.variants ?? []).map((variant) => (
                              <div
                                key={variant.code}
                                className={cn(
                                  "grid min-w-[680px] items-center gap-2 border-b px-2 py-2 last:border-b-0",
                                  showMoney
                                    ? "grid-cols-[minmax(10rem,1.4fr)_minmax(9rem,1fr)_7rem_7rem_2rem]"
                                    : "grid-cols-[minmax(10rem,1.4fr)_minmax(9rem,1fr)_7rem_2rem]",
                                )}
                              >
                                <span className="numeric truncate text-sm" title={variant.code}>
                                  {variant.code}
                                </span>
                                <Input
                                  disabled={!canLinkBarcode}
                                  value={variant.label ?? ""}
                                  aria-label={`Label for ${variant.code}`}
                                  onChange={(event) =>
                                    setDraft({
                                      ...draft,
                                      variants: (draft.variants ?? []).map((entry) =>
                                        entry.code === variant.code
                                          ? { ...entry, label: event.target.value || undefined }
                                          : entry,
                                      ),
                                    })
                                  }
                                />
                                {showMoney && (
                                  <Input
                                    disabled={!canPrice}
                                    className="numeric"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={variant.cost ?? ""}
                                    placeholder={String(draft.cost)}
                                    aria-label={`Cost for ${variant.code}`}
                                    onChange={(event) =>
                                      setDraft({
                                        ...draft,
                                        variants: (draft.variants ?? []).map((entry) =>
                                          entry.code === variant.code
                                            ? {
                                                ...entry,
                                                cost:
                                                  event.target.value.trim() === ""
                                                    ? undefined
                                                    : Number(event.target.value),
                                              }
                                            : entry,
                                        ),
                                      })
                                    }
                                  />
                                )}
                                <Input
                                  disabled={!canPrice}
                                  className="numeric"
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={variant.price ?? ""}
                                  placeholder={String(draft.price)}
                                  aria-label={`Selling price for ${variant.code}`}
                                  onChange={(event) =>
                                    setDraft({
                                      ...draft,
                                      variants: (draft.variants ?? []).map((entry) =>
                                        entry.code === variant.code
                                          ? {
                                              ...entry,
                                              price:
                                                event.target.value.trim() === ""
                                                  ? undefined
                                                  : Number(event.target.value),
                                            }
                                          : entry,
                                      ),
                                    })
                                  }
                                />
                                <button
                                  type="button"
                                  className="text-lg text-destructive"
                                  aria-label={`Remove variant ${variant.code}`}
                                  disabled={!canLinkBarcode}
                                  onClick={() =>
                                    setDraft({
                                      ...draft,
                                      variants: (draft.variants ?? []).filter(
                                        (entry) => entry.code !== variant.code,
                                      ),
                                    })
                                  }
                                >
                                  ×
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="flex flex-wrap gap-1">
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
                                disabled={!canLinkBarcode}
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
                        <div
                          className={cn(
                            "mt-1 grid grid-cols-1 gap-2",
                            showMoney
                              ? "sm:grid-cols-[minmax(12rem,1.5fr)_minmax(9rem,1fr)_7rem_7rem]"
                              : "sm:grid-cols-[minmax(12rem,1.5fr)_minmax(9rem,1fr)_7rem]",
                          )}
                        >
                          <Input
                            disabled={!canLinkBarcode}
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
                                  {
                                    code,
                                    label: variantLabel.trim() || undefined,
                                    cost:
                                      showMoney && variantCost.trim() !== ""
                                        ? Number(variantCost)
                                        : undefined,
                                    price:
                                      variantPrice.trim() !== "" ? Number(variantPrice) : undefined,
                                  },
                                ],
                              });
                              setAliasDraft("");
                              setVariantLabel("");
                              setVariantCost("");
                              setVariantPrice("");
                            }}
                          />
                          <Input
                            disabled={!canLinkBarcode}
                            value={variantLabel}
                            placeholder="Label (colour, size, pack)"
                            onChange={(e) => setVariantLabel(e.target.value)}
                          />
                          {showMoney && (
                            <Input
                              disabled={!canPrice}
                              type="number"
                              min="0"
                              step="0.01"
                              value={variantCost}
                              placeholder={`Cost (${draft.cost})`}
                              aria-label="Variation cost"
                              className="numeric"
                              onChange={(event) => setVariantCost(event.target.value)}
                            />
                          )}
                          <Input
                            disabled={!canPrice}
                            type="number"
                            min="0"
                            step="0.01"
                            value={variantPrice}
                            placeholder={`Selling (${draft.price})`}
                            aria-label="Variation selling price"
                            className="numeric"
                            onChange={(event) => setVariantPrice(event.target.value)}
                          />
                        </div>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Press Enter in the barcode box to add. Codes already used anywhere in the
                          catalogue are refused, and every variant scans to this product.
                        </p>
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
                      <Field label="Tax rate (%)">
                        <Input
                          disabled={!canPrice || branchPriceOnly}
                          className="numeric"
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          value={Number((draft.taxRate * 100).toFixed(4))}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              taxRate:
                                Math.min(100, Math.max(0, Number(e.target.value) || 0)) / 100,
                            })
                          }
                        />
                      </Field>
                      {canEcom && (
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
                      )}
                      {state.products.some((product) => product.id === draft.id) && (
                        <Field label="Price scope" className="sm:col-span-2">
                          <div className="flex items-center justify-between gap-3 rounded-md border p-3">
                            <div>
                              <p className="text-sm font-medium">
                                Use these prices only at {currentStore.name}
                              </p>
                              <p className="text-[11px] text-muted-foreground">
                                Keeps the global product price unchanged. Only permitted prices are saved in this mode.
                              </p>
                            </div>
                            <Switch
                              disabled={!canPrice}
                              checked={branchPriceOnly}
                              onCheckedChange={setBranchPriceOnly}
                            />
                          </div>
                        </Field>
                      )}
                      {showMoney && (
                        <Field label="Purchase Cost">
                          <Input
                            disabled={!canPrice || branchPriceOnly}
                            className="numeric"
                            value={draft.cost}
                            onChange={(e) =>
                              setDraft({ ...draft, cost: Number(e.target.value) || 0 })
                            }
                          />
                        </Field>
                      )}
                      <Field label={`Stock · ${currentStore.code}`}>
                        <output aria-label={`Stock at ${currentStore.code}`} className="numeric flex h-10 items-center rounded-lg border bg-muted/40 px-3">{stockAt(draft, currentStore.id)}</output>
                        <p className="text-xs text-muted-foreground">View only. Add stock through purchases; use transfers or authorized stock adjustments for corrections.</p>
                      </Field>
                      <Field label="Reorder level">
                        <Input
                          disabled={!canEditDetails}
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
                      disabled={
                        draftIsExisting
                          ? branchPriceOnly
                            ? !canPrice
                            : !(canChangeDetails || canPrice || canAdjustStock || canLinkBarcode)
                          : !canCreate
                      }
                      onClick={async () => {
                        if (draftIsExisting && draft && !catalogueVisible(draft, state.currentStoreId)) {
                          toast.error("This product is not in the selected branch's catalogue", { description: "Switch back to its branch before saving these changes." });
                          return;
                        }
                        if (!draft?.name.trim()) {
                          toast.error("Product name is required");
                          return;
                        }
                        const codeProblems = branchPriceOnly
                          ? []
                          : productCodeProblems(state.products, draft);
                        if (codeProblems.length) {
                          toast.error("SKU or barcode is already in use", {
                            description: codeProblems.join(" "),
                          });
                          return;
                        }
                        try {
                          const sku =
                            draft.sku.trim() ||
                            (autoSku
                              ? await nextSku(state.products.map((p) => p.sku), {
                                  storeId: currentStore.id,
                                  terminalId: localTerminalId(),
                                })
                              : "");
                          // Saved only once the write is confirmed stored.
                          let target;
                          if (branchPriceOnly) {
                            // prettier-ignore -- security regression test asserts this scoped write signature.
                            target = await upsertProductPriceOverride(
                              draft.id,
                              draft.price,
                              canEcom ? draft.ecomPrice : undefined,
                            );
                          } else {
                            target = await upsertProduct({ ...draft, sku }, { catalogOnly: true, includeEcommerce: canEcom, includeCost: showMoney });
                          }
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
        <InventoryCatalogueStatus ready={inventoryReady} loadPhase={loadPhase} activeCount={metrics.products} archivedCount={archivedCount} shownCount={rows.length} showArchived={showArchived} filters={appliedFilters}>
          {showStockValue && Math.abs(metrics.costValue) >= 0.005 && <p>Active purchase cost value <span className="numeric [overflow-wrap:anywhere]">{money(metrics.costValue)}</span></p>}
          {metrics.lowStock > 0 && <p className="text-warning"><AnimatedMetric value={metrics.lowStock} /> at or below reorder level (positive stock)</p>}
        </InventoryCatalogueStatus>
        {showMoney && costReviewOnly && <p role="status" className="rounded-xl border px-4 py-3 text-sm text-muted-foreground">Showing items with missing, zero or invalid cost. Open an item to review it using your existing edit permissions. Zero may be intentional for a free item; no costs are changed automatically.</p>}

        <InventorySummaryCards metrics={metrics} ready={inventoryReady} loadPhase={loadPhase} showStockValue={showStockValue} totalUnitCostValue={totalUnitCostValue} productLabel="Active products" />

        <Dialog open={advanced} onOpenChange={setAdvanced}>
          <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader><DialogTitle>Filter products</DialogTitle></DialogHeader>
            <div className="flex flex-wrap gap-4">
          {advanced && (
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
          )}
          {advanced && (
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
          )}
          {advanced && (
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
          )}
          {advanced && (
            <>
              <div className="space-y-1">
                <Label className="text-xs">SKU or barcode</Label>
                <Input
                  value={skuFilter}
                  onChange={(e) => setSkuFilter(e.target.value)}
                  className="h-9 w-48"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Stock</Label>
                <ThemedSelect
                  value={stockFilter}
                  onChange={setStockFilter}
                  className="w-40"
                  options={[
                    { value: "all", label: "Any stock" },
                    { value: "in", label: "In stock" },
                    { value: "low", label: "Low stock" },
                    { value: "out", label: "Out of stock" },
                    { value: "negative", label: "Negative stock" },
                  ]}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Price range</Label>
                <div className="flex gap-1">
                  <Input
                    type="number"
                    min="0"
                    value={minPrice}
                    onChange={(e) => setMinPrice(e.target.value)}
                    placeholder="Min"
                    className="h-9 w-24"
                  />
                  <Input
                    type="number"
                    min="0"
                    value={maxPrice}
                    onChange={(e) => setMaxPrice(e.target.value)}
                    placeholder="Max"
                    className="h-9 w-24"
                  />
                </div>
              </div>
              {showMoney && (
                <div className="space-y-1">
                  <Label className="text-xs">Minimum margin %</Label>
                  <Input
                    type="number"
                    value={minMargin}
                    onChange={(e) => setMinMargin(e.target.value)}
                    className="h-9 w-36"
                  />
                </div>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setCatFilter("all");
                  setGroupFilter("all");
                  setSubFilter("all");
                  setSkuFilter("");
                  setStockFilter("all");
                  setMinPrice("");
                  setMaxPrice("");
                  setMinMargin("");
                }}
              >
                Clear filters
              </Button>
            </>
          )}
            </div>
          </DialogContent>
        </Dialog>

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
                    disabled={bulkSaving}
                    onClick={async () => {
                      const name = bulkCategory.trim();
                      if (!name) return toast.error("Type the category to move them to");
                      setBulkSaving(true);
                      try {
                        await patchProducts(selected, { category: name });
                        setBulkCategory("");
                        toast.success(`${selected.length} products moved to ${name}`);
                      } catch (error) {
                        notifyError(error, "Updating product categories");
                      } finally {
                        setBulkSaving(false);
                      }
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
              {canArchive && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={deleting.length > 0}
                  onClick={async () => {
                    setDeleting(selected);
                    try {
                      await archiveProducts(selected);
                      toast.success(
                        `${selected.length} product${selected.length > 1 ? "s" : ""} archived`,
                      );
                      setSelected([]);
                    } catch (error) {
                      notifyError(error, "Archiving selected products");
                    } finally {
                      setDeleting([]);
                    }
                  }}
                >
                  <Archive className="size-4" />
                  {deleting.length > 1 ? "Archiving…" : "Archive selected"}
                </Button>
              )}
            </div>
          </div>
        )}

        <div className="rounded-lg border border-border bg-card">
          <Table tableId="routes/inventory#1" className="inventory-products" columnControls layoutControls controlsTarget={columnControlsTarget}>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allShownSelected}
                    onCheckedChange={(v) => setSelected(v ? pageRows.map((p) => p.id) : [])}
                    aria-label="Select all products"
                  />
                </TableHead>
                <TableHead className="min-w-24">Product</TableHead>
                <TableHead className="min-w-24">Category</TableHead>
                <TableHead className="min-w-24">Sub-category</TableHead>
                {showMoney && <TableHead className="min-w-24 text-right" title="Supplier purchase cost before freight or overhead">Purchase Cost</TableHead>}
                {showMoney && <TableHead className="min-w-28 text-right" title="Estimated purchase cost plus allocated charges and overhead">Total Unit Cost</TableHead>}
                <TableHead className="min-w-24 text-right">Price</TableHead>
                {showMoney && <TableHead className="min-w-24 text-right" title="Selling price less Total Unit Cost, divided by selling price">Margin</TableHead>}
                {canEcom && <TableHead className="min-w-24 text-center">On web</TableHead>}
                <TableHead className="min-w-24 text-center">Stock · {currentStore.code}</TableHead>
                <TableHead className="min-w-24 text-center">Other stores</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((p) => (
                <TableRow key={p.id} data-expanded={expandedProducts.includes(p.id)}>
                  <TableCell className="inventory-selection">
                    <Checkbox
                      checked={selected.includes(p.id)}
                      onCheckedChange={(v) => toggle(p.id, !!v)}
                      aria-label={`Select ${p.name}`}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="min-w-0">
                      <button
                        className="text-left font-medium hover:text-primary"
                        disabled={!canEditDetails && !canPrice && !canAdjustStock && !canLinkBarcode}
                        onClick={() => {
                          setBranchPriceOnly(false);
                          setDraft(p);
                        }}
                      >
                        {p.name}
                      </button>
                      <div className="numeric text-[11px] text-muted-foreground">
                        {p.sku} · {p.barcode}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="inventory-detail text-muted-foreground">{p.category}</TableCell>
                  <TableCell className="inventory-detail text-muted-foreground">{p.subCategory || "—"}</TableCell>
                  {showMoney && (
                    <TableCell className="inventory-detail numeric text-right">{Number.isFinite(p.cost) ? money(p.cost) : "—"}{needsCostReview(p.cost) && <span className="ml-1 text-xs text-warning" title="Cost is missing, zero or invalid. Zero may be intentional.">Review</span>}</TableCell>
                  )}
                  {showMoney && <TableCell className="inventory-detail numeric text-right">
                    {totalUnitCost(p.cost, p.id, state.settings.integrations.totalUnitCost) === null ? "—" : money(totalUnitCost(p.cost, p.id, state.settings.integrations.totalUnitCost)!)}
                    <span className="block text-[10px] text-muted-foreground">{state.settings.integrations.totalUnitCost?.overrides?.[p.id] ? "Custom" : "Default"}</span>
                  </TableCell>}
                  <TableCell className="numeric text-right">{money(p.price)}</TableCell>
                  {showMoney && (
                    <TableCell className="inventory-detail numeric text-right text-accent">
                      {inventoryUnitMargin(p, state.settings.integrations.totalUnitCost) === null ? "—" : `${Math.round(inventoryUnitMargin(p, state.settings.integrations.totalUnitCost)!)}%`}
                    </TableCell>
                  )}
                  {canEcom && (
                    <TableCell className="inventory-detail text-center">
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
                          stockAt(p, currentStore.id) <= 0 || isLowStock(stockAt(p, currentStore.id), p.reorderLevel)
                            ? "border-warning/50 text-warning"
                            : ""
                        }`}
                      >
                        {stockAt(p, currentStore.id)} in stock
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <OtherSourcesPopover
                      product={p}
                      stores={stores}
                      currentStoreId={currentStore.id}
                    />
                  </TableCell>
                  <TableCell className="inventory-actions text-right">
                    <Button
                      className="inventory-details-toggle"
                      size="sm"
                      variant="ghost"
                      aria-label={`${expandedProducts.includes(p.id) ? "Less" : "More"} details for ${p.name}`}
                      aria-expanded={expandedProducts.includes(p.id)}
                      onClick={() => setExpandedProducts(ids => ids.includes(p.id) ? ids.filter(id => id !== p.id) : [...ids, p.id])}
                    >
                      {expandedProducts.includes(p.id) ? "Less details" : "More details"}
                    </Button>
                    {isAdmin && showMoney && <Button
                      size="icon"
                      variant="ghost"
                      title={`Edit Total Unit Cost for ${p.name}`}
                      aria-label={`Edit Total Unit Cost for ${p.name}`}
                      onClick={() => setUnitCostEdit({ ids: [p.id], initialTarget: "selected", productName: p.name })}
                    ><Pencil className="size-4" /></Button>}
                    <Button
                      size="icon"
                      variant="ghost"
                      title="View activity log"
                      aria-label={`View activity for ${p.name}`}
                      onClick={() => setLogTarget(p)}
                    >
                      <History className="size-4" />
                    </Button>
                    {canArchive && (
                      <Button
                        size="icon"
                        variant="ghost"
                        disabled={deleting.includes(p.id)}
                        title={deleting.includes(p.id) ? "Archiving…" : "Archive"}
                        aria-label={`Archive ${p.name}`}
                        onClick={async () => {
                          setDeleting((d) => [...d, p.id]);
                          try {
                            await archiveProducts([p.id]);
                            toast.success("Product archived");
                          } catch (error) {
                            notifyError(error, `Archiving ${p.name}`);
                          } finally {
                            setDeleting((d) => d.filter((id) => id !== p.id));
                          }
                        }}
                      >
                        {deleting.includes(p.id) ? (
                          <Loader2 className="size-4 animate-spin text-muted-foreground" />
                        ) : (
                          <Archive className="size-4" />
                        )}
                      </Button>
                    )}
                    {canRestore && p.archived && (
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
      {canBulk && <BulkImportDialog open={importOpen} onOpenChange={setImportOpen} />}
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
      <Dialog open={duplicateOpen} onOpenChange={setDuplicateOpen}>
        <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Duplicate SKU and barcode values</DialogTitle>
            <p className="text-sm text-muted-foreground">
              Each code must belong to one product. Open a product to correct its SKU, primary
              barcode, alias, or variant code.
            </p>
          </DialogHeader>
          <Table tableId="routes/inventory#2">
            <TableHeader>
              <TableRow>
                <TableHead>Duplicate code</TableHead>
                <TableHead>Products using it</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {duplicatePager.pageItems.map((entry) => (
                <TableRow key={entry.code}>
                  <TableCell className="font-mono font-medium">{entry.code}</TableCell>
                  <TableCell>{entry.products.map((product) => product.name).join(", ")}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canEditDetails}
                      title={
                        canEditDetails
                          ? "Edit the first product using this code"
                          : "Edit product details permission required"
                      }
                      onClick={() => {
                        const product = state.products.find(
                          (candidate) => candidate.id === entry.products[0]?.id,
                        );
                        if (product) {
                          setDuplicateOpen(false);
                          setBranchPriceOnly(false);
                          setDraft(product);
                        }
                      }}
                    >
                      Open product
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <TablePagination
            page={duplicatePager.page}
            pageCount={duplicatePager.pageCount}
            pageSize={duplicatePager.pageSize}
            total={duplicatePager.total}
            from={duplicatePager.from}
            to={duplicatePager.to}
            label="duplicate codes"
            onPage={duplicatePager.setPage}
            onPageSize={duplicatePager.setPageSize}
          />
        </DialogContent>
      </Dialog>
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
