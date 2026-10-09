/**
 * Central schema drift — compares the AUTHORITATIVE central schema
 * (src/lib/central-schema.ts) against the actual central PostgreSQL database.
 *
 * The comparison is deliberately one-way:
 *
 *   Authoritative Central Schema  →  Actual Central PostgreSQL
 *
 * The local till schema plays no part here. Till-only bookkeeping columns
 * (is_synced, sync_status, last_error_at, …) and till-only tables
 * (sync_state, system_settings, transfers) are not in
 * the authoritative definition, so they can never raise a false alarm.
 *
 * Columns found centrally but not in the definition are NOT drift: they are
 * reported as legacy/informational so historical business data is visible,
 * and they are never included in the repair script and never dropped.
 */
import {
  CENTRAL_SCHEMA,
  type CentralColumnSpec,
  type CentralTableSchema,
} from "./central-schema";

/** What the introspected central database reports for one column. */
export type ActualColumn = { type?: string | null; format?: string | null };

/** table (lowercase) → column (lowercase) → metadata. */
export type ActualCentralSchema = ReadonlyMap<string, ReadonlyMap<string, ActualColumn>>;

export type TypeWarning = { column: string; expected: string; found: string };

export type CentralDriftRow = {
  table: string;
  label: string;
  missingTable: boolean;
  /** Required columns the central database lacks — genuine drift. */
  missingColumns: CentralColumnSpec[];
  /** Optional columns the central database lacks — reported, never blocking. */
  optionalMissing: CentralColumnSpec[];
  /**
   * Columns present centrally but not in the authoritative definition.
   * Legacy/informational only: historical data stays, nothing is repaired
   * or removed.
   */
  legacyColumns: string[];
  /** Present but with a different type family — informational. */
  typeWarnings: TypeWarning[];
};

/**
 * Build the actual-schema map from relay introspection rows.
 *
 * The rows arrive from a server call, so a failed or reshaped answer can hand
 * this anything at all. A non-list answer means "the central schema could not
 * be read", which is an empty map — not a crash inside a `for … of` that
 * surfaces to staff as "E is not iterable".
 */
export function actualFromRows(
  rows:
    | { table: string; column: string; type?: string | null; format?: string | null }[]
    | null
    | undefined,
): ActualCentralSchema {
  const map = new Map<string, Map<string, ActualColumn>>();
  if (!Array.isArray(rows)) return map;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const table = String(row.table ?? "").toLowerCase();
    const column = String(row.column ?? "").toLowerCase();
    if (!table || !column) continue;
    if (!map.has(table)) map.set(table, new Map());
    map.get(table)!.set(column, {
      type: row.type ?? null,
      format: row.format ?? null,
    });
  }
  return map;
}


/**
 * Coarse type family so a column's type can be sanity-checked across the
 * SQL Server → PostgreSQL → PostgREST boundary without false alarms over
 * representation differences (numeric(19,4) vs numeric, nvarchar vs text).
 */
function typeFamilyOfSpec(pgType: string): string {
  const t = pgType.split(/\s+/)[0]?.toLowerCase() ?? "";
  if (t.endsWith("[]")) return "array";
  if (t.startsWith("numeric") || t.startsWith("decimal")) return "numeric";
  if (t === "double precision" || t === "real") return "numeric";
  return t || "unknown";
}

function typeFamilyOfActual(col: ActualColumn): string | null {
  const format = (col.format ?? "").toLowerCase();
  const type = (col.type ?? "").toLowerCase();
  if (format.includes("uuid")) return "uuid";
  if (format.includes("timestamp")) return "timestamptz";
  if (format.startsWith("date")) return "date";
  if (format.startsWith("time")) return "time";
  if (format === "jsonb" || format === "json") return "jsonb";
  if (format.includes("numeric") || format.includes("decimal") || format === "double precision")
    return "numeric";
  if (format === "integer" || format === "bigint" || format === "smallint") return format;
  if (format === "boolean") return "boolean";
  if (format === "text" || format.includes("character")) return "text";
  if (type === "array") return "array";
  if (type === "integer") return "integer";
  if (type === "number") return "numeric";
  if (type === "boolean") return "boolean";
  if (type === "string") return "text";
  if (type === "object") return "jsonb";
  return null;
}

