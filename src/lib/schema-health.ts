/**
 * Setup / health check — what each database is missing, and the versioned
 * repair file that closes exactly that gap.
 *
 * Two environments are checked completely separately and never mixed into one
 * file: the central (cloud) database and the Microsoft SQL Server on this PC.
 * Every generated file carries a version, records itself in a
 * `schema_migrations` table inside the database it targets, and is remembered
 * here so a later scan only ever surfaces genuinely new gaps.
 */
import { readBusinessValue, writeBusinessValue } from "./business-storage";

export type SchemaEnvironment = "cloud" | "local";

export type SchemaGap = {
  environment: SchemaEnvironment;
  table: string;
  /** Empty when the whole table is missing, or for a non-column finding. */
  columns: string[];
  missingTable: boolean;
  /** What kind of gap this is. Absent means a plain missing column. */
  category?: string;
  /** Human sentence for the panel. */
  detail?: string;
  /** Ready-to-run guarded statements for non-column findings. */
  statements?: string[];
  /** Real column types, keyed by column name, so the repair file is typed. */
  types?: Record<string, string>;
};


export type MigrationFile = {
  id: string;
  environment: SchemaEnvironment;
  /** Sequential number within its environment, e.g. 007. */
  version: number;
  filename: string;
  sql: string;
  generatedAt: string;
  /** Signature of the gaps this file closes, used for auto-detection. */
  covers: string[];
  appliedAt: string | null;
};

const KEY = "pos.schema.migrations";

/** Stable signature for one gap, comparable across scans. */
export const gapKey = (gap: SchemaGap): string =>
  `${gap.environment}:${gap.table}:${gap.category ?? "column"}:${
    gap.missingTable ? "*" : (gap.detail ?? [...gap.columns].sort().join(","))
  }`;


