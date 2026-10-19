import { formatDateTime as posDisplayDateTime } from "@/lib/time-zone";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Copy, Info, ShieldAlert, Layers, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  formatLogicReport,
  logicReport,
  SEVERITY_BLURB,
  SEVERITY_LABEL,
  type LogicSeverity,
} from "@/lib/logic-health";
import { settingsCoverage, settingsDuplicates } from "@/lib/settings-groups";
import {
  AREA_LABEL,
  formatScanResult,
  runIssueScan,
  STEP_LABEL,
  type ScanResult,
  type ScanStep,
} from "@/lib/health-scan";

const ORDER: LogicSeverity[] = ["critical", "warning", "info"];

const TONE: Record<LogicSeverity, string> = {
  critical: "border-destructive/40 bg-destructive/10 text-destructive",
  warning: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  info: "border-border bg-muted/40 text-muted-foreground",
};

const ICON: Record<LogicSeverity, typeof Info> = {
  critical: ShieldAlert,
  warning: AlertTriangle,
  info: Info,
};

export function LogicHealthPanel() {
  const report = useMemo(() => logicReport(), []);
  const duplicates = useMemo(() => settingsDuplicates(), []);
  const coverage = useMemo(() => settingsCoverage(), []);
  const [query, setQuery] = useState("");
  const [only, setOnly] = useState<LogicSeverity | "all">("all");
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [step, setStep] = useState<ScanStep | null>(null);

  const term = query.trim().toLowerCase();
  const counts = scan ? scan.counts : report.counts;
  const merged = scan
    ? scan.findings
    : report.findings.map((f) => ({
        id: f.id,
        area: "code" as const,
        severity: f.severity,
        title: f.rule,
        detail: f.detail,
        where: `${f.file}:${f.line}`,
        fix: f.hint,
      }));
  const rows = merged.filter(
    (f) =>
      (only === "all" || f.severity === only) &&
      (!term ||
        f.where.toLowerCase().includes(term) ||
        f.title.toLowerCase().includes(term) ||
        f.detail.toLowerCase().includes(term)),
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        scan ? formatScanResult(scan) : formatLogicReport(report),
      );
      toast.success("Report copied");
    } catch {
      toast.error("This device would not let the report be copied.");
    }
  };

  const scanNow = async () => {
    setStep("readwrite");
    try {
      const result = await runIssueScan(setStep);
      setScan(result);
      toast.success(
        `Scan finished — ${result.counts.critical} critical, ${result.counts.warning} warning, ${result.counts.info} info`,
      );
    } catch (e) {
      toast.error((e as Error).message || "The scan could not finish.");
    } finally {
      setStep(null);
    }
  };

  return (
    <div className="w-full max-w-full space-y-5">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/30 p-3">
        <Button size="sm" onClick={() => void scanNow()} disabled={!!step}>
          {step ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          {step ? "Scanning…" : "Scan issues"}
        </Button>
        <span className="text-xs text-muted-foreground">
          {step
            ? STEP_LABEL[step]
            : scan
              ? `Live scan run ${posDisplayDateTime(new Date(scan.at))} — database and code findings combined.`
              : "Checks the live database now and combines it with the stored code findings."}
        </span>
      </div>

      {scan && scan.notes.length > 0 && (
        <ul className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          {scan.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        {ORDER.map((sev) => {
          const Icon = ICON[sev];
          return (
            <button
              key={sev}
              type="button"
              onClick={() => setOnly(only === sev ? "all" : sev)}
              aria-pressed={only === sev}
              className={`rounded-lg border p-4 text-left transition-colors ${TONE[sev]} ${
                only === sev ? "ring-2 ring-primary/40" : ""
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <Icon className="size-4" /> {SEVERITY_LABEL[sev]}
              </span>
              <span className="numeric mt-1 block text-2xl font-semibold">{counts[sev]}</span>
              <span className="mt-1 block text-xs opacity-80">{SEVERITY_BLURB[sev]}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by file, rule or text…"
          aria-label="Filter logic findings"
          className="h-9 max-w-xs"
        />
        {only !== "all" && (
          <Button size="sm" variant="outline" onClick={() => setOnly("all")}>
            Show all severities
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => void copy()}>
          <Copy className="size-3.5" /> Copy report
        </Button>
        <span className="text-xs text-muted-foreground">
          {report.filesScanned} files scanned {posDisplayDateTime(new Date(report.generatedAt))} ·{" "}
          {rows.length} shown
        </span>
      </div>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Layers className="size-4 text-primary" /> Duplicate settings
        </h2>
        {duplicates.length === 0 ? (
          <p className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            Every settings page has exactly one home. Tax, bill numbering and SKU rules sit under
            POS rules; receipt design under Receipts &amp; printing; scheduling under Booking rules.
          </p>
        ) : (
          <ul className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
            {duplicates.map((d) => (
              <li key={d.route}>
                <code>{d.route}</code> appears under {d.groups.join(" and ")}.
              </li>
            ))}
          </ul>
        )}

        {coverage.uncovered.length === 0 && coverage.dangling.length === 0 ? (
          <p className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            Every settings page is listed in the workspace, and every card leads to a page that
            exists.
          </p>
        ) : (
          <ul className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
            {coverage.uncovered.map((route) => (
              <li key={`u-${route}`}>
                <code>{route}</code> exists but is not listed in the settings workspace, so nobody
                can find it by searching.
              </li>
            ))}
            {coverage.dangling.map((route) => (
              <li key={`d-${route}`}>
                The workspace offers <code>{route}</code>, but that page no longer exists.
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted/50">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">Severity</th>
              <th className="px-3 py-2 font-medium">Area</th>
              <th className="px-3 py-2 font-medium">What was found</th>
              <th className="px-3 py-2 font-medium">Where</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">
                  Nothing matches that filter.
                </td>
              </tr>
            )}
            {rows.slice(0, 400).map((f) => (
              <tr key={f.id} className="border-t border-border align-top">
                <td className="px-3 py-2">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[11px] ${TONE[f.severity]}`}
                  >
                    {SEVERITY_LABEL[f.severity]}
                  </span>
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                  {AREA_LABEL[f.area]}
                </td>
                <td className="px-3 py-2">
                  <div className="font-medium">{f.title}</div>
                  <div className="break-all text-muted-foreground">{f.detail}</div>
                  <div className="text-muted-foreground/80">{f.fix}</div>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <code className="text-muted-foreground">{f.where}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 400 && (
        <p className="text-xs text-muted-foreground">
          Showing the first 400 of {rows.length} findings — filter to narrow the list.
        </p>
      )}
    </div>
  );
}
