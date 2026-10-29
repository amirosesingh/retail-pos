import * as React from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, ArrowUpDown, Filter, Loader2, Columns3, Tickets, Shapes, CalendarClock, WalletCards, X, Maximize2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { TablePagination, usePagination } from "@/platforms/web/components/pos/TablePagination";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useAuthOptional } from "@/lib/pos-auth";
import { usePosOptional } from "@/lib/pos-store";
import { usePersonalAppearance } from "@/lib/personal-appearance";
import { catalogColumnPositions, tableColumnHidden } from "@/lib/table-column-policy";

type TableSortDirection = "asc" | "desc";
type TableSortState = { column: number; direction: TableSortDirection } | null;
type TableFilters = Record<number, string>;
type ColumnWidths = Record<number, number>;

type TableControls = {
  clientDataControls: boolean;
  sort: TableSortState;
  toggleSort: (column: number) => void;
  filters: TableFilters;
  activeFilter: number | null;
  setActiveFilter: (column: number | null) => void;
  setFilter: (column: number, value: string) => void;
  widths: ColumnWidths;
  startResize: (column: number, event: React.PointerEvent<HTMLElement>) => void;
  resizeBy: (column: number, delta: number, fallbackWidth: number) => void;
};

const TableControlsContext = React.createContext<TableControls | null>(null);

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, children, ...props }, ref) => {
  return (
    <thead ref={ref} className={cn("bg-muted/45 [&_tr]:border-b", className)} {...props}>
      {assignHeaderColumns(children)}
    </thead>
  );
});
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
));
TableBody.displayName = "TableBody";

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn("border-t bg-muted/50 font-medium [&>tr]:last:border-b-0", className)}
    {...props}
  />
));
TableFooter.displayName = "TableFooter";

type TableRowProps = React.HTMLAttributes<HTMLTableRowElement> & { summaryValues?: Record<string, number> };
const TableRow = React.forwardRef<HTMLTableRowElement, TableRowProps>(
  ({ className, summaryValues: _summaryValues, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        "border-b border-border/60 transition-colors duration-[var(--motion-fast)] hover:bg-muted/40 data-[state=selected]:bg-primary/10",
        className,
      )}
      {...props}
    />
  ),
);
TableRow.displayName = "TableRow";

type TableHeadProps = React.ThHTMLAttributes<HTMLTableCellElement> & {
  "data-sortable"?: boolean | "true" | "false";
  "data-table-column"?: number;
};

