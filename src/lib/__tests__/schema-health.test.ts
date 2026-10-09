import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  buildCloudSql,
  buildLocalSql,
  generateMigration,
  loadMigrations,
  markApplied,
  migrationFilename,
  newGaps,
  reconcileApplied,
  type SchemaGap,
} from "../schema-health";

/** These helpers persist through window.localStorage; the node env has none. */
function stubStorage() {
  const store = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  };
}

const gap = (over: Partial<SchemaGap> = {}): SchemaGap => ({
  environment: "cloud",
  table: "sales",
  columns: ["client_transaction_id"],
  missingTable: false,
  types: { client_transaction_id: over.environment === "local" ? "uniqueidentifier" : "uuid", seq: "bigint" },
  ...over,
});

describe("schema health", () => {
  beforeAll(stubStorage);
  beforeEach(() => (window as unknown as { localStorage: Storage }).localStorage.clear());

  it("names files per environment and version", () => {
    // This instant is already the next calendar day in UTC+14. Filenames are
    // canonical UTC dates and must not depend on the machine timezone.
    const at = new Date("2026-08-29T23:30:00Z");
    expect(migrationFilename("cloud", 7, at)).toBe("supabase_007_20260829.sql");
    expect(migrationFilename("local", 1, at)).toBe("local_001_20260829.sql");
  });

  it("never mixes cloud and local statements in one file", () => {
    const cloud = buildCloudSql([gap()], "supabase_001_20260829.sql");
    const local = buildLocalSql(
      [gap({ environment: "local", table: "sales", columns: ["seq"] })],
      "local_001_20260829.sql",
    );
    expect(cloud).toContain("add column if not exists");
    expect(cloud).not.toMatch(/ALTER TABLE dbo\./);
    expect(local).toContain("COL_LENGTH('dbo.sales'");
    expect(local).not.toContain("alter table public.");
  });

  it("records itself in a schema_migrations table in each database", () => {
    const cloud = buildCloudSql([gap()], "supabase_001_20260829.sql");
    expect(cloud).toContain(
      "insert into public.schema_migrations",
    );
    expect(cloud).toContain("alter table public.schema_migrations enable row level security");
    expect(cloud).toContain(
      "revoke all on table public.schema_migrations from public, anon, authenticated",
    );
    expect(cloud).toContain(
      'create policy "server-only deny client access" on public.schema_migrations',
    );
    expect(cloud).toContain("using (false) with check (false)");
    expect(buildLocalSql([gap({ environment: "local" })], "local_001_20260829.sql")).toContain(
      "INSERT INTO dbo.schema_migrations",
    );
  });

  it("only surfaces genuinely new gaps once a file covers them", () => {
    const gaps = [gap()];
    generateMigration("cloud", gaps);
    expect(newGaps(gaps)).toEqual([]);
    expect(newGaps([gap({ table: "members", columns: ["tier"] })])).toHaveLength(1);
  });

  it("auto-detects an applied file when its gaps disappear", () => {
    const file = generateMigration("cloud", [gap()])!;
    expect(loadMigrations()[0]?.appliedAt).toBeNull();
    reconcileApplied([]);
    expect(loadMigrations()[0]?.appliedAt).not.toBeNull();
    expect(markApplied(file.id)[0]?.appliedAt).not.toBeNull();
  });
});
