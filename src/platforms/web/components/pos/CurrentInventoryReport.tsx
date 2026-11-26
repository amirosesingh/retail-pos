import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Boxes, ChevronDown, Columns3, Download, Layers3, Search, WalletCards } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { stockDisplayLocations } from "@/lib/all-shops-stock";
import { canonicalBranchId, sameBranchId } from "@/lib/branch-id";
import { createCatalogueVisibility } from "@/lib/branch-policy";
import {
  ALL_INVENTORY_LOCATIONS, buildCurrentInventory, currentInventoryDefaults, currentInventoryLocations,
  productBarcodes, type CurrentInventoryFilters, type CurrentInventoryRow,
} from "@/lib/current-inventory-report";
import { formatMoney } from "@/lib/currency";
import { beginDataTask } from "@/lib/data-progress";
import { managementInventoryReader, toManagementReportProduct, useManagementInventory } from "@/lib/management-inventory-client";
import { notifyError } from "@/lib/notify";
import { usePersonalAppearance } from "@/lib/personal-appearance";
import { useAuth } from "@/lib/pos-auth";
import { usePos } from "@/lib/pos-store";
import { sessionEpoch } from "@/lib/session-epoch";
import { subscribeSyncState, syncState } from "@/lib/sync-status";
import { tableColumnHidden } from "@/lib/table-column-policy";
import { formatDateTime } from "@/lib/time-zone";
import { currentPlatform } from "@/platform-config/features";
import type { Store } from "@/core/types/pos-types";
import { ColumnResizer } from "./ColumnResizer";
import { downloadCsv } from "./report-kit";
import { TablePagination, usePagination } from "./TablePagination";
import { ThemedSelect, type ThemedSelectOption } from "./ThemedSelect";

const TABLE_ID = "reports/inventory-current";
const MAX_DOWNLOAD_ROWS = 20_000;
const quantityLabel = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 3 });
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const locationTypes: Record<string, string> = {
  store: "Branch", main_building: "Main building", sub_warehouse: "Sub-warehouse", central_warehouse: "Central warehouse",
};
const statuses = [{ value: "active", label: "Active" }, { value: "archived", label: "Archived" }];
const availabilities = [
  { value: "positive", label: "In stock" }, { value: "low", label: "Low stock" },
  { value: "zero", label: "Zero stock" }, { value: "negative", label: "Negative stock" },
];
const groupOptions = [{ value: "location", label: "Location" }, { value: "brand", label: "Brand" }, { value: "category", label: "Category" }];
const optionList = (values: Iterable<string | undefined>) =>
  [...new Set([...values].filter((value): value is string => Boolean(value)))].sort(collator.compare).map(value => ({ value, label: value }));

type Value = string | number | null;
type Column = { key: string; label: string; value: (row: CurrentInventoryRow) => Value; money?: boolean; width: number };
const columns: Column[] = [
  { key: "name", label: "Product", value: row => row.product.name, width: 230 },
  { key: "id", label: "Product ID", value: row => row.product.id, width: 150 },
  { key: "sku", label: "SKU", value: row => row.product.sku, width: 105 },
  { key: "barcode", label: "Barcode", value: row => row.product.barcode, width: 130 },
  { key: "brand", label: "Brand", value: row => row.product.brand ?? "", width: 120 },
  { key: "category", label: "Category", value: row => row.product.category, width: 135 },
  { key: "subCategory", label: "Subcategory", value: row => row.product.subCategory ?? "", width: 135 },
  { key: "location", label: "Location", value: row => row.location.name, width: 145 },
  { key: "quantity", label: "On hand", value: row => row.quantity, width: 105 },
  { key: "unitCost", label: "Unit cost", value: row => row.unitCost, money: true, width: 118 },
  { key: "stockCost", label: "Stock cost value", value: row => row.stockCost, money: true, width: 132 },
  { key: "retailPrice", label: "Selling price", value: row => row.retailPrice, money: true, width: 118 },
  { key: "stockRetail", label: "Retail stock value", value: row => row.stockRetail, money: true, width: 142 },
  { key: "evidence", label: "Data status", value: () => "Current balance", width: 139 },
  { key: "status", label: "Product status", value: row => row.product.archived ? "Archived" : "Active", width: 130 },
];
const initialColumns = new Set(["name", "sku", "barcode", "category", "location", "quantity", "stockCost", "stockRetail", "evidence"]);
const defaultHidden = columns.flatMap((column, index) => initialColumns.has(column.key) ? [] : [index]);
const defaultValuationHidden = defaultHidden.filter(index => !["unitCost", "retailPrice"].includes(columns[index]!.key));
const groupValue = (row: CurrentInventoryRow, group: string) => group === "location" ? row.location.name
  : group === "brand" ? row.product.brand || "Unassigned brand" : group === "category" ? row.product.category || "Unassigned category" : "";