export function loadMigrations(): MigrationFile[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = readBusinessValue(KEY);
    const parsed = raw ? (JSON.parse(raw) as MigrationFile[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveMigrations(rows: MigrationFile[]) {
  if (typeof window === "undefined") return;
  try {
    writeBusinessValue(KEY, JSON.stringify(rows.slice(-100)));
  } catch {
    /* storage full — the file is already downloaded, tracking is best effort */
  }
}

export function nextVersion(rows: MigrationFile[], environment: SchemaEnvironment): number {
  return rows.filter((r) => r.environment === environment).length + 1;
}

const stamp = (date: Date) =>
  `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(
    date.getUTCDate(),
  ).padStart(2, "0")}`;

export function migrationFilename(
  environment: SchemaEnvironment,
  version: number,
  date = new Date(),
): string {
  const prefix = environment === "cloud" ? "supabase" : "local";
  return `${prefix}_${String(version).padStart(3, "0")}_${stamp(date)}.sql`;
}

const pgIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;
const tsqlIdent = (name: string) => `[${name.replace(/]/g, "]]")}]`;

/**
 * PostgreSQL body for the cloud gaps. Additive only: columns are added when
 * absent, nothing is dropped or rewritten. A missing table is reported rather
 * than created, because a table without grants and row-security policies
 * would be unreachable.
 */
export function buildCloudSql(gaps: SchemaGap[], filename: string, at = new Date()): string {
  if (gaps.some(gap => gap.missingTable)) throw new Error("Missing cloud tables require the reviewed POS migrations in docs/database-upgrade.md.");
  const lines = [
    `-- ${filename}`,
    `-- Central (cloud) database only. Run this in your Supabase SQL editor.`,
    `-- Generated ${at.toISOString()}`,
    `begin;`,
    ``,
    `create table if not exists public.schema_migrations (`,
    `  filename text primary key,`,
    `  applied_at timestamptz not null default now()`,
    `);`,
    `alter table public.schema_migrations enable row level security;`,
    `revoke all on table public.schema_migrations from public, anon, authenticated;`,
    `do $schema_migrations_policy$`,
    `begin`,
    `  if not exists (`,
    `    select 1 from pg_policy`,
    `    where polrelid = 'public.schema_migrations'::regclass`,
    `      and polname = 'server-only deny client access'`,
    `  ) then`,
    `    create policy "server-only deny client access" on public.schema_migrations`,
    `      for all to anon, authenticated using (false) with check (false);`,
    `  end if;`,
    `end`,
    `$schema_migrations_policy$;`,
    `comment on table public.schema_migrations is`,
    `  'Server-only record of applied Schema Manager repairs.';`,
    ``,
  ];
  for (const gap of gaps) {
    if (gap.missingTable) {
      lines.push(
        `-- TABLE MISSING: public.${gap.table} — create it with the authoritative central schema`,
        `--   migration so it also gets its grants and row-security policies.`,
        ``,
      );
      continue;
    }
    if (gap.statements?.length) {
      lines.push(`-- ${gap.table}: ${gap.detail ?? gap.category ?? "repair"}`, ...gap.statements, ``);
      continue;
    }
    for (const column of gap.columns) {
      const type = gap.types?.[column];
      if (!type) throw new Error(`No verified cloud type for ${gap.table}.${column}. Use the current POS migration; a type will not be guessed.`);
      lines.push(
        `alter table public.${pgIdent(gap.table)} add column if not exists ${pgIdent(column)} ${type};`,
      );
    }
    lines.push(``);
  }

  lines.push(
    `insert into public.schema_migrations (filename) values ('${filename}')`,
    `  on conflict (filename) do nothing;`,
    `notify pgrst, 'reload schema';`,
    `commit;`,
    ``,
  );
  return lines.join("\n");
}

/** T-SQL body for the local SQL Server gaps. Guarded, additive, idempotent. */
export function buildLocalSql(gaps: SchemaGap[], filename: string, at = new Date()): string {
  if (gaps.some(gap => gap.missingTable)) throw new Error("Download the latest database update SQL from Database & Cloud Connection to restore missing tables.");
  const lines = [
    `-- ${filename}`,
    `-- Local PC database only. Run this in your local database client.`,
    `-- Generated ${at.toISOString()}`,
    `SET XACT_ABORT ON;`,
    `BEGIN TRY`,
    `IF DB_NAME() IN (N'master',N'model',N'msdb',N'tempdb') THROW 51003, 'Select the configured POS database.', 1;`,
    `IF OBJECT_ID(N'dbo.pos_schema_migrations',N'U') IS NULL THROW 51003, 'Use the complete POS installer for an unmanaged database.', 1;`,
    `BEGIN TRANSACTION;`,
    ``,
    `IF OBJECT_ID('dbo.schema_migrations', 'U') IS NULL`,
    `  CREATE TABLE dbo.schema_migrations (`,
    `    filename NVARCHAR(200) NOT NULL PRIMARY KEY,`,
    `    applied_at DATETIME2 NOT NULL CONSTRAINT DF_schema_migrations_at DEFAULT SYSUTCDATETIME()`,
    `  );`,
    ``,
  ];
  for (const gap of gaps) {
    if (gap.missingTable) {
      lines.push(
        `-- TABLE MISSING: dbo.${gap.table} — repair it from the Schema manager, which`,
        `--   owns the full guarded definition for this table.`,
        ``,
      );
      continue;
    }
    if (gap.statements?.length) {
      lines.push(`-- ${gap.table}: ${gap.detail ?? gap.category ?? "repair"}`, ...gap.statements, ``);
      continue;
    }
    for (const column of gap.columns) {
      const type = gap.types?.[column];
      if (!type) throw new Error(`No verified local type for ${gap.table}.${column}. Download the latest database update SQL instead.`);
      lines.push(
        `IF COL_LENGTH('dbo.${gap.table}', '${column}') IS NULL`,
        `  ALTER TABLE dbo.${tsqlIdent(gap.table)} ADD ${tsqlIdent(column)} ${type} NULL;`,
      );
    }
    lines.push(``);
  }

  lines.push(
    `IF NOT EXISTS (SELECT 1 FROM dbo.schema_migrations WHERE filename = '${filename}')`,
    `  INSERT INTO dbo.schema_migrations (filename) VALUES ('${filename}');`,
    `COMMIT TRANSACTION;`,
    `END TRY`,
    `BEGIN CATCH`,
    `IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;`,
    `THROW;`,
    `END CATCH;`,
    ``,
  );
  return lines.join("\n");
}

/** Build (and remember) the next versioned file for one environment. */
export function generateMigration(
  environment: SchemaEnvironment,
  gaps: SchemaGap[],
  at = new Date(),
): MigrationFile | null {
  const scoped = gaps.filter((gap) => gap.environment === environment);
  if (!scoped.length) return null;

  const rows = loadMigrations();
  const version = nextVersion(rows, environment);
  const filename = migrationFilename(environment, version, at);
  const sql =
    environment === "cloud"
      ? buildCloudSql(scoped, filename, at)
      : buildLocalSql(scoped, filename, at);

  const file: MigrationFile = {
    id: `${environment}-${version}-${at.getTime()}`,
    environment,
    version,
    filename,
    sql,
    generatedAt: at.toISOString(),
    covers: scoped.map(gapKey),
    appliedAt: null,
  };
  saveMigrations([...rows, file]);
  return file;
}

export function markApplied(id: string, at = new Date()): MigrationFile[] {
  const rows = loadMigrations().map((row) =>
    row.id === id ? { ...row, appliedAt: row.appliedAt ?? at.toISOString() } : row,
  );
  saveMigrations(rows);
  return rows;
}

/**
 * Anything a generated file already covers and that is now gone from the scan
 * counts as applied — so the health check stops nagging about work that has
 * genuinely been done.
 */
export function reconcileApplied(gaps: SchemaGap[], at = new Date()): MigrationFile[] {
  const open = new Set(gaps.map(gapKey));
  const rows = loadMigrations().map((row) =>
    row.appliedAt || row.covers.some((key) => open.has(key))
      ? row
      : { ...row, appliedAt: at.toISOString() },
  );
  saveMigrations(rows);
  return rows;
}

/** Gaps not yet covered by any generated file — the genuinely new work. */
export function newGaps(gaps: SchemaGap[], rows = loadMigrations()): SchemaGap[] {
  const covered = new Set(rows.flatMap((row) => row.covers));
  return gaps.filter((gap) => !covered.has(gapKey(gap)));
}

/** Save a generated file to disk through the browser. */
export function downloadMigration(file: MigrationFile) {
  if (typeof window === "undefined") return;
  const blob = new Blob([file.sql], { type: "text/sql;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.filename;
  link.click();
  URL.revokeObjectURL(url);
}
