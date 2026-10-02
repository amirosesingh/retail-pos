import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ListFilter, X } from "lucide-react";

import { cn } from "@/lib/utils";

type TableSortDirection = "asc" | "desc";
type TableSortState = { column: number; direction: TableSortDirection } | null;
type TableFilters = Record<number, string>;
type ColumnWidths = Record<number, number>;

type TableControls = {
  sort: TableSortState;
  toggleSort: (column: number) => void;
  filters: TableFilters;
  activeFilter: number | null;
  setActiveFilter: (column: number | null) => void;
  setFilter: (column: number, value: string) => void;
  widths: ColumnWidths;
  startResize: (column: number, event: React.PointerEvent<HTMLSpanElement>) => void;
};

const TableControlsContext = React.createContext<TableControls | null>(null);
const HeaderColumnContext = React.createContext<{ current: number } | null>(null);

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, children, ...props }, ref) => {
  const cursor = React.useRef(0);
  cursor.current = 0;
  return (
    <HeaderColumnContext.Provider value={cursor}>
      <thead ref={ref} className={cn("[&_tr]:border-b", className)} {...props}>
        {children}
      </thead>
    </HeaderColumnContext.Provider>
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

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        "border-b transition-colors duration-[var(--motion-fast)] hover:bg-muted/50 data-[state=selected]:bg-muted",
        className,
      )}
      {...props}
    />
  ),
);
TableRow.displayName = "TableRow";

type TableHeadProps = React.ThHTMLAttributes<HTMLTableCellElement> & {
  "data-sortable"?: boolean | "true" | "false";
};

