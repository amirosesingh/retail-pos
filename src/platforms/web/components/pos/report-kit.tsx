import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/pos-auth";

/** Shared date-range state helpers for every report page. */
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export function defaultRange(days = 30) {
  const to = new Date();
  const from = new Date(Date.now() - days * 86_400_000);
  return { from: isoDay(from), to: isoDay(to) };
}

export const inRange = (iso: string, from: string, to: string) => {
  const day = iso.slice(0, 10);
  return (!from || day >= from) && (!to || day <= to);
};

export const stamp = (iso: string) =>
  new Date(iso).toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

/** Downloads a report as CSV so it can be opened in Excel. */
export function downloadCsv(name: string, rows: (string | number)[][]) {
  const body = rows
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
  const url = URL.createObjectURL(new Blob([body], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}-${isoDay(new Date())}.csv`;
  a.click();
  URL.revokeObjectURL(url);
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
}: {
  title: string;
  subtitle: string;
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  onExport?: () => void;
  children?: ReactNode;
}) {
  // Exporting report data is its own permission — hide the button when off.
  const { can } = useAuth();
  const canExport = can("can_export_reports");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to="/reports" className="text-xs text-muted-foreground hover:text-foreground">
            ← Reports &amp; Analytics
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        {onExport && canExport && (
          <Button variant="outline" onClick={onExport}>
            Export CSV
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-3">
        <div className="w-full space-y-1 sm:w-auto">
          <Label className="text-xs">From</Label>
          <Input type="date" value={from} onChange={(e) => onFrom(e.target.value)} className="h-9 w-full sm:w-40" />
        </div>
        <div className="w-full space-y-1 sm:w-auto">
          <Label className="text-xs">To</Label>
          <Input type="date" value={to} onChange={(e) => onTo(e.target.value)} className="h-9 w-full sm:w-40" />
        </div>
        {children}
      </div>
    </div>
  );
}

export function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="numeric mt-1 text-2xl font-semibold">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