const groupKey = (row: CurrentInventoryRow, group: string) => group === "location" ? canonicalBranchId(row.location.id) : groupValue(row, group);

function compareValues(left: Value, right: Value, descending: boolean) {
  if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
  const difference = typeof left === "number" && typeof right === "number" ? left - right : collator.compare(String(left), String(right));
  return descending ? -difference : difference;
}

function Filter({ id, label, value, options, setValue, empty }: {
  id: string; label: string; value: string; options: ThemedSelectOption[]; setValue: (value: string) => void; empty?: string;
}) {
  return <div className="min-w-0 space-y-1.5">
    <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">{label}</Label>
    <ThemedSelect id={id} ariaLabel={label} value={value || "report:unfiltered"}
      options={empty ? [{ value: "report:unfiltered", label: empty }, ...options] : options}
      onChange={next => setValue(next === "report:unfiltered" ? "" : next)} />
  </div>;
}

export function CurrentInventoryReport({ branchId, branchName, valuation = false, refreshToken = 0, managementLocations }: {
  branchId: string; branchName: string; valuation?: boolean; refreshToken?: number; managementLocations?: Store[];
}) {
  const { state, stores, storesLoaded, ready, loadPhase } = usePos();
  const { can, user, canSwitchStores, terminalStoreId, isAdmin } = useAuth();
  const { profile, editable, update } = usePersonalAppearance();
  const sync = useSyncExternalStore(subscribeSyncState, syncState, syncState);
  const filterId = useId();
  const mayRead = can("can_view_inventory");
  const mayRequestValue = mayRead && can("can_view_cost_margin");
  const mayRequestExport = mayRead && can("can_export_reports");
  const directory = useMemo(() => managementLocations ?? stockDisplayLocations(stores, {
    currentStoreId: branchId, terminalStoreId, userStoreId: user?.storeId, canSwitchStores,
  }), [managementLocations, stores, branchId, terminalStoreId, user?.storeId, canSwitchStores]);
  const visibility = useMemo(() => createCatalogueVisibility(state.settings, state.stores, state.transfers),
    [state.settings, state.stores, state.transfers]);
  const [draft, setDraft] = useState(() => currentInventoryDefaults(branchId));
  const [applied, setApplied] = useState(draft);
  const [sort, setSort] = useState({ column: "name", descending: false });
  const [group, setGroup] = useState("");
  const [details, setDetails] = useState<string | null>(null);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [exporting, setExporting] = useState(false);
  const locationOptions = directory.map(location => ({ value: canonicalBranchId(location.id), label: location.name }));
  if ((managementLocations || (canSwitchStores && !terminalStoreId && !user?.storeId)) && locationOptions.length > 1) {
    locationOptions.unshift({ value: ALL_INVENTORY_LOCATIONS, label: "All authorized locations" });
  }
  const locationChoice = (value: string) => locationOptions.some(option => option.value === value)
    ? value : (locationOptions.find(option => sameBranchId(option.value, branchId))?.value ?? locationOptions[0]?.value ?? "");
  const selectedLocation = locationChoice(applied.location);
  const localInventory = useManagementInventory(managementLocations && selectedLocation && mayRead ? (
    selectedLocation === ALL_INVENTORY_LOCATIONS ? { kind: "current", all: true } : { kind: "current", branchId: selectedLocation }
  ) : null, JSON.stringify([refreshToken, sync.lastSyncAt]));
  const mayValue = mayRequestValue && (!managementLocations || (localInventory?.ok === true && localInventory.canViewCost === true));
  const mayExport = mayRequestExport && (!managementLocations || (localInventory?.ok === true && localInventory.canExportReports === true));
  const snapshotReady = mayRead && (managementLocations ? localInventory?.ok === true && !!localInventory.products
    : ready && storesLoaded && loadPhase === "ready" && sameBranchId(state.currentStoreId, branchId) && directory.length > 0);
  const products = useMemo(() => managementLocations ? (localInventory?.ok ? localInventory.products?.map(toManagementReportProduct) ?? [] : [])
    : snapshotReady ? state.products.filter(product => directory.some(location => visibility(product, location.id))) : [],
  [managementLocations, localInventory, snapshotReady, state.products, directory, visibility]);
  const visibleAt = useCallback((product: Parameters<typeof visibility>[0], id: string) => managementLocations
    ? typeof product !== "string" && !!product.stockByStore && Object.hasOwn(product.stockByStore, canonicalBranchId(id))
    : visibility(product, id), [managementLocations, visibility]);
  const localPrices = useMemo(() => new Map(localInventory?.ok ? localInventory.products?.map(product => [product.id, product.retailPriceByStore]) : []), [localInventory]);
  const scopedSellingPrice = useCallback((productId: string, locationId: string) => localPrices.get(productId)?.[locationId], [localPrices]);
  const filters = useMemo(() => ({ ...applied, location: selectedLocation }), [applied, selectedLocation]);
  const locations = useMemo(() => currentInventoryLocations(directory, filters), [directory, filters]);
  const data = useMemo(() => buildCurrentInventory(products, locations, filters, visibleAt, branchId, mayValue,
    managementLocations ? scopedSellingPrice : undefined),
    [products, locations, filters, visibleAt, branchId, mayValue, managementLocations, scopedSellingPrice]);
  const allowedColumns = columns.filter((column, index) => column.key === "name" || ((!column.money || mayValue) &&
    !tableColumnHidden(state.settings.visibility?.hidden ?? {}, TABLE_ID, index,
      isAdmin ? "admin" : user?.metaRole ?? user?.role ?? null, user?.staffId ?? null, user?.permissions)));
  const hidden = profile.tableViews[TABLE_ID] ?? (valuation ? defaultValuationHidden : defaultHidden);
  const shownColumns = allowedColumns.filter(column => column.key === "name" || !hidden.includes(columns.indexOf(column)));
  const selectedSort = shownColumns.find(column => column.key === sort.column) ?? columns[0]!;
  const sorted = useMemo(() => [...data.rows].sort((left, right) =>
    collator.compare(groupValue(left, group), groupValue(right, group)) ||
    groupKey(left, group).localeCompare(groupKey(right, group)) ||
    compareValues(selectedSort.value(left), selectedSort.value(right), sort.descending) ||
    collator.compare(left.product.name, right.product.name) ||
    collator.compare(left.location.name, right.location.name) || left.key.localeCompare(right.key)),
  [data.rows, group, selectedSort, sort.descending]);
  const pager = usePagination(sorted, 25);
  const web = currentPlatform() === "web";
  const lastSyncAt = web ? null : sync.lastSyncAt;
  const freshness = web ? "Inventory snapshot" : sync.pending > 0 ? "Device synchronization pending"
    : sync.phase === "offline" ? "Offline snapshot" : sync.lastError ? "Synchronization needs attention" : "Latest available snapshot";
  const epoch = sessionEpoch();
  const authority = JSON.stringify([epoch, user?.staffId, branchId, directory.map(location => location.id),
    snapshotReady, mayExport, mayValue, shownColumns.map(column => column.key), filters, sort, group, refreshToken]);
  const currentAuthority = useRef(authority);
  currentAuthority.current = authority;
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const title = valuation ? "Current stock valuation" : "Current stock";
  const filterLabels: [string, string][] = [
    ["Search", filters.query], ["Location type", locationTypes[filters.locationType] ?? ""],
    ["Brand", filters.brand], ["Category", filters.category], ["Subcategory", filters.subCategory],
    ["Product status", statuses.find(option => option.value === filters.status)?.label ?? ""],
    ["Availability", availabilities.find(option => option.value === filters.availability)?.label ?? ""],
  ];
  const namedFilters = filterLabels.filter(([, value]) => value);
  const exportReady = snapshotReady && mayExport && sorted.length > 0 && sorted.length <= MAX_DOWNLOAD_ROWS;
  const change = (key: keyof CurrentInventoryFilters, value: string) => setDraft(current => ({
    ...current, [key]: value, ...(key === "category" ? { subCategory: "" } : {}),
  }));
  const applyFilters = (next: CurrentInventoryFilters) => {
    setApplied(next);
    setDetails(null);
    pager.setPage(1);
  };
  const selectColumn = (column: Column) => {
    const position = columns.indexOf(column);
    update({ tableViews: { ...profile.tableViews, [TABLE_ID]: hidden.includes(position)
      ? hidden.filter(value => value !== position) : [...hidden, position] } });
  };
  async function exportData(format: "xlsx" | "csv") {
    if (!exportReady) return;
    const canFinish = () => mounted.current && sessionEpoch() === epoch && currentAuthority.current === authority;
    setExporting(true);
    const task = beginDataTask("Exporting stock report");
    try {
      if (managementLocations) {
        const result = await managementInventoryReader()?.(selectedLocation === ALL_INVENTORY_LOCATIONS
          ? { kind: "authorize-export", all: true } : { kind: "authorize-export", branchId: selectedLocation });
        if (!canFinish()) return;
        if (!result?.ok) throw new Error(result?.error ?? "The Management export permission could not be verified.");
        if (mayValue && !result.canViewCost) return;
      }
      const reportDetails: (string | number)[][] = [
        ["Company", state.settings.receipt.companyName || branchName], ["Report", title],
        ["Locations", locations.map(location => location.name).join(", ")],
        ["Generated at", new Date().toISOString()], ["Generated by", user?.name || user?.staffId || ""],
        ["Data freshness", freshness],
        ...(!web ? [["Last successful device synchronization", lastSyncAt ?? "Unavailable"]] : []),
        ["Data status", "Current balance"], ["Products / SKUs", data.products], ["On-hand quantity", data.quantity],
      ];
      if (mayValue) reportDetails.push(["Stock cost value", data.cost ?? "Unavailable"], ["Retail stock value", data.retail ?? "Unavailable"]);
      reportDetails.push(...namedFilters);
      const rows = [shownColumns.map(column => column.label),
        ...sorted.map(row => shownColumns.map(column => column.value(row) ?? (column.money ? "Unavailable" : "")))];
      if (format === "csv") {
        if (canFinish()) downloadCsv("stock-report", [...rows, [], ...reportDetails]);
        return;
      }
      const [xlsx, { reportWorksheet }] = await Promise.all([import("xlsx"), import("@/lib/report-export")]);
      if (!canFinish()) return;
      const book = xlsx.utils.book_new();
      const worksheet = await reportWorksheet(rows);
      if (!canFinish()) return;
      xlsx.utils.book_append_sheet(book, worksheet, "Stock report");
      xlsx.utils.book_append_sheet(book, xlsx.utils.aoa_to_sheet(reportDetails), "Report details");
      xlsx.writeFile(book, `stock-report-${new Date().toISOString().slice(0, 10)}.xlsx`, { compression: true });
    } catch (error) {
      if (canFinish()) notifyError(error, "Exporting stock report");
    } finally {
      task.finish();
      if (mounted.current) setExporting(false);
    }
  }

  if (!mayRead || (valuation && !mayRequestValue)) return <p role="status" className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">Stock report permission is required.</p>;
  if (!snapshotReady && !managementLocations) return <p role="status" className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
    {loadPhase === "failed" ? "Current inventory is unavailable." : "Loading current inventory…"}
  </p>;
  const summary = [
    { label: "Products / SKUs", value: quantityLabel(data.products), icon: Boxes },
    { label: "On-hand quantity", value: quantityLabel(data.quantity), icon: Layers3 },
    ...(mayValue ? [
      { label: "Stock cost value", value: data.cost === null ? "Unavailable" : formatMoney(data.cost), icon: WalletCards },
      { label: "Retail stock value", value: data.retail === null ? "Unavailable" : formatMoney(data.retail), icon: WalletCards },
    ] : []),
  ];
  return <section className="min-w-0 space-y-4" aria-label={title}
    data-stock-report-locations={locations.map(location => location.name).join(", ")}
    data-stock-report-filters={namedFilters.map(([label, value]) => `${label} – ${value}`).join(" · ")}>
    <form className="space-y-4 rounded-xl border bg-card p-4" onSubmit={event => { event.preventDefault(); applyFilters(draft); }}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="min-w-0 space-y-1.5 lg:col-span-2">
          <Label htmlFor={`${filterId}-query`} className="text-xs font-medium text-muted-foreground">Product search</Label>
          <div className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input id={`${filterId}-query`} className="h-9 pl-9" placeholder="Product name, ID, SKU or barcode" value={draft.query}
              maxLength={250} onChange={event => change("query", event.target.value)} />
          </div>
        </div>
        <Filter id={`${filterId}-location`} label="Location" value={locationChoice(draft.location)} options={locationOptions} setValue={value => change("location", value)} />
        <Filter id={`${filterId}-location-type`} label="Location type" value={draft.locationType} empty="All location types"
          options={Object.entries(locationTypes).filter(([value]) => directory.some(location => (location.locationType ?? "store") === value))
            .map(([value, label]) => ({ value, label }))} setValue={value => change("locationType", value)} />
        <Filter id={`${filterId}-brand`} label="Brand" value={draft.brand} empty="All brands"
          options={optionList(products.map(product => product.brand))} setValue={value => change("brand", value)} />
        <Filter id={`${filterId}-category`} label="Category" value={draft.category} empty="All categories"
          options={optionList(products.map(product => product.category))} setValue={value => change("category", value)} />
        <Filter id={`${filterId}-subcategory`} label="Subcategory" value={draft.subCategory} empty="All subcategories"
          options={optionList(products.filter(product => !draft.category || product.category === draft.category).map(product => product.subCategory))}
          setValue={value => change("subCategory", value)} />
        <Filter id={`${filterId}-status`} label="Product status" value={draft.status} empty="All statuses" options={statuses} setValue={value => change("status", value)} />
        <Filter id={`${filterId}-availability`} label="Availability" value={draft.availability} empty="Any quantity"
          options={availabilities} setValue={value => change("availability", value)} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm">Generate report</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => {
          const reset = currentInventoryDefaults(branchId);
          setDraft(reset);
          applyFilters(reset);
        }}>Reset filters</Button>
      </div>
    </form>
    {managementLocations && !snapshotReady ? <p role="status" className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
      {localInventory?.ok === false ? localInventory.error : "Loading current inventory from local SQL Server…"}
    </p> : valuation && !mayValue ? <p role="status" className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
      The verified Management account cannot read local stock costs.
    </p> : <>
    <div data-stock-report-print-summary className={`grid grid-cols-2 gap-3 ${mayValue ? "xl:grid-cols-4" : ""}`} aria-label="Filtered stock totals">
      {summary.map(({ label, value, icon: Icon }) => <article key={label} className="min-w-0 rounded-xl border bg-card p-3 sm:p-4">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Icon aria-hidden="true" className="size-4 shrink-0 text-primary" /> {label}
        </div>
        <p className="numeric mt-2 break-words text-xl font-semibold tracking-tight sm:text-2xl">{value}</p>
      </article>)}
    </div>
    {valuation && mayValue && (data.cost === null || data.retail === null) && (
      <div role="status" className="space-y-1 rounded-lg border bg-card p-3 text-sm text-muted-foreground">
        {data.cost === null && <p>A complete stock cost total requires a usable unit cost for every product with stock.</p>}
        {data.retail === null && <p>A complete retail total requires a confirmed selling price for every stocked product at its report location.</p>}
      </div>
    )}
    <div className="min-w-0 overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3 sm:px-4">
        <div className="min-w-0">
          <h2 className="font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">{quantityLabel(sorted.length)} inventory rows · {quantityLabel(data.zero)} zero-stock · {quantityLabel(data.low)} low-stock</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-36">
            <ThemedSelect ariaLabel="Group inventory by" value={group || "report:no-group"}
              options={[{ value: "report:no-group", label: "No grouping" }, ...groupOptions]}
              onChange={next => { setGroup(next === "report:no-group" ? "" : next); pager.setPage(1); }} />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button type="button" variant="outline" size="sm"><Columns3 className="size-4" /> Columns</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
              <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
              {allowedColumns.map(column => <DropdownMenuCheckboxItem key={column.key} checked={shownColumns.includes(column)}
                disabled={!editable || column.key === "name"} onSelect={event => event.preventDefault()}
                onCheckedChange={() => selectColumn(column)}>{column.label}</DropdownMenuCheckboxItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
          {mayExport && <><Button type="button" data-stock-report-export variant="outline" size="sm" disabled={!exportReady || exporting}
            onClick={() => void exportData("xlsx")}><Download className="size-4" /> Excel</Button>
            <Button type="button" variant="outline" size="sm" disabled={!exportReady || exporting}
              onClick={() => void exportData("csv")}>CSV</Button></>}
        </div>
      </div>
      {mayExport && sorted.length > MAX_DOWNLOAD_ROWS && <p role="status" className="border-b px-4 py-2 text-xs text-muted-foreground">Narrow the filters to export up to 20,000 matching rows.</p>}
      <div className="[&_.responsive-table-region]:max-h-[65vh] [&_.responsive-table-region]:overflow-auto">
        <Table aria-label={title} data-stock-report-print-table mobileCards={false} clientDataControls={false}
          style={{ minWidth: shownColumns.reduce((total, column) => total + (widths[column.key] ?? column.width), 0) }} className="table-fixed">
          <colgroup>{shownColumns.map(column => <col key={column.key} style={{ width: widths[column.key] ?? column.width }} />)}</colgroup>
          <TableHeader className="sticky top-0 z-10 bg-muted"><TableRow>{shownColumns.map(column => {
            const active = selectedSort.key === column.key;
            const SortIcon = active ? sort.descending ? ArrowDown : ArrowUp : ArrowUpDown;
            return <TableHead key={column.key} className="relative" aria-sort={active ? sort.descending ? "descending" : "ascending" : "none"}>
              <div className="flex items-center justify-between gap-1">
                <button type="button" className="flex min-w-0 items-center gap-1 py-1 text-left"
                  onClick={() => { setSort({ column: column.key, descending: active && !sort.descending }); pager.setPage(1); }}>
                  <span className="truncate">{column.label}</span><SortIcon className="size-3 shrink-0" aria-hidden="true" />
                </button>
                <ColumnResizer label={`Resize ${column.label} column`} direction="right" min={90} max={450}
                  width={widths[column.key] ?? column.width} onWidth={width => setWidths(current => ({ ...current, [column.key]: width }))} />
              </div>
            </TableHead>;
          })}</TableRow></TableHeader>
          <TableBody>
            {!pager.pageItems.length && <TableRow><TableCell colSpan={shownColumns.length} className="py-8 text-center text-muted-foreground">No inventory matches the selected filters.</TableCell></TableRow>}
            {pager.pageItems.map((row, index) => {
              const grouping = groupValue(row, group);
              const groupStart = grouping && (index === 0 || groupKey(pager.pageItems[index - 1]!, group) !== groupKey(row, group));
              const isOpen = details === row.key;
              return <InventoryRows key={row.key} row={row} shown={shownColumns} allowed={allowedColumns} groupLabel={groupStart ? grouping : ""}
                expanded={isOpen} open={() => setDetails(isOpen ? null : row.key)} />;
            })}
          </TableBody>
        </Table>
      </div>
      <TablePagination {...pager} onPage={pager.setPage} onPageSize={pager.setPageSize} label="inventory rows" />
    </div>
    {mayValue && (data.cost === null || data.retail === null) && <p role="status" className="text-xs text-muted-foreground">
      Valuation is unavailable for some rows. Selling prices use the selected POS location's price scope.
    </p>}
    <p className="text-xs text-muted-foreground">{freshness}{lastSyncAt ? ` · Last successful sync ${formatDateTime(lastSyncAt)}` : ""}</p>
    </>}
  </section>;
}

function InventoryRows({ row, shown, allowed, groupLabel, expanded, open }: {
  row: CurrentInventoryRow; shown: Column[]; allowed: Column[]; groupLabel: string; expanded: boolean; open: () => void;
}) {
  return <>
    {groupLabel && <TableRow><TableCell colSpan={shown.length} className="bg-muted/50 py-2 text-xs font-semibold">{groupLabel}</TableCell></TableRow>}
    <TableRow>{shown.map(column => {
      const value = column.value(row);
      const numeric = column.money || column.key === "quantity";
      return <TableCell key={column.key} className={numeric ? "numeric text-right" : "break-words"}>
        {column.key === "name" ? <button type="button" className="flex items-center gap-2 text-left font-medium" aria-expanded={expanded} onClick={open}>
          <ChevronDown aria-hidden="true" className={`size-4 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} /> <span>{value}</span>
        </button> : column.key === "evidence" ? <Badge variant="secondary" className="font-normal">{value}</Badge>
          : column.money ? typeof value === "number" ? formatMoney(value) : "Unavailable"
            : typeof value === "number" ? quantityLabel(value) : value || "—"}
      </TableCell>;
    })}</TableRow>
    {expanded && <TableRow><TableCell colSpan={shown.length} className="bg-muted/35">
      <dl className="grid gap-3 py-1 text-xs sm:grid-cols-2 lg:grid-cols-4">
        {allowed.some(column => column.key === "id") && <div><dt className="text-muted-foreground">Product ID</dt><dd className="break-all">{row.product.id}</dd></div>}
        {allowed.some(column => column.key === "barcode") && <div><dt className="text-muted-foreground">Barcodes</dt><dd className="break-all">{productBarcodes(row.product).join(", ") || "—"}</dd></div>}
        <div><dt className="text-muted-foreground">Reorder level</dt><dd>{quantityLabel(row.product.reorderLevel)}</dd></div>
        <div><dt className="text-muted-foreground">Stock unit</dt><dd>{row.product.unit || "—"}</dd></div>
      </dl>
    </TableCell></TableRow>}
  </>;
}
