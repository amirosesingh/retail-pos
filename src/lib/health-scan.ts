import { formatDateTime as posDisplayDateTime } from "@/lib/time-zone";
/**
 * One button, one answer.
 *
 * "Scan issues" runs the live database work in real time — the read/write
 * probe, the relationship & orphan check and the feature/schema probe — and
 * merges what comes back with the committed code findings, so staff see a
 * single list ordered by how much it matters.
 */
import { runDbHealth, formatReport, type DbHealthReport } from "./db-health";
import { runRelationalHealth, type RelationalReport } from "./db-relations";
import {
  runFeatureSchemaAudit,
  formatFeatureSchemaReport,
  type FeatureSchemaReport,
} from "@/core/types/feature-schema";
import { logicReport, type LogicSeverity } from "./logic-health";

export type ScanArea = "code" | "schema" | "relations" | "readwrite";

export const AREA_LABEL: Record<ScanArea, string> = {
  code: "Code",
  schema: "Feature & schema",
  relations: "Table links",
  readwrite: "Read / write",
};

export type ScanFinding = {
  id: string;
  area: ScanArea;
  severity: LogicSeverity;
  title: string;
  detail: string;
  /** File and line, or table and column — wherever the problem lives. */
  where: string;
  fix: string;
};

export type ScanResult = {
  at: string;
  findings: ScanFinding[];
  counts: Record<LogicSeverity, number>;
  /** Anything that stopped a check from running at all. */
  notes: string[];
  db: DbHealthReport | null;
  relations: RelationalReport | null;
  schema: FeatureSchemaReport | null;
};

export type ScanStep = "readwrite" | "relations" | "schema" | "merge" | "done";

export const STEP_LABEL: Record<ScanStep, string> = {
  readwrite: "Checking the database can be read and written…",
  relations: "Checking how the tables are linked…",
  schema: "Checking every feature against the live tables…",
  merge: "Putting the report together…",
  done: "Finished",
};

/** Money, stock and missing structure always come first. */
const MONEY_TABLES = new Set([
  "sales",
  "sale_items",
  "payment_transactions",
  "booking_payments",
  "products",
  "stock_adjustments",
  "stock_transfers",
  "stock_transfer_items",
  "purchase_orders",
  "purchase_order_items",
]);

function schemaFindings(report: FeatureSchemaReport): ScanFinding[] {
  const out: ScanFinding[] = [];
  for (const feature of report.features) {
    for (const op of feature.ops) {
      if (op.ok) continue;
      if (feature.status === "skipped") continue;
      const critical = op.missing.length > 0 || /missing table/i.test(op.detail);
      out.push({
        id: `schema:${feature.id}:${op.table}:${op.label}`,
        area: "schema",
        severity: critical || MONEY_TABLES.has(op.table) ? "critical" : "warning",
        title: `${feature.name} — ${op.label}`,
        detail: op.detail,
        where: op.source,
        fix: op.missing.length
          ? `Add ${op.missing.map((c) => `'${c}'`).join(", ")} to the '${op.table}' table, or change the code to stop sending ${op.missing.length === 1 ? "it" : "them"}.`
          : op.unmet.length
            ? `Include ${op.unmet.join(", ")} in the save, or give ${op.unmet.length === 1 ? "it a default" : "them defaults"} in the database.`
            : "Open this screen's save and match it to the live table.",
      });
    }
  }
  return out;
}

function relationFindings(report: RelationalReport): ScanFinding[] {
  const out: ScanFinding[] = [];
  for (const table of report.tables) {
    for (const link of table.links) {
      if (link.orphans && link.orphans > 0) {
        out.push({
          id: `rel:orphan:${table.table}:${link.column}`,
          area: "relations",
          severity: "critical",
          title: `${table.label}: ${link.orphans} row(s) point at a ${link.parent} record that no longer exists`,
          detail: link.label,
          where: `${table.table}.${link.column} → ${link.parent}`,
          fix: `Delete or re-point the ${link.orphans} stranded row(s) before adding the missing link.`,
        });
      } else if (!link.declared) {
        out.push({
          id: `rel:fk:${table.table}:${link.column}`,
          area: "relations",
          severity: "warning",
          title: `${table.label}: no link recorded to ${link.parent}`,
          detail: link.label,
          where: `${table.table}.${link.column} → ${link.parent}`,
          fix: `Add the foreign key from ${table.table}.${link.column} to ${link.parent} so the database protects this link itself.`,
        });
      }
    }
  }
  return out;
}