const TableHead = React.forwardRef<HTMLTableCellElement, TableHeadProps>(
  ({ className, children, ...props }, ref) => {
    const controls = React.useContext(TableControlsContext);
    const column = props["data-table-column"] ?? 0;
    const label = plainText(children);
    const HeaderIcon = /receipt|invoice|bill no/i.test(label) ? Tickets : /product|item/i.test(label) ? Shapes : /date|created|time/i.test(label) ? CalendarClock : /total|amount|price|cost/i.test(label) ? WalletCards : null;
    const heading = HeaderIcon ? <span className="inline-flex items-center gap-1.5"><HeaderIcon strokeWidth={1.75} aria-hidden="true" className="size-3.5 shrink-0 text-category-1" />{children}</span> : children;
    const sortable =
      controls &&
      props["data-sortable"] !== false &&
      props["data-sortable"] !== "false" &&
      sortableHeaderLabel(label) &&
      !hasInteractiveContent(children) &&
      Number(props.colSpan ?? 1) === 1;
    const dataControls = sortable && controls.clientDataControls;
    const active = dataControls && controls.sort?.column === column;
    const direction = active ? controls.sort?.direction : null;
    const Icon = direction === "asc" ? ArrowUp : direction === "desc" ? ArrowDown : ArrowUpDown;
    const rightAligned = String(className ?? "").includes("text-right");
    const width = sortable ? controls.widths[column] : undefined;
    return (
      <th
        ref={ref}
        className={cn(
          "h-11 px-3 text-left align-middle text-xs font-semibold text-muted-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
          sortable && "relative",
          className,
        )}
        aria-sort={
          dataControls
            ? direction === "asc"
              ? "ascending"
              : direction === "desc"
                ? "descending"
                : "none"
            : undefined
        }
        {...props}
        style={{ ...props.style, ...(width ? { width } : {}) }}
      >
        {sortable ? (
          <div className="relative min-w-24">
            <div className={cn("flex items-center", rightAligned && "justify-end")}>
              {dataControls ? (
                <>
                  <button
                    type="button"
                    className={cn(
                      "group inline-flex min-h-8 min-w-0 flex-1 items-center gap-1 rounded-sm px-1 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      rightAligned ? "justify-end" : "justify-start",
                    )}
                    aria-label={`${label}, ${direction ? `sorted ${direction}` : "not sorted"}. Sort ${direction === "asc" ? "descending" : "ascending"}`}
                    onClick={() => controls.toggleSort(column)}
                  >
                    <span className="truncate">{heading}</span>
                    <Icon
                      aria-hidden="true"
                      className={cn(
                        "size-3.5 shrink-0",
                        active
                          ? "text-foreground"
                          : "text-muted-foreground/70 group-hover:text-foreground",
                      )}
                    />
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "grid size-7 shrink-0 place-items-center rounded-md hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      controls.filters[column] && "bg-primary/10 text-primary",
                    )}
                    aria-label={`Filter ${label}`}
                    onClick={() =>
                      controls.setActiveFilter(controls.activeFilter === column ? null : column)
                    }
                  >
                    <Filter aria-hidden="true" className="size-3.5" />
                  </button>
                </>
              ) : (
                <span className={cn("min-h-8 flex-1 px-1 leading-8", rightAligned && "text-right")}>
                  {heading}
                </span>
              )}
            </div>
            {dataControls && controls.activeFilter === column && (
              <div className="flex items-center gap-1 pb-1">
                <input
                  autoFocus
                  value={controls.filters[column] ?? ""}
                  onChange={(event) => controls.setFilter(column, event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") controls.setActiveFilter(null);
                  }}
                  placeholder={`Filter ${label}`}
                  aria-label={`Filter ${label} values`}
                  className="h-7 min-w-20 flex-1 rounded border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
                />
                {controls.filters[column] && (
                  <button
                    type="button"
                    className="grid size-7 place-items-center rounded hover:bg-muted"
                    aria-label={`Clear ${label} filter`}
                    onClick={() => controls.setFilter(column, "")}
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            )}
            <button
              type="button"
              aria-label={`Resize ${label} column`}
              title="Drag to resize. Use Left and Right arrow keys for precise resizing."
              className="absolute -right-2 top-0 h-full w-2 cursor-col-resize touch-none select-none hover:bg-primary/50"
              onPointerDown={(event) => controls.startResize(column, event)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                const fallbackWidth =
                  event.currentTarget.closest("th")?.getBoundingClientRect().width ?? 72;
                controls.resizeBy(column, event.key === "ArrowLeft" ? -16 : 16, fallbackWidth);
              }}
            />
          </div>
        ) : (
          heading
        )}
      </th>
    );
  },
);
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      "px-3 py-3 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className,
    )}
    {...props}
  />
));
TableCell.displayName = "TableCell";

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn("mt-4 text-sm text-muted-foreground", className)} {...props} />
));
TableCaption.displayName = "TableCaption";

function plainText(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(plainText).filter(Boolean).join(" ").trim();
  if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return "";
  return React.Children.toArray(node.props.children).map(plainText).join(" ").trim();
}