const isRequired = (c: CentralColumnSpec) => (c.classification ?? "required") === "required";

/** Compare the authoritative definition with the actual central schema. */
export function computeCentralDrift(
  actual: ActualCentralSchema,
  schema: CentralTableSchema[] = CENTRAL_SCHEMA,
): CentralDriftRow[] {
  return schema.map((spec) => {
    const present = actual.get(spec.table);
    if (!present) {
      return {
        table: spec.table,
        label: spec.label,
        missingTable: true,
        missingColumns: spec.columns.filter(isRequired),
        optionalMissing: spec.columns.filter((c) => !isRequired(c)),
        legacyColumns: [],
        typeWarnings: [],
      };
    }
    const known = new Set(spec.columns.map((c) => c.name.toLowerCase()));
    const missingColumns: CentralColumnSpec[] = [];
    const optionalMissing: CentralColumnSpec[] = [];
    const typeWarnings: TypeWarning[] = [];
    for (const col of spec.columns) {
      const actualCol = present.get(col.name.toLowerCase());
      if (!actualCol) {
        (isRequired(col) ? missingColumns : optionalMissing).push(col);
        continue;
      }
      const expected = typeFamilyOfSpec(col.pgType);
      const found = typeFamilyOfActual(actualCol);
      if (found && expected !== "unknown" && expected !== found) {
        typeWarnings.push({ column: col.name, expected, found });
      }
    }
    const legacyColumns = [...present.keys()].filter((c) => !known.has(c)).sort();
    return {
      table: spec.table,
      label: spec.label,
      missingTable: false,
      missingColumns,
      optionalMissing,
      legacyColumns,
      typeWarnings,
    };
  });
}

export type CentralRepairScript =
  | { ok: true; sql: string }
  | { ok: false; missingTables: string[] };

/** Quote an identifier for the central (PostgreSQL) database. */
const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

/**
 * Build the additive PostgreSQL repair script for the current drift. Every
 * statement is idempotent and data-preserving: columns are added if absent,
 * never dropped, never rewritten, and legacy extra columns are untouched.
 *
 * A missing table blocks the script: creating a table without its grants and
 * row-security policies would leave it unreachable, so that case needs the
 * authoritative central schema migration instead.
 */
export function buildCentralRepairSql(
  drift: CentralDriftRow[],
  generatedAt = new Date(),
  schema: CentralTableSchema[] = CENTRAL_SCHEMA,
): CentralRepairScript {
  const missingTables = drift.filter((d) => d.missingTable).map((d) => d.table);
  if (missingTables.length) return { ok: false, missingTables };

  const statements: string[] = [];
  const repairedColumns = new Map<string, Set<string>>();
  for (const d of drift) {
    const cols = [...d.missingColumns, ...d.optionalMissing];
    if (!cols.length) continue;
    repairedColumns.set(d.table, new Set(cols.map((c) => c.name.toLowerCase())));
    for (const c of cols) {
      statements.push(
        `alter table public.${q(d.table)} add column if not exists ${q(c.name)} ${c.pgType};`,
      );
    }
  }
  if (!statements.length) return { ok: false, missingTables: [] };

  // Indexes that depend on a just-repaired column (for example the payments
  // idempotency key) are created so a retried push can resolve an
  // already-stored row instead of failing.
  for (const spec of schema) {
    const repaired = repairedColumns.get(spec.table);
    if (!repaired) continue;
    for (const index of spec.indexes ?? []) {
      if (index.dependsOnColumns.some((c) => repaired.has(c.toLowerCase()))) {
        statements.push(index.sql);
      }
    }
  }
  // Ask PostgREST to reload its schema cache so the new columns work at once.
  statements.push(`notify pgrst, 'reload schema';`);

  const lines = [
    "-- POS central schema repair",
    `-- Generated ${generatedAt.toISOString()} by the Schema manager.`,
    "-- Every statement is idempotent: safe to run repeatedly, never drops or rewrites data.",
    "-- Run once in the central project's PostgreSQL SQL editor, then re-check here.",
    "",
    "begin;",
    ...statements,
    "commit;",
    "",
  ];
  return { ok: true, sql: lines.join("\n") };
}
