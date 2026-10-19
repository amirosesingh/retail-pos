import { formatDateTime as posDisplayDateTime } from "@/lib/time-zone";
/**
 * Runtime view of the static logic scan.
 *
 * The findings themselves are produced by `scripts/logic-scan.cjs` (run with
 * `bun run logic:scan`) and committed as JSON, so the dashboard opens instantly
 * and still works with no connection.
 */
import raw from "./logic-health.report.json";

export type LogicSeverity = "critical" | "warning" | "info";

export type LogicFinding = {
  id: string;
  file: string;
  line: number;
  rule: string;
  severity: LogicSeverity;
  detail: string;
  hint: string;
};

export type LogicReport = {
  generatedAt: string;
  filesScanned: number;
  counts: Record<LogicSeverity, number>;
  findings: LogicFinding[];
};

export const SEVERITY_LABEL: Record<LogicSeverity, string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Info",
};

export const SEVERITY_BLURB: Record<LogicSeverity, string> = {
  critical: "Touches money, stock or access and can fail silently.",
  warning: "Visible to staff, or an entry that is not checked before use.",
  info: "Tidy-up work — nothing is broken for the user today.",
};

export function logicReport(): LogicReport {
  return raw as LogicReport;
}

export function formatLogicReport(report: LogicReport): string {
  const lines = [
    `Logic health — scanned ${report.filesScanned} files on ${posDisplayDateTime(new Date(report.generatedAt))}`,
    `Critical ${report.counts.critical} · Warning ${report.counts.warning} · Info ${report.counts.info}`,
    "",
  ];
  for (const f of report.findings) {
    lines.push(`[${f.severity.toUpperCase()}] ${f.file}:${f.line} — ${f.rule}: ${f.detail}`);
  }
  return lines.join("\n");
}