/** Assign each header cell to its real body column, including multi-row headers. */
function assignHeaderColumns(node: React.ReactNode): React.ReactNode {
  const occupied: number[] = [];
  const visit = (child: React.ReactNode): React.ReactNode => {
    if (!React.isValidElement<{ children?: React.ReactNode }>(child)) return child;
    if (isTableComponent(child, TableRow, "TableRow")) {
      let cursor = 0;
      const decorateCell = (cell: React.ReactNode): React.ReactNode => {
        if (!React.isValidElement<{ children?: React.ReactNode }>(cell)) return cell;
        if (!isTableComponent(cell, TableHead, "TableHead")) {
          return React.cloneElement(
            cell,
            undefined,
            React.Children.map(cell.props.children, decorateCell),
          );
        }
        while ((occupied[cursor] ?? 0) > 0) cursor += 1;
        const props = cell.props as TableHeadProps;
        const column = cursor;
        const colSpan = Math.max(1, Number(props.colSpan ?? 1));
        const rowSpan = Math.max(1, Number(props.rowSpan ?? 1));
        for (let offset = 0; offset < colSpan; offset += 1) {
          occupied[column + offset] = Math.max(occupied[column + offset] ?? 0, rowSpan);
        }
        cursor += colSpan;
        return React.cloneElement(cell as React.ReactElement<TableHeadProps>, {
          "data-table-column": column,
        });
      };
      const row = React.cloneElement(
        child,
        undefined,
        React.Children.map(child.props.children, decorateCell),
      );
      for (let index = 0; index < occupied.length; index += 1) {
        if (occupied[index] > 0) occupied[index] -= 1;
      }
      return row;
    }
    return React.cloneElement(child, undefined, React.Children.map(child.props.children, visit));
  };
  return React.Children.map(node, visit);
}

function isTableComponent(node: React.ReactNode, component: unknown, displayName: string): boolean {
  if (!React.isValidElement(node)) return false;
  if (node.type === component) return true;
  if (typeof node.type === "string") {
    const intrinsic = { TableHeader: "thead", TableBody: "tbody", TableFooter: "tfoot", TableRow: "tr", TableHead: "th", TableCell: "td" } as Record<string, string>;
    return node.type === intrinsic[displayName];
  }
  const named = node.type as { displayName?: string; name?: string };
  return named.displayName === displayName || named.name === displayName;
}

function hasInteractiveContent(node: React.ReactNode): boolean {
  if (Array.isArray(node)) return node.some(hasInteractiveContent);
  if (
    !React.isValidElement<{
      children?: React.ReactNode;
      onClick?: unknown;
      href?: unknown;
      role?: unknown;
      asChild?: unknown;
    }>(node)
  )
    return false;
  if (
    typeof node.type === "string" &&
    ["button", "a", "input", "select", "textarea"].includes(node.type)
  )
    return true;
  if (
    node.props.onClick !== undefined ||
    node.props.href !== undefined ||
    node.props.role !== undefined ||
    node.props.asChild !== undefined
  )
    return true;
  return React.Children.toArray(node.props.children).some(hasInteractiveContent);
}

function sortableHeaderLabel(label: string): boolean {
  return Boolean(label) && !/^(action|actions|menu|select)$/i.test(label.trim());
}

function firstTableRow(
  node: React.ReactNode,
): React.ReactElement<{ children?: React.ReactNode }> | null {
  if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return null;
  if (isTableComponent(node, TableRow, "TableRow")) return node;
  for (const child of React.Children.toArray(node.props.children)) {
    const row = firstTableRow(child);
    if (row) return row;
  }
  return null;
}

function tableCellText(rowGroup: React.ReactNode, targetColumn: number): string | null {
  const row = firstTableRow(rowGroup);
  if (!row) return null;
  let column = 0;
  for (const cell of React.Children.toArray(row.props.children)) {
    type SortableCellProps = React.TdHTMLAttributes<HTMLTableCellElement> & {
      "data-sort-value"?: string | number;
    };
    if (
      !React.isValidElement<SortableCellProps>(cell) ||
      !isTableComponent(cell, TableCell, "TableCell")
    )
      continue;
    const span = Number(cell.props.colSpan ?? 1);
    if (targetColumn >= column && targetColumn < column + span) {
      if (span !== 1) return null;
      return String(cell.props["data-sort-value"] ?? plainText(cell.props.children)).trim();
    }
    column += span;
  }
  return null;
}

function numericTableValue(value: string): number | null {
  const compact = value.trim().replace(/\s+/g, " ");
  if (!compact) return null;
  const negative = /^\(.*\)$/.test(compact);
  const stripped = compact
    .replace(/[,$£€¥%]/g, "")
    .replace(/^\((.*)\)$/, "$1")
    .trim();
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(stripped)) return null;
  const parsed = Number(stripped);
  return Number.isFinite(parsed) ? (negative ? -parsed : parsed) : null;
}

const tableTextCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

// eslint-disable-next-line react-refresh/only-export-components -- Pure transforms shared with table regression tests.
export function sortTableBodies(node: React.ReactNode, sort: TableSortState): React.ReactNode {
  if (!sort || !React.isValidElement<{ children?: React.ReactNode }>(node)) return node;
  if (isTableComponent(node, TableBody, "TableBody")) {
    const groups = React.Children.toArray(node.props.children).map((child, index) => ({
      child,
      index,
      value: tableCellText(child, sort.column),
    }));
    const sortableGroups = groups.map(group => ({
      ...group,
      missing: group.value === null || !group.value.trim() || group.value.trim() === "—",
      numeric: group.value === null ? null : numericTableValue(group.value),
    }));
    const sortable = groups.filter((group) => group.value !== null).length > 1;
    if (!sortable) return node;
    const direction = sort.direction === "asc" ? 1 : -1;
    sortableGroups.sort((left, right) => {
      if (left.value === null && right.value === null) return left.index - right.index;
      if (left.value === null) return 1;
      if (right.value === null) return -1;
      if (left.missing && right.missing) return left.index - right.index;
      if (left.missing) return 1;
      if (right.missing) return -1;
      const compared = left.numeric !== null && right.numeric !== null
        ? left.numeric - right.numeric
        : tableTextCollator.compare(left.value, right.value);
      return compared * direction || left.index - right.index;
    });
    return React.cloneElement(
      node,
      undefined,
      sortableGroups.map((group) => group.child),
    );
  }
  return React.cloneElement(
    node,
    undefined,
    React.Children.map(node.props.children, (child) => sortTableBodies(child, sort)),
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- Pure transforms shared with table regression tests.
export function filterTableBodies(node: React.ReactNode, filters: TableFilters): React.ReactNode {
  if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return node;
  if (isTableComponent(node, TableBody, "TableBody")) {
    const active = Object.entries(filters)
      .map(([column, value]) => [Number(column), value.trim().toLocaleLowerCase()] as const)
      .filter(([, value]) => value);
    if (!active.length) return node;
    const rows = React.Children.toArray(node.props.children).filter((child) =>
      active.every(([column, query]) => {
        const value = tableCellText(child, column);
        return (
          value !== null && value.toLocaleLowerCase().includes(query)
        );
      }),
    );
    return React.cloneElement(node, undefined, rows);
  }
  return React.cloneElement(
    node,
    undefined,
    React.Children.map(node.props.children, (child) => filterTableBodies(child, filters)),
  );
}

function findHeaderLabels(node: React.ReactNode): string[] {
  if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return [];
  if (isTableComponent(node, TableHeader, "TableHeader")) {
    const labels: string[] = [];
    const visit = (child: React.ReactNode) => {
      if (!React.isValidElement<{ children?: React.ReactNode }>(child)) return;
      if (isTableComponent(child, TableHead, "TableHead"))
        labels.push(plainText(child.props.children));
      else React.Children.forEach(child.props.children, visit);
    };
    React.Children.forEach(node.props.children, visit);
    return labels;
  }
  for (const child of React.Children.toArray(node.props.children)) {
    const labels = findHeaderLabels(child);
    if (labels.length) return labels;
  }
  return [];
}

function labelBodyRows(node: React.ReactNode, labels: string[]): React.ReactNode {
  if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return node;
  if (isTableComponent(node, TableRow, "TableRow")) {
    let column = 0;
    const children = React.Children.map(node.props.children, (cell) => {
      type ResponsiveCellProps = React.TdHTMLAttributes<HTMLTableCellElement> & {
        "data-label"?: string;
      };
      if (!React.isValidElement<ResponsiveCellProps>(cell)) return cell;
      if (!isTableComponent(cell, TableCell, "TableCell")) return cell;
      const label = cell.props["data-label"] ?? labels[column] ?? "";
      column += Number(cell.props.colSpan ?? 1);
      return React.cloneElement(cell, { "data-label": label });
    });
    return React.cloneElement(node, undefined, children);
  }
  const children = React.Children.map(node.props.children, (child) => labelBodyRows(child, labels));
  return React.cloneElement(node, undefined, children);
}

function labelTableBodies(node: React.ReactNode, labels: string[]): React.ReactNode {
  if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return node;
  if (isTableComponent(node, TableBody, "TableBody"))
    return React.cloneElement(
      node,
      undefined,
      React.Children.map(node.props.children, (row) => labelBodyRows(row, labels)),
    );
  return React.cloneElement(
    node,
    undefined,
    React.Children.map(node.props.children, (child) => labelTableBodies(child, labels)),
  );
}

/** Single-cell spanning rows are empty/loading messages, not records. */
// eslint-disable-next-line react-refresh/only-export-components -- Pure transforms shared with table regression tests.
export function getManagedRows(nodes: React.ReactNode): React.ReactNode[] {
  const rows: React.ReactNode[] = [];
  React.Children.forEach(nodes, node => {
    if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return;
    if (isTableComponent(node, TableBody, "TableBody")) {
      React.Children.forEach(node.props.children, row => {
        const first = firstTableRow(row);
        if (!first) return;
        const cells = React.Children.toArray(first.props.children);
        if (cells.length === 1 && React.isValidElement<{ colSpan?: number }>(cells[0]) && (cells[0].props.colSpan ?? 1) > 1) return;
        rows.push(row);
      });
    } else rows.push(...getManagedRows(node.props.children));
  });
  return rows;
}

// eslint-disable-next-line react-refresh/only-export-components -- Pure transforms shared with table regression tests.
export function sumManagedRows(rows: React.ReactNode[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const row of rows) {
    const first = firstTableRow(row) as React.ReactElement<TableRowProps> | null;
    for (const [key, value] of Object.entries(first?.props.summaryValues ?? {})) {
      if (Number.isFinite(value)) totals[key] = (totals[key] ?? 0) + value;
    }
  }
  return totals;
}

function replaceManagedRows(nodes: React.ReactNode, rows: React.ReactNode[]): React.ReactNode {
  return React.Children.map(nodes, node => {
    if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return node;
    if (isTableComponent(node, TableBody, "TableBody")) {
      return getManagedRows(node).length ? React.cloneElement(node, undefined, rows) : node;
    }
    return React.cloneElement(node, undefined, replaceManagedRows(node.props.children, rows));
  });
}

// eslint-disable-next-line react-refresh/only-export-components -- Pure transforms shared with table regression tests.
export function hideTableColumns(nodes: React.ReactNode, hidden: number[]): React.ReactNode {
  if (!hidden.length) return nodes;
  return React.Children.map(nodes, node => {
    if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return node;
    if (isTableComponent(node, TableRow, "TableRow")) {
      let column = 0;
      return React.cloneElement(node, undefined, React.Children.map(node.props.children, cell => {
        if (!React.isValidElement<React.TdHTMLAttributes<HTMLTableCellElement>>(cell)) return cell;
        const span = Number(cell.props.colSpan ?? 1);
        const remaining = Array.from({ length: span }, (_, offset) => column + offset).filter(index => !hidden.includes(index)).length;
        column += span;
        return remaining ? React.cloneElement(cell, { colSpan: span > 1 ? remaining : undefined }) : null;
      }));
    }
    return React.cloneElement(node, undefined, hideTableColumns(node.props.children, hidden));
  });
}

/** Initial loading replaces empty-state messages, never an existing record. */
function loadingTableBodies(nodes: React.ReactNode, columns: number): React.ReactNode {
  return React.Children.map(nodes, node => {
    if (!React.isValidElement<{children?:React.ReactNode}>(node)) return node;
    if (isTableComponent(node, TableBody, "TableBody")) return React.cloneElement(node, undefined,
      <TableRow><TableCell colSpan={columns}><div aria-hidden="true" className="space-y-3 py-3">
        {[0,1,2].map(index => <div key={index} className="h-6 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />)}
      </div></TableCell></TableRow>);
    return React.cloneElement(node, undefined, loadingTableBodies(node.props.children, columns));
  });
}

type TableProps = React.HTMLAttributes<HTMLTableElement> & {
  /** Stable key shared by the personal view and administrator column rules. */
  tableId?: string;
  loading?: boolean;
  loadingLabel?: string;
  /** Opt-in controls for operational tables; all rows must be supplied. */
  managed?: boolean;
  columnControls?: boolean;
  /** Inventory opts into layout choices without changing other tables. */
  layoutControls?: boolean;
  controlsTarget?: HTMLElement | null;
  summaryFormats?: Record<string, (value: number) => string>;
  /** Collapse each row into a labelled card below tablet width. */
  mobileCards?: boolean;
  /** Disable page-local sort/filter controls when the caller supplies a server-paged slice. */
  clientDataControls?: boolean;
  /** Caller filters its complete dataset before pagination, keyed by header label. */
  onColumnFiltersChange?: (filters: Record<string, string>) => void;
};

const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className, children, loading = false, loadingLabel, mobileCards = true, clientDataControls = true, onColumnFiltersChange, managed = false, columnControls = false, layoutControls = false, controlsTarget, summaryFormats = {}, tableId, ...props }, ref) => {
    const [layout, setLayout] = React.useState<"auto" | "table" | "compact">("auto");
    const [expanded, setExpanded] = React.useState(false);
    const expandButtonRef = React.useRef<HTMLButtonElement>(null);
    const { profile, editable, update } = usePersonalAppearance();
    const auth = useAuthOptional();
    const user = auth?.user;
    const isAdmin = auth?.isAdmin ?? false;
    const pos = usePosOptional();
    const internalRef = React.useRef<HTMLTableElement>(null);
    React.useImperativeHandle(ref, () => internalRef.current as HTMLTableElement);
    const [sort, setSort] = React.useState<TableSortState>(null);
    const [filters, setFilters] = React.useState<TableFilters>({});
    const [activeFilter, setActiveFilter] = React.useState<number | null>(null);
    const [widths, setWidths] = React.useState<ColumnWidths>({});
    const resizeCleanupRef = React.useRef<(() => void) | null>(null);
    const toggleSort = React.useCallback((column: number) => {
      setSort((current) => ({
        column,
        direction: current?.column === column && current.direction === "asc" ? "desc" : "asc",
      }));
    }, []);
    const setFilter = React.useCallback((column: number, value: string) => {
      setFilters((current) => {
        if (value) return { ...current, [column]: value };
        const next = { ...current };
        delete next[column];
        return next;
      });
    }, []);
    const resizeBy = React.useCallback((column: number, delta: number, fallbackWidth: number) => {
      setWidths((current) => ({
        ...current,
        [column]: Math.max(72, Math.round((current[column] ?? fallbackWidth) + delta)),
      }));
    }, []);
    const startResize = React.useCallback(
      (column: number, event: React.PointerEvent<HTMLElement>) => {
        event.preventDefault();
        event.stopPropagation();
        resizeCleanupRef.current?.();
        const header = event.currentTarget.closest("th");
        if (!header) return;
        const startX = event.clientX;
        const startWidth = header.getBoundingClientRect().width;
        const move = (moveEvent: PointerEvent) => {
          setWidths((current) => ({
            ...current,
            [column]: Math.max(72, Math.round(startWidth + moveEvent.clientX - startX)),
          }));
        };
        const stop = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", stop);
          window.removeEventListener("pointercancel", stop);
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
          resizeCleanupRef.current = null;
        };
        resizeCleanupRef.current = stop;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", stop);
        window.addEventListener("pointercancel", stop);
      },
      [],
    );
    React.useEffect(() => () => resizeCleanupRef.current?.(), []);
    let labels: string[] = [];
    for (const child of React.Children.toArray(children)) {
      labels = findHeaderLabels(child);
      if (labels.length) break;
    }
    const labelSignature = labels.join("\u001f");
    const columnPositions = tableId ? catalogColumnPositions(tableId, labels) : labels.map((_, index) => index);
    const personalHidden = tableId ? (profile.tableViews[tableId] ?? []) : [];
    const role = isAdmin ? "admin" : (user?.metaRole ?? user?.role ?? null);
    const rules = (pos?.state.settings.visibility?.hidden ?? {}) as Record<string, string[]>;
    const fixedColumn = (column: number) => column === 0 || /^(actions?|open)$/i.test(labels[column] ?? "");
    const hiddenColumns = labels.flatMap((_, column) => !fixedColumn(column) && (
      personalHidden.includes(columnPositions[column]!) || (tableId && tableColumnHidden(rules, tableId, columnPositions[column]!, role, user?.staffId ?? null, user?.permissions))
    ) ? [column] : []);
    const saveHiddenColumns = (next: number[]) => {
      if (!tableId || !editable) return;
      update({ tableViews: { ...profile.tableViews, [tableId]: next } });
    };
    const previousLabelSignature = React.useRef(labelSignature);
    React.useEffect(() => {
      if (previousLabelSignature.current === labelSignature) return;
      previousLabelSignature.current = labelSignature;
      setSort(null);
      setFilters({});
      setActiveFilter(null);
      setWidths({});
      resizeCleanupRef.current?.();
    }, [labelSignature]);
    const filterSignature = JSON.stringify(Object.fromEntries(Object.entries(filters).map(([column, value]) => [labels[Number(column)] ?? "", value])));
    React.useEffect(() => {
      onColumnFiltersChange?.(JSON.parse(filterSignature));
    }, [filterSignature, onColumnFiltersChange]);
    const sorted = clientDataControls
      ? React.Children.map(children, (child) => sortTableBodies(child, sort))
      : children;
    const content = clientDataControls && !onColumnFiltersChange
      ? React.Children.map(sorted, (child) => filterTableBodies(child, filters))
      : sorted;
    const managedRows = managed ? getManagedRows(content) : [];
    const pagination = usePagination(managedRows);
    const totals = sumManagedRows(managedRows);
    const pagedContent = managed ? replaceManagedRows(content, pagination.pageItems) : content;
    const hasRows = !loading || (managed ? managedRows.length > 0 : getManagedRows(content).length > 0);
    const displayContent = loading && !hasRows ? loadingTableBodies(pagedContent, Math.max(1, labels.length)) : pagedContent;
    // Sorting/filtering use cell values. Label only the visible page so large
    // catalogues do not clone every row before the paginator discards them.
    const labelledContent = React.Children.map(displayContent, (child) => labelTableBodies(child, labels));
    const displayedContent = tableId || managed || columnControls ? hideTableColumns(labelledContent, hiddenColumns) : labelledContent;
    const controls = React.useMemo<TableControls>(
      () => ({
        clientDataControls,
        sort,
        toggleSort,
        filters,
        activeFilter,
        setActiveFilter,
        setFilter,
        widths,
        startResize,
        resizeBy,
      }),
      [
        clientDataControls,
        sort,
        toggleSort,
        filters,
        activeFilter,
        setFilter,
        widths,
        startResize,
        resizeBy,
      ],
    );
    const columnMenu = (<DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="outline" size="sm"><Columns3 className="size-4" /> {layoutControls ? "View" : "Columns"}</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 max-w-[calc(100vw-2rem)] overflow-y-auto">
              {layoutControls && <>
                <DropdownMenuLabel>Layout</DropdownMenuLabel>
                {([ ["auto", "Responsive cards"], ["table", "Table"], ["compact", "Compact table"] ] as const).map(([value, label]) => <DropdownMenuCheckboxItem key={value} checked={layout === value} onSelect={event => event.preventDefault()} onCheckedChange={() => setLayout(value)}>{label}</DropdownMenuCheckboxItem>)}
                <DropdownMenuSeparator />
              </>}
              <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
              {labels.map((label, column) => label && <DropdownMenuCheckboxItem key={column} checked={!hiddenColumns.includes(column)} disabled={fixedColumn(column) || !editable || (!!tableId && tableColumnHidden(rules, tableId, columnPositions[column]!, role, user?.staffId ?? null, user?.permissions))} onSelect={event => event.preventDefault()} onCheckedChange={checked => {
                const position = columnPositions[column]!;
                saveHiddenColumns(checked ? personalHidden.filter(value => value !== position) : [...personalHidden, position]);
                if (!checked) { setFilter(column, ""); if (activeFilter === column) setActiveFilter(null); }
              }}>{label}</DropdownMenuCheckboxItem>)}
              <DropdownMenuSeparator /><DropdownMenuItem disabled={!editable} onSelect={() => { saveHiddenColumns([]); if (layoutControls) { setLayout("auto"); setWidths({}); } }}>{layoutControls ? "Reset view" : "Show all columns"}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>);
    const tableContent = (
      <TableControlsContext.Provider value={controls}>
        {loading && !hasRows && <div role="status" className="flex items-center gap-2 border-b border-border/60 bg-muted/20 px-4 py-2 text-xs text-muted-foreground">
          <Loader2 aria-hidden="true" className="size-3.5 animate-spin text-primary motion-reduce:animate-none" />
          {loadingLabel || (hasRows ? "Refreshing rows…" : "Loading rows…")}
        </div>}
        {managed && <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/25 px-4 py-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-live="polite">
            <span className="text-muted-foreground">Matching totals · {managedRows.length} rows</span>
            {Object.entries(totals).map(([label, value]) => <span key={label}>{label}: <strong className="numeric">{summaryFormats[label]?.(value) ?? value.toLocaleString()}</strong></span>)}
          </div>
          {columnMenu}
        </div>}
        {!managed && (columnControls || tableId) && labels.length > 1 && (controlsTarget && !expanded ? createPortal(columnMenu, controlsTarget) : <div className="flex justify-end px-3 py-2">{columnMenu}</div>)}
        <div className="responsive-table-region relative min-w-0 w-full max-w-full overflow-x-auto overscroll-x-contain" tabIndex={expanded ? 0 : undefined} role={expanded ? "region" : undefined} aria-label={expanded ? "Scrollable table" : undefined}>
          <table
            ref={internalRef}
            data-mobile-cards={!expanded && mobileCards && (!layoutControls || layout === "auto") ? "true" : "false"}
            className={cn("responsive-table w-full caption-bottom text-sm", layoutControls && layout === "compact" && "[&_td]:py-1.5 [&_th]:h-9", className)}
            {...props}
            style={expanded ? { ...props.style, minWidth: Math.max(560, (labels.length - hiddenColumns.length) * 140) } : props.style}
            aria-busy={loading || props["aria-busy"]}
          >
            {displayedContent}
          </table>
        </div>
        {managed && <TablePagination {...pagination} onPage={pagination.setPage} onPageSize={pagination.setPageSize} label="rows" />}
      </TableControlsContext.Provider>
    );
    return (
      <Dialog open={expanded} onOpenChange={setExpanded}>
        {labels.length > 1 && <div className="flex justify-end px-3 py-1.5 sm:hidden">
          <Button ref={expandButtonRef} type="button" variant="ghost" size="sm" onClick={() => setExpanded(true)} aria-label={`Expand ${props["aria-label"] || "table"}`}>
            <Maximize2 className="size-4" aria-hidden="true" /> Expand table
          </Button>
        </div>}
        {expanded ? (
          <DialogContent className="flex h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-none flex-col overflow-hidden p-3 sm:max-w-none sm:p-5" onCloseAutoFocus={event => { event.preventDefault(); expandButtonRef.current?.focus(); }}>
            <DialogHeader className="shrink-0 pr-8">
              <DialogTitle>{props["aria-label"] || "Expanded table"}</DialogTitle>
              <DialogDescription>Scroll sideways to see more columns. Your filters, page and permitted columns stay the same.</DialogDescription>
            </DialogHeader>
            <div className="min-h-0 min-w-0 flex-1 overflow-auto">{tableContent}</div>
          </DialogContent>
        ) : tableContent}
      </Dialog>
    );
  },
);
Table.displayName = "Table";

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