function readWriteFindings(report: DbHealthReport): ScanFinding[] {
  const out: ScanFinding[] = [];
  for (const probe of report.tables) {
    if (probe.read === "fail") {
      out.push({
        id: `rw:read:${probe.table}`,
        area: "readwrite",
        severity: MONEY_TABLES.has(probe.table) ? "critical" : "warning",
        title: `${probe.label} cannot be read`,
        detail: probe.readDetail,
        where: probe.table,
        fix: "Check the table exists and that staff accounts are allowed to read it.",
      });
    }
    if (probe.write === "fail") {
      out.push({
        id: `rw:write:${probe.table}`,
        area: "readwrite",
        severity: MONEY_TABLES.has(probe.table) ? "critical" : "warning",
        title: `${probe.label} cannot be written`,
        detail: probe.writeDetail,
        where: probe.table,
        fix: "Check the save rules for this table — staff cannot record changes to it right now.",
      });
    }
  }
  for (const h of report.header) {
    if (!h.ok) {
      out.push({
        id: `rw:header:${h.label}`,
        area: "readwrite",
        severity: "warning",
        title: h.label,
        detail: h.detail,
        where: "This terminal",
        fix: "Sort this out on the terminal before trusting the rest of the report.",
      });
    }
  }
  return out;
}

function codeFindings(): ScanFinding[] {
  return logicReport().findings.map((f) => ({
    id: `code:${f.id}`,
    area: "code" as const,
    severity: f.severity,
    title: f.rule,
    detail: f.detail,
    where: `${f.file}:${f.line}`,
    fix: f.hint,
  }));
}

const ORDER: Record<LogicSeverity, number> = { critical: 0, warning: 1, info: 2 };

/** Run everything. `onStep` reports progress so the button can say where it is. */
export async function runIssueScan(onStep?: (step: ScanStep) => void): Promise<ScanResult> {
  const notes: string[] = [];

  onStep?.("readwrite");
  let db: DbHealthReport | null = null;
  try {
    db = await runDbHealth();
  } catch (e) {
    notes.push(`Read/write check did not run: ${(e as Error).message}`);
  }

  onStep?.("relations");
  const relations = await runRelationalHealth();
  if (relations.error) notes.push(`Table links not checked: ${relations.error}`);

  onStep?.("schema");
  const schema = await runFeatureSchemaAudit();
  if (schema.error) notes.push(`Feature & schema check not run: ${schema.error}`);

  onStep?.("merge");
  const findings = [
    ...(db ? readWriteFindings(db) : []),
    ...(relations.error ? [] : relationFindings(relations)),
    ...(schema.error ? [] : schemaFindings(schema)),
    ...codeFindings(),
  ].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);

  const counts: Record<LogicSeverity, number> = { critical: 0, warning: 0, info: 0 };
  for (const f of findings) counts[f.severity] += 1;

  onStep?.("done");
  return { at: new Date().toISOString(), findings, counts, notes, db, relations, schema };
}

/** Plain text, for pasting into a support message. */
export function formatScanResult(result: ScanResult): string {
  const lines = [
    `Issue scan — ${posDisplayDateTime(new Date(result.at))}`,
    `Critical ${result.counts.critical} · Warning ${result.counts.warning} · Info ${result.counts.info}`,
    "",
  ];
  for (const n of result.notes) lines.push(`Note: ${n}`);
  if (result.notes.length) lines.push("");
  for (const f of result.findings) {
    lines.push(
      `[${f.severity.toUpperCase()}] (${AREA_LABEL[f.area]}) ${f.where} — ${f.title}: ${f.detail}`,
    );
    lines.push(`    Fix: ${f.fix}`);
  }
  if (result.db) lines.push("", formatReport(result.db));
  if (result.schema) lines.push("", formatFeatureSchemaReport(result.schema));
  return lines.join("\n");
}