const TableHead = React.forwardRef<HTMLTableCellElement, TableHeadProps>(
  ({ className, children, ...props }, ref) => {
    const controls = React.useContext(TableControlsContext);
    const cursor = React.useContext(HeaderColumnContext);
    const column = cursor?.current ?? 0;
    if (cursor) cursor.current += Number(props.colSpan ?? 1);
    const label = plainText(children);
    const sortable =
      controls &&
      props["data-sortable"] !== false &&
      props["data-sortable"] !== "false" &&
      sortableHeaderLabel(label) &&
      !hasInteractiveContent(children) &&
      Number(props.colSpan ?? 1) === 1;
    const active = sortable && controls.sort?.column === column;
    const direction = active ? controls.sort?.direction : null;
    const Icon = direction === "asc" ? ArrowUp : direction === "desc" ? ArrowDown : ArrowUpDown;
    const rightAligned = String(className ?? "").includes("text-right");
    const width = sortable ? controls.widths[column] : undefined;
    return (
      <th
        ref={ref}
        className={cn(
          "h-10 px-2 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
          sortable && "relative",
          className,
        )}
        aria-sort={
          sortable
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
              <button
                type="button"
                className={cn(
                  "group inline-flex min-h-8 min-w-0 flex-1 items-center gap-1 rounded-sm px-1 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  rightAligned ? "justify-end" : "justify-start",
                )}
                aria-label={`${label}, ${direction ? `sorted ${direction}` : "not sorted"}. Sort ${direction === "asc" ? "descending" : "ascending"}`}
                onClick={() => controls.toggleSort(column)}
              >
                <span className="truncate">{children}</span>
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
                  "grid size-7 shrink-0 place-items-center rounded-sm hover:bg-muted hover:text-foreground",
                  controls.filters[column] && "text-primary",
                )}
                aria-label={`Filter ${label}`}
                onClick={() =>
                  controls.setActiveFilter(controls.activeFilter === column ? null : column)
                }
              >
                <ListFilter className="size-3.5" />
              </button>
            </div>
            {controls.activeFilter === column && (
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
            <span
              role="separator"
              aria-orientation="vertical"
              aria-label={`Resize ${label} column`}
              className="absolute -right-2 top-0 h-full w-2 cursor-col-resize touch-none select-none hover:bg-primary/50"
              onPointerDown={(event) => controls.startResize(column, event)}
            />
          </div>
        ) : (
          children
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
      "p-2 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
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
  if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return "";
  return React.Children.toArray(node.props.children).map(plainText).join(" ").trim();
}

function isTableComponent(node: React.ReactNode, component: unknown, displayName: string): boolean {
  if (!React.isValidElement(node)) return false;
  if (node.type === component) return true;
  if (typeof node.type === "string") return false;
  const named = node.type as { displayName?: string; name?: string };
  return named.displayName === displayName || named.name === displayName;
}

function hasInteractiveContent(node: React.ReactNode): boolean {
  if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return false;
  if (
    typeof node.type === "string" &&
    ["button", "a", "input", "select", "textarea"].includes(node.type)
  )
    return true;
  return React.Children.toArray(node.props.children).some(hasInteractiveContent);
}

function sortableHeaderLabel(label: string): boolean {
  return Boolean(label) && !/^(action|actions|menu|select)$/i.test(label.trim());
}

function decorateHeaderCells(
  node: React.ReactNode,
  sort: TableSortState,
  toggleSort: (column: number) => void,
  filters: TableFilters,
  activeFilter: number | null,
  setActiveFilter: (column: number | null) => void,
  setFilter: (column: number, value: string) => void,
  widths: ColumnWidths,
  startResize: (column: number, event: React.PointerEvent<HTMLSpanElement>) => void,
  cursor: { column: number },
): React.ReactNode {
  if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return node;
  if (isTableComponent(node, TableHead, "TableHead")) {
    type SortableHeadProps = React.ThHTMLAttributes<HTMLTableCellElement> & {
      "data-sortable"?: boolean | "true" | "false";
    };
    const head = node as React.ReactElement<SortableHeadProps>;
    const column = cursor.column;
    cursor.column += Number(head.props.colSpan ?? 1);
    const label = plainText(head.props.children);
    const explicitlyDisabled =
      head.props["data-sortable"] === false || head.props["data-sortable"] === "false";
    const canSort =
      !explicitlyDisabled &&
      sortableHeaderLabel(label) &&
      !hasInteractiveContent(head.props.children) &&
      Number(head.props.colSpan ?? 1) === 1;
    if (!canSort) return head;

    const active = sort?.column === column;
    const direction = active ? sort.direction : null;
    const Icon = direction === "asc" ? ArrowUp : direction === "desc" ? ArrowDown : ArrowUpDown;
    const nextDirection = direction === "asc" ? "descending" : "ascending";
    const rightAligned = String(head.props.className ?? "").includes("text-right");
    return React.cloneElement(
      head,
      {
        className: cn("relative", head.props.className),
        style: { ...head.props.style, ...(widths[column] ? { width: widths[column] } : {}) },
        "aria-sort":
          direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none",
      },
      <div className="relative min-w-24">
        <div className={cn("flex items-center", rightAligned && "justify-end")}>
          <button
            type="button"
            className={cn(
              "group inline-flex min-h-8 min-w-0 flex-1 items-center gap-1 rounded-sm px-1 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              rightAligned ? "justify-end" : "justify-start",
            )}
            aria-label={`${label}, ${direction ? `sorted ${direction === "asc" ? "ascending" : "descending"}` : "not sorted"}. Sort ${nextDirection}`}
            onClick={() => toggleSort(column)}
          >
            <span className="truncate">{head.props.children}</span>
            <Icon
              aria-hidden="true"
              className={cn(
                "h-3.5 w-3.5 shrink-0",
                active ? "text-foreground" : "text-muted-foreground/70 group-hover:text-foreground",
              )}
            />
          </button>
          <button
            type="button"
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-sm hover:bg-muted hover:text-foreground",
              filters[column] && "text-primary",
            )}
            aria-label={`Filter ${label}`}
            onClick={() => setActiveFilter(activeFilter === column ? null : column)}
          >
            <ListFilter className="size-3.5" />
          </button>
        </div>
        {activeFilter === column && (
          <div
            className="flex items-center gap-1 pb-1"
            onClick={(event) => event.stopPropagation()}
          >
            <input
              autoFocus
              value={filters[column] ?? ""}
              onChange={(event) => setFilter(column, event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setActiveFilter(null);
              }}
              placeholder={`Filter ${label}`}
              aria-label={`Filter ${label} values`}
              className="h-7 min-w-20 flex-1 rounded border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
            />
            {filters[column] && (
              <button
                type="button"
                className="grid size-7 place-items-center rounded hover:bg-muted"
                aria-label={`Clear ${label} filter`}
                onClick={() => setFilter(column, "")}
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        )}
        <span
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize ${label} column`}
          className="absolute -right-2 top-0 h-full w-2 cursor-col-resize touch-none select-none hover:bg-primary/50"
          onPointerDown={(event) => startResize(column, event)}
        />
      </div>,
    );
  }
  return React.cloneElement(
    node,
    undefined,
    React.Children.map(node.props.children, (child) =>
      decorateHeaderCells(
        child,
        sort,
        toggleSort,
        filters,
        activeFilter,
        setActiveFilter,
        setFilter,
        widths,
        startResize,
        cursor,
      ),
    ),
  );
}

function decorateTableHeaders(
  node: React.ReactNode,
  sort: TableSortState,
  toggleSort: (column: number) => void,
  filters: TableFilters,
  activeFilter: number | null,
  setActiveFilter: (column: number | null) => void,
  setFilter: (column: number, value: string) => void,
  widths: ColumnWidths,
  startResize: (column: number, event: React.PointerEvent<HTMLSpanElement>) => void,
): React.ReactNode {
  if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return node;
  if (isTableComponent(node, TableHeader, "TableHeader")) {
    const cursor = { column: 0 };
    return React.cloneElement(
      node,
      undefined,
      React.Children.map(node.props.children, (child) =>
        decorateHeaderCells(
          child,
          sort,
          toggleSort,
          filters,
          activeFilter,
          setActiveFilter,
          setFilter,
          widths,
          startResize,
          cursor,
        ),
      ),
    );
  }
  return React.cloneElement(
    node,
    undefined,
    React.Children.map(node.props.children, (child) =>
      decorateTableHeaders(
        child,
        sort,
        toggleSort,
        filters,
        activeFilter,
        setActiveFilter,
        setFilter,
        widths,
        startResize,
      ),
    ),
  );
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

function compareTableText(left: string, right: string): number {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  const leftNumber = numericTableValue(left);
  const rightNumber = numericTableValue(right);
  if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function sortTableBodies(node: React.ReactNode, sort: TableSortState): React.ReactNode {
  if (!sort || !React.isValidElement<{ children?: React.ReactNode }>(node)) return node;
  if (isTableComponent(node, TableBody, "TableBody")) {
    const groups = React.Children.toArray(node.props.children).map((child, index) => ({
      child,
      index,
      value: tableCellText(child, sort.column),
    }));
    const sortable = groups.filter((group) => group.value !== null).length > 1;
    if (!sortable) return node;
    const direction = sort.direction === "asc" ? 1 : -1;
    groups.sort((left, right) => {
      if (left.value === null && right.value === null) return left.index - right.index;
      if (left.value === null) return 1;
      if (right.value === null) return -1;
      return compareTableText(left.value, right.value) * direction || left.index - right.index;
    });
    return React.cloneElement(
      node,
      undefined,
      groups.map((group) => group.child),
    );
  }
  return React.cloneElement(
    node,
    undefined,
    React.Children.map(node.props.children, (child) => sortTableBodies(child, sort)),
  );
}

function filterTableBodies(node: React.ReactNode, filters: TableFilters): React.ReactNode {
  if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return node;
  if (isTableComponent(node, TableBody, "TableBody")) {
    const active = Object.entries(filters).filter(([, value]) => value.trim());
    if (!active.length) return node;
    const rows = React.Children.toArray(node.props.children).filter((child) =>
      active.every(([column, query]) => {
        const value = tableCellText(child, Number(column));
        return (
          value !== null && value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
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

type TableProps = React.HTMLAttributes<HTMLTableElement> & {
  /** Collapse each row into a labelled card below tablet width. */
  mobileCards?: boolean;
};

const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className, children, mobileCards = true, ...props }, ref) => {
    const internalRef = React.useRef<HTMLTableElement>(null);
    React.useImperativeHandle(ref, () => internalRef.current as HTMLTableElement, []);
    const [sort, setSort] = React.useState<TableSortState>(null);
    const [filters, setFilters] = React.useState<TableFilters>({});
    const [activeFilter, setActiveFilter] = React.useState<number | null>(null);
    const [widths, setWidths] = React.useState<ColumnWidths>({});
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
    const startResize = React.useCallback(
      (column: number, event: React.PointerEvent<HTMLSpanElement>) => {
        event.preventDefault();
        event.stopPropagation();
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
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
        };
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", stop);
      },
      [],
    );
    let labels: string[] = [];
    for (const child of React.Children.toArray(children)) {
      labels = findHeaderLabels(child);
      if (labels.length) break;
    }
    const labelled = React.Children.map(children, (child) => labelTableBodies(child, labels));
    const sorted = React.Children.map(labelled, (child) => sortTableBodies(child, sort));
    const content = React.Children.map(sorted, (child) => filterTableBodies(child, filters));
    const controls = React.useMemo<TableControls>(
      () => ({
        sort,
        toggleSort,
        filters,
        activeFilter,
        setActiveFilter,
        setFilter,
        widths,
        startResize,
      }),
      [sort, toggleSort, filters, activeFilter, setFilter, widths, startResize],
    );
    return (
      <TableControlsContext.Provider value={controls}>
        <div className="responsive-table-region relative w-full max-w-full overflow-x-auto overscroll-x-contain">
          <table
            ref={internalRef}
            data-mobile-cards={mobileCards ? "true" : "false"}
            className={cn("responsive-table w-full caption-bottom text-sm", className)}
            {...props}
          >
            {content}
          </table>
        </div>
      </TableControlsContext.Provider>
    );
  },
);
Table.displayName = "Table";

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
