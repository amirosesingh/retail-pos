import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import { cn } from "@/lib/utils";

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("[&_tr]:border-b", className)} {...props} />
));
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

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-10 px-2 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
      className,
    )}
    {...props}
  />
));
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

type TableSortDirection = "asc" | "desc";
type TableSortState = { column: number; direction: TableSortDirection } | null;

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
  cursor: { column: number },
): React.ReactNode {
  if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return node;
  if (node.type === TableHead) {
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
        "aria-sort":
          direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none",
      },
      <button
        type="button"
        className={cn(
          "group inline-flex min-h-8 w-full items-center gap-1 rounded-sm px-1 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          rightAligned ? "justify-end" : "justify-start",
        )}
        aria-label={`${label}, ${direction ? `sorted ${direction === "asc" ? "ascending" : "descending"}` : "not sorted"}. Sort ${nextDirection}`}
        onClick={() => toggleSort(column)}
      >
        <span>{head.props.children}</span>
        <Icon
          aria-hidden="true"
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            active ? "text-foreground" : "text-muted-foreground/70 group-hover:text-foreground",
          )}
        />
      </button>,
    );
  }
  return React.cloneElement(
    node,
    undefined,
    React.Children.map(node.props.children, (child) =>
      decorateHeaderCells(child, sort, toggleSort, cursor),
    ),
  );
}

function decorateTableHeaders(
  node: React.ReactNode,
  sort: TableSortState,
  toggleSort: (column: number) => void,
): React.ReactNode {
  if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return node;
  if (node.type === TableHeader) {
    const cursor = { column: 0 };
    return React.cloneElement(
      node,
      undefined,
      React.Children.map(node.props.children, (child) =>
        decorateHeaderCells(child, sort, toggleSort, cursor),
      ),
    );
  }
  return React.cloneElement(
    node,
    undefined,
    React.Children.map(node.props.children, (child) =>
      decorateTableHeaders(child, sort, toggleSort),
    ),
  );
}

function firstTableRow(
  node: React.ReactNode,
): React.ReactElement<{ children?: React.ReactNode }> | null {
  if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return null;
  if (node.type === TableRow) return node;
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
    if (!React.isValidElement<SortableCellProps>(cell) || cell.type !== TableCell) continue;
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
  if (node.type === TableBody) {
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

function findHeaderLabels(node: React.ReactNode): string[] {
  if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return [];
  if (node.type === TableHeader) {
    const labels: string[] = [];
    const visit = (child: React.ReactNode) => {
      if (!React.isValidElement<{ children?: React.ReactNode }>(child)) return;
      if (child.type === TableHead) labels.push(plainText(child.props.children));
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
  if (node.type === TableRow) {
    let column = 0;
    const children = React.Children.map(node.props.children, (cell) => {
      type ResponsiveCellProps = React.TdHTMLAttributes<HTMLTableCellElement> & {
        "data-label"?: string;
      };
      if (!React.isValidElement<ResponsiveCellProps>(cell)) return cell;
      if (cell.type !== TableCell) return cell;
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
  if (node.type === TableBody)
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
    const [sort, setSort] = React.useState<TableSortState>(null);
    const toggleSort = React.useCallback((column: number) => {
      setSort((current) => ({
        column,
        direction: current?.column === column && current.direction === "asc" ? "desc" : "asc",
      }));
    }, []);
    let labels: string[] = [];
    for (const child of React.Children.toArray(children)) {
      labels = findHeaderLabels(child);
      if (labels.length) break;
    }
    const sorted = React.Children.map(children, (child) => sortTableBodies(child, sort));
    const labelled = React.Children.map(sorted, (child) => labelTableBodies(child, labels));
    const content = React.Children.map(labelled, (child) =>
      decorateTableHeaders(child, sort, toggleSort),
    );
    return (
      <div className="responsive-table-region relative w-full max-w-full overflow-x-auto overscroll-x-contain">
        <table
          ref={ref}
          data-mobile-cards={mobileCards ? "true" : "false"}
          className={cn("responsive-table w-full caption-bottom text-sm", className)}
          {...props}
        >
          {content}
        </table>
      </div>
    );
  },
);
Table.displayName = "Table";

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
