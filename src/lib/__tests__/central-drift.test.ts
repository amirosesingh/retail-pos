import { describe, expect, it } from "vitest";
import {
  actualFromRows,
  buildCentralRepairSql,
  computeCentralDrift,
  type ActualCentralSchema,
} from "../central-drift";
import { CENTRAL_SCHEMA, CENTRAL_SCHEMA_VERSION } from "../central-schema";
import { COMPARE_TABLES } from "../data-compare";

/** PostgREST-style format for each authoritative type family. */
const FORMATS: Record<string, { type: string; format: string }> = {
  uuid: { type: "string", format: "uuid" },
  text: { type: "string", format: "text" },
  "text[]": { type: "array", format: "text[]" },
  jsonb: { type: "string", format: "jsonb" },
  integer: { type: "integer", format: "integer" },
  bigint: { type: "integer", format: "bigint" },
  smallint: { type: "integer", format: "smallint" },
  boolean: { type: "boolean", format: "boolean" },
  timestamptz: { type: "string", format: "timestamp with time zone" },
  date: { type: "string", format: "date" },
  time: { type: "string", format: "time without time zone" },
};

function familyOf(pgType: string): string {
  const t = pgType.split(/\s+/)[0];
  return t.startsWith("numeric") || t.startsWith("decimal") ? "numeric" : t;
}

/** A central database that matches the authoritative definition exactly. */
function fullCloud(): ActualCentralSchema {
  const rows = CENTRAL_SCHEMA.flatMap((t) =>
    t.columns.map((c) => {
      const family = familyOf(c.pgType);
      const f =
        FORMATS[c.pgType.split(/\s+/)[0]] ??
        (family === "numeric" ? { type: "number", format: "numeric" } : { type: "string", format: "text" });
      return { table: t.table, column: c.name, ...f };
    }),
  );
  return actualFromRows(rows);
}

/** The verified live drift: exactly five genuinely missing central columns. */
const KNOWN_MISSING: [string, string][] = [
  ["payment_transactions", "client_transaction_id"],
  ["pos_settings", "receipt_css"],
  ["pos_store_settings", "require_pin_terminal_reset"],
  ["pos_store_settings", "row_version"],
  ["pos_store_settings", "updated_by"],
];

function driftedCloud(): ActualCentralSchema {
  const cloud = new Map(
    [...fullCloud()].map(([t, cols]) => [t, new Map(cols)] as [string, Map<string, never>]),
  );
  for (const [table, column] of KNOWN_MISSING) cloud.get(table)!.delete(column);
  return cloud as ActualCentralSchema;
}

const missingPairs = (drift: ReturnType<typeof computeCentralDrift>) =>
  drift.flatMap((d) => d.missingColumns.map((c) => `${d.table}.${c.name}`)).sort();

