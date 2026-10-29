import { ChevronLeft } from "lucide-react";
import { formatDateTime as posDisplayDateTime } from "@/lib/time-zone";
import { posDayKey, inPosDayRange } from "@/lib/time-zone";
import { beginDataTask } from "@/lib/data-progress";
import { notifyError } from "@/lib/notify";
import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Link } from "@tanstack/react-router";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/pos-auth";
import { Table, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useSalesReportContext } from "@/lib/sales-report-context";
import { AppShell } from "./AppShell";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SlidersHorizontal } from "lucide-react";
import { ANALYTICS_COLORS, type AnalyticsTone } from "@/lib/analytics-design";
import { FinancialInfoTip } from "./FinancialInfo";

export function ReportFilters({
  children,
  title = "Report filters",
}: {
  children: ReactNode;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <SlidersHorizontal className="size-4" /> Filters
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>Choose the records to include in this report.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-end gap-4 [&>div]:min-w-0 [&>div]:flex-1 [&>div]:basis-56 [&_input]:w-full [&_select]:w-full">
            {children}
          </div>
          <DialogFooter>
            <Button onClick={() => setOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ReportFrame({ children }: { children: ReactNode }) {
  const shared = useSalesReportContext();
  return shared ? <>{children}</> : <AppShell>{children}</AppShell>;
}

/** Report tables share readable density without changing operational tables. */
export function ReportTable({ className, children, ...props }: ComponentProps<typeof Table>) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggle = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const compact = (nodes: ReactNode, body = false, path = ""): ReactNode =>
    Children.map(nodes, (node, index) => {
      if (!isValidElement<{ children?: ReactNode; className?: string; colSpan?: number }>(node))
        return node;
      const key = `${path}/${node.key ?? index}`;
      const inBody = body || node.type === TableBody;
      if (inBody && node.type === TableRow) {
        const cells = Children.toArray(node.props.children);
        if (cells.length < 2) return node;
        const open = expanded.has(key);
        return cloneElement(
          node,
          { className: cn(node.props.className, "report-record", open && "report-expanded") },
          ...cells,
          <TableCell key="report-details" className="report-row-toggle" data-label="">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => toggle(key)}
              className="text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {open ? "Show less" : "Show all details"}
            </button>
          </TableCell>,
        );
      }
      return cloneElement(node, undefined, compact(node.props.children, inBody, key));
    });
  return (
    <Table
      {...props}
      children={props.mobileCards === false ? children : compact(children)}
      className={cn(
        "report-table text-sm [&_td]:py-4 [&_td]:align-top [&_td]:leading-6 [&_th]:py-3 [&_th]:text-xs [&_th]:font-medium [&_thead]:bg-primary/5",
        className,
      )}
    />
  );
}

/** Shared date-range state helpers for every report page. */
export const isoDay = posDayKey;

export function defaultRange(days = 30) {
  const to = posDayKey();
  const from = new Date(`${to}T12:00:00Z`);
  from.setUTCDate(from.getUTCDate() - Math.max(0, Math.trunc(days) - 1));
  return { from: from.toISOString().slice(0, 10), to };
}

export const inRange = inPosDayRange;

export const stamp = (iso: string) =>
  posDisplayDateTime(iso);

/** Downloads a report as CSV so it can be opened in Excel. */
export function downloadCsv(name: string, rows: (string | number)[][]) {
  void exportCsv(name, rows).catch((cause) => notifyError(cause, "Exporting report"));
}
/** Native Excel export with typed amounts, readable columns and header filters. */
// eslint-disable-next-line react-refresh/only-export-components -- Shared report actions accompany the report presentation helpers.
export function downloadReport(name: string, rows: (string | number)[][]) {
  const task = beginDataTask("Exporting Excel report");
  void import("@/lib/report-export")
    .then((module) => module.exportReportWorkbook(name, rows))
    .catch((cause) => notifyError(cause, "Exporting report"))
    .finally(() => task.finish());
}
async function exportCsv(name: string, rows: (string | number)[][]) {
  const task = beginDataTask("Exporting report");
  try {
    const parts: string[] = [];
    for (let start = 0; start < rows.length; start += 1000) {
      const body = rows
        .slice(start, start + 1000)
        .map((r) =>
          r
            .map((c) => {
              const raw = String(c ?? "");
              const v = /^[\t\r\n ]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
              return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
            })
            .join(","),
        )
        .join("\n");
      if (start) parts.push("\n");
      parts.push(body);
      task.report(Math.min(start + 1000, rows.length), rows.length);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    const url = URL.createObjectURL(new Blob(parts, { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}-${isoDay(new Date())}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } finally {
    task.finish();
  }
}

export function ReportHeader({
  title,
  subtitle,
  from,
  to,
  onFrom,
  onTo,
  onExport,
  children,
  workspaceHeader = false,
  toolbar,
}: {
  title: string;
  subtitle: string;
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  onExport?: () => void;
  children?: ReactNode;
  workspaceHeader?: boolean;
  toolbar?: ReactNode;
}) {
  // Exporting report data is its own permission — hide the button when off.
  const { can } = useAuth();
  const canExport = can("can_export_reports");
  const shared = useSalesReportContext();
  const exportAction = shared?.exportAction;
  useEffect(() => {
    if (!exportAction || workspaceHeader) return;
    exportAction.current = onExport;
    return () => {
      exportAction.current = undefined;
    };
  }, [exportAction, onExport, workspaceHeader]);
  if (shared && !workspaceHeader) {
    const text = (node: ReactNode): string => {
      if (typeof node === "string") return node;
      if (Array.isArray(node)) return node.map(text).join(" ");
      return isValidElement<{ children?: ReactNode }>(node) ? text(node.props.children) : "";
    };
    const tools = Children.toArray(children).filter(
      (child) => !/\b(Branch|Store|Cashier|Search|Tender|Method)\b/i.test(text(child)),
    );
    return tools.length ? <div className="flex flex-wrap items-end gap-3">{tools}</div> : null;
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex min-w-0 items-start gap-3">
            <Link to="/reports" aria-label="Back to reports" title="Back to reports"
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <ChevronLeft className="size-4" aria-hidden="true" />
            </Link>
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
              <p className="mt-1 max-w-3xl text-sm text-muted-foreground page-description">{subtitle}</p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {toolbar}
          <ReportFilters title={title + " filters"}>
            <div className="w-full space-y-1 sm:w-auto">
              <Label className="text-xs">From</Label>
              <Input
                type="date"
                value={from}
                onChange={(e) => onFrom(e.target.value)}
                className="h-9 w-full sm:w-40"
              />
            </div>
            <div className="w-full space-y-1 sm:w-auto">
              <Label className="text-xs">To</Label>
              <Input
                type="date"
                value={to}
                onChange={(e) => onTo(e.target.value)}
                className="h-9 w-full sm:w-40"
              />
            </div>
            {children}
          </ReportFilters>
          {onExport && canExport && (
            <Button variant="outline" onClick={onExport}>
              Export Excel
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone,
  info,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: AnalyticsTone;
  info?: ReactNode;
}) {
  return (
    <div
      className="summary-card report-stat min-w-0 rounded-2xl border border-border bg-card p-5"
      style={tone ? { borderTopColor: ANALYTICS_COLORS[tone] } : undefined}
    >
      {info ? <div className="flex min-h-10 items-start justify-between gap-1"><p className="text-sm font-medium text-muted-foreground">{label}</p><FinancialInfoTip label={label}>{info}</FinancialInfoTip></div> : <p className="min-h-10 text-sm font-medium text-muted-foreground">{label}</p>}
      <p
        className="numeric mt-2 min-w-0 text-2xl font-semibold tracking-tight tabular-nums [overflow-wrap:anywhere]"
        style={tone ? { color: ANALYTICS_COLORS[tone] } : undefined}
      >
        {value}
      </p>
      {hint && <p className="mt-2 text-xs leading-5 text-muted-foreground">{hint}</p>}
    </div>
  );
}