describe("authoritative central schema definition", () => {
  it("has its own version, independent of app and local database versions", () => {
    expect(Number.isInteger(CENTRAL_SCHEMA_VERSION)).toBe(true);
    expect(CENTRAL_SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
  });

  it("never demands local-only sync bookkeeping columns centrally (Test C)", () => {
    const localOnly = [
      "is_synced",
      "sync_status",
      "last_error_at",
      "synced_at",
      "pending_sync",
      "sync_attempts",
      "sync_error",
    ];
    for (const table of CENTRAL_SCHEMA) {
      for (const column of localOnly) {
        expect(
          table.columns.some((c) => c.name === column),
          `${table.table}.${column} must not be a central requirement`,
        ).toBe(false);
      }
    }
  });

  it("never demands local-only tables centrally (Test D)", () => {
    const localOnlyTables = ["sync_state", "system_settings", "transfers"];
    for (const t of localOnlyTables) {
      expect(CENTRAL_SCHEMA.some((s) => s.table === t)).toBe(false);
    }
  });

  it("requires client_transaction_id on sales and payments only (Test E)", () => {
    for (const table of ["sales", "payment_transactions"]) {
      const spec = CENTRAL_SCHEMA.find((s) => s.table === table)!;
      const col = spec.columns.find((c) => c.name === "client_transaction_id");
      expect(col, `${table}.client_transaction_id`).toBeDefined();
      expect(col!.classification ?? "required").toBe("required");
    }
    const held = CENTRAL_SCHEMA.find((s) => s.table === "held_orders")!;
    expect(held.columns.some((c) => c.name === "client_transaction_id")).toBe(false);
  });

  it("covers every table the reports compare, so no report loses data (Test G)", () => {
    for (const spec of COMPARE_TABLES) {
      expect(
        CENTRAL_SCHEMA.some((s) => s.table === spec.table),
        `${spec.table} is required by reporting but missing from the central definition`,
      ).toBe(true);
    }
  });

  it("keeps user/terminal/branch/shift context on auditable tables (Test H)", () => {
    const audit = CENTRAL_SCHEMA.find((s) => s.table === "audit_logs")!;
    for (const c of ["user_name", "created_at", "details"]) {
      expect(audit.columns.some((x) => x.name === c), `audit_logs.${c}`).toBe(true);
    }
    const activity = CENTRAL_SCHEMA.find((s) => s.table === "item_activity_logs")!;
    for (const c of ["store_id", "terminal_id", "staff_id", "staff_name", "created_at"]) {
      expect(activity.columns.some((x) => x.name === c), `item_activity_logs.${c}`).toBe(true);
    }
    const shifts = CENTRAL_SCHEMA.find((s) => s.table === "shifts")!;
    for (const c of ["store_id", "terminal_id", "opened_by_staff_id", "opened_at"]) {
      expect(shifts.columns.some((x) => x.name === c), `shifts.${c}`).toBe(true);
    }
  });

  it("keeps full stock-movement context so reconciliation stays traceable (Test J)", () => {
    const movements = CENTRAL_SCHEMA.find((s) => s.table === "item_activity_logs")!;
    for (const c of ["product_id", "quantity_delta", "stock_before", "stock_after", "activity_type"]) {
      expect(movements.columns.some((x) => x.name === c), `item_activity_logs.${c}`).toBe(true);
    }
    const adjustments = CENTRAL_SCHEMA.find((s) => s.table === "stock_adjustments")!;
    for (const c of ["product_id", "previous_stock", "updated_stock", "delta", "store_id"]) {
      expect(adjustments.columns.some((x) => x.name === c), `stock_adjustments.${c}`).toBe(true);
    }
  });

  it("ships the payments idempotency index with the sales twin behaviour (Test I)", () => {
    const payments = CENTRAL_SCHEMA.find((s) => s.table === "payment_transactions")!;
    const index = payments.indexes?.find((i) => i.name === "payment_transactions_client_txn_idx");
    expect(index).toBeDefined();
    expect(index!.sql).toContain("client_transaction_id");
    expect(index!.dependsOnColumns).toContain("client_transaction_id");
  });
});

describe("computeCentralDrift", () => {
  it("flags exactly the five genuine gaps in the live central database (Test A)", () => {
    const drift = computeCentralDrift(driftedCloud());
    expect(missingPairs(drift)).toEqual(
      KNOWN_MISSING.map(([t, c]) => `${t}.${c}`).sort(),
    );
  });

  it("reports a fully repaired central database as clean (Test B)", () => {
    const drift = computeCentralDrift(fullCloud());
    expect(drift.every((d) => !d.missingTable && d.missingColumns.length === 0)).toBe(true);
  });

  it("marks an absent central table as a missing table", () => {
    const cloud = new Map(fullCloud());
    cloud.delete("payment_transactions");
    const drift = computeCentralDrift(cloud);
    const row = drift.find((d) => d.table === "payment_transactions")!;
    expect(row.missingTable).toBe(true);
    expect(row.missingColumns.length).toBeGreaterThan(0);
  });

  it("classifies extra central columns as legacy, never as drift (Test F)", () => {
    const cloud = new Map(fullCloud());
    const payments = new Map(cloud.get("payment_transactions"));
    // Historical columns that exist centrally but are not in the definition.
    payments.set("order_id", { type: "string", format: "uuid" });
    payments.set("payment_method", { type: "string", format: "text" });
    payments.set("transaction_reference", { type: "string", format: "text" });
    cloud.set("payment_transactions", payments);
    const drift = computeCentralDrift(cloud);
    const row = drift.find((d) => d.table === "payment_transactions")!;
    expect(row.missingColumns).toEqual([]);
    expect(row.legacyColumns).toEqual(["order_id", "payment_method", "transaction_reference"]);
  });

  it("warns when a present column has the wrong type family", () => {
    const cloud = new Map(fullCloud());
    const sales = new Map(cloud.get("sales"));
    sales.set("total_amount", { type: "string", format: "text" });
    cloud.set("sales", sales);
    const drift = computeCentralDrift(cloud);
    const row = drift.find((d) => d.table === "sales")!;
    expect(row.typeWarnings).toEqual([
      { column: "total_amount", expected: "numeric", found: "text" },
    ]);
  });
});

describe("buildCentralRepairSql", () => {
  it("emits additive statements, the idempotency index and a schema reload", () => {
    const script = buildCentralRepairSql(
      computeCentralDrift(driftedCloud()),
      new Date("2026-08-23T00:00:00.000Z"),
    );
    expect(script.ok).toBe(true);
    if (!script.ok) return;
    expect(script.sql).toContain(
      'alter table public."payment_transactions" add column if not exists "client_transaction_id" text;',
    );
    expect(script.sql).toContain(
      "alter table public.\"pos_settings\" add column if not exists \"receipt_css\" text not null default '';",
    );
    expect(script.sql).toContain(
      'alter table public."pos_store_settings" add column if not exists "require_pin_terminal_reset" boolean;',
    );
    expect(script.sql).toContain(
      'alter table public."pos_store_settings" add column if not exists "row_version" integer not null default 1;',
    );
    expect(script.sql).toContain(
      'alter table public."pos_store_settings" add column if not exists "updated_by" text;',
    );
    expect(script.sql).toContain(
      'create unique index if not exists "payment_transactions_client_txn_idx" on public.payment_transactions (client_transaction_id) where client_transaction_id is not null;',
    );
    expect(script.sql).toContain("notify pgrst, 'reload schema';");
    expect(script.sql).toContain("2026-08-23T00:00:00.000Z");
  });

  it("never emits destructive statements, even for legacy columns (Test F)", () => {
    const script = buildCentralRepairSql(computeCentralDrift(driftedCloud()));
    expect(script.ok).toBe(true);
    if (!script.ok) return;
    const lower = script.sql.toLowerCase();
    for (const forbidden of ["drop ", "delete ", "truncate", "alter column", "rename"]) {
      expect(lower).not.toContain(forbidden);
    }
  });

  it("omits the payments index when the column is already present", () => {
    const cloud = new Map(fullCloud());
    const settings = new Map(cloud.get("pos_settings"));
    settings.delete("receipt_css");
    cloud.set("pos_settings", settings);
    const script = buildCentralRepairSql(computeCentralDrift(cloud));
    expect(script.ok).toBe(true);
    if (!script.ok) return;
    expect(script.sql).not.toContain("payment_transactions_client_txn_idx");
  });

  it("refuses to generate a script while a table is missing", () => {
    const cloud = new Map(fullCloud());
    cloud.delete("payment_transactions");
    const script = buildCentralRepairSql(computeCentralDrift(cloud));
    expect(script.ok).toBe(false);
    if (script.ok) return;
    expect(script.missingTables).toContain("payment_transactions");
  });

  it("reports nothing to repair when the central database matches", () => {
    const script = buildCentralRepairSql(computeCentralDrift(fullCloud()));
    expect(script.ok).toBe(false);
    if (script.ok) return;
    expect(script.missingTables).toEqual([]);
  });
});
