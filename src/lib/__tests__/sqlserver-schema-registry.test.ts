import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const packagedRegistry = require("../../../electron/db/schema-registry.cjs");

describe("SQL Server schema registry", () => {
  const registry = JSON.parse(readFileSync("database/sqlserver/schema-registry.json", "utf8"));
  const applicationVersion = JSON.parse(readFileSync("package.json", "utf8")).version;
  const sql = readFileSync("database/sqlserver/schema.sql", "utf8");
  const completeSql = readFileSync("database/sqlserver/retail-pos-local-database.sql", "utf8");

  it("loads through the same path used by the packaged desktop validator", () => {
    expect(packagedRegistry.loadRegistry().tables).toHaveLength(70);
    expect(packagedRegistry.registryPath().replaceAll("\\", "/")).toMatch(
      /database\/sqlserver\/schema-registry\.json$/,
    );
  });

  it("maps every cloud domain table and column", () => {
    expect(registry.tables).toHaveLength(70);
    expect(
      registry.tables.reduce(
        (sum: number, table: { columns: unknown[] }) => sum + table.columns.length,
        0,
      ),
    ).toBeGreaterThanOrEqual(995);
    const rules = registry.tables.find(
      (table: { cloudTable: string }) => table.cloudTable === "authorization_actions",
    );
    expect(rules.direction).toBe("bidirectional");
    expect(rules.columns.some((column: { cloudColumn: string }) => column.cloudColumn === "row_version")).toBe(true);
    expect(registry.tables.some((table: { cloudTable: string }) => table.cloudTable === "authorization_action_history")).toBe(true);
    expect(
      registry.tables
        .find((table: { cloudTable: string }) => table.cloudTable === "sale_items")
        .columns.some((column: { cloudColumn: string }) => column.cloudColumn === "refunded_qty"),
    ).toBe(true);
    for (const table of registry.tables) {
      expect(table.sqlServerTable).toBe(table.cloudTable);
      expect(table.deleteRule).toBeTruthy();
      expect(table.conflictRule).toBeTruthy();
      expect(table.testName).toBeTruthy();
      for (const column of table.columns.filter(
        (candidate: { primaryKey: boolean }) => candidate.primaryKey,
      )) {
        expect(column.nullable, `${table.sqlServerTable}.${column.sqlServerColumn}`).toBe(false);
        expect(sql).toContain(`[${column.sqlServerColumn}] ${column.sqlServerType} NOT NULL`);
      }
    }
  });

  it("preserves every column currently present in live Supabase", () => {
    const liveCompatibilityColumns: Record<string, string[]> = {
      activity_events: ["branch_id"],
      app_users: ["auth_secret", "idle_timeout_minutes"],
      bookings: ["booking_ref"],
      branch_telemetry: ["device_name", "device_type", "location_name", "last_heartbeat_at"],
      held_orders: ["bill_no"],
      item_activity_logs: ["item_id", "sale_id", "transfer_id", "quantity", "created_by", "notes"],
      members: ["deleted_at"],
      membership_tiers: ["deleted_at"],
      payment_transactions: ["order_id", "payment_method", "transaction_reference"],
      pos_settings: ["payment_details", "whatsapp_settings", "receipt_css"],
      pos_store_settings: ["created_at", "idle_timeout_minutes"],
      product_barcodes: ["unit_label", "deleted_at"],
      product_categories: ["deleted_at"],
      products: ["deleted_at"],
      promotions: ["deleted_at"],
      purchase_orders: ["status", "reference"],
      sale_items: ["branch_id"],
      sales: ["branch_id"],
      stock_transfers: [
        "rejected_by",
        "cancelled_reason",
        "dispatched_by",
        "dispatched_at",
        "closed_at",
        "fulfilment",
        "source_request_id",
      ],
      stores: ["receipt_prefix", "deleted_at"],
      suppliers: ["deleted_at"],
      terminal_tokens: [
        "claim_secret_hash",
        "claim_expires_at",
        "credentials_issued_at",
        "device_platform",
        "device_os",
        "claimed_proof_hash",
        "claimed_platform",
        "claimed_os",
        "is_claimed",
        "expires_at",
        "claim_proof",
      ],
      uom_units: ["deleted_at"],
    };

    for (const [tableName, expectedColumns] of Object.entries(liveCompatibilityColumns)) {
      const table = registry.tables.find(
        (candidate: { cloudTable: string }) => candidate.cloudTable === tableName,
      );
      const actualColumns = new Set(
        table?.columns.map((column: { cloudColumn: string }) => column.cloudColumn),
      );
      for (const columnName of expectedColumns) {
        expect(actualColumns.has(columnName), `${tableName}.${columnName}`).toBe(true);
        expect(sql).toContain(`dbo.[${tableName}]`);
        expect(sql).toContain(`[${columnName}]`);
      }
    }

    const sourceRequest = registry.tables
      .find((table: { cloudTable: string }) => table.cloudTable === "stock_transfers")
      .columns.find(
        (column: { cloudColumn: string }) => column.cloudColumn === "source_request_id",
      );
    expect(sourceRequest).toMatchObject({
      sqlServerType: "uniqueidentifier",
      nullable: true,
      foreignKey: true,
      foreignKeyTarget: { table: "stock_transfers", column: "id" },
    });
  });

  it("uses change tracking and metadata-only synchronization tables", () => {
    expect(sql).toContain("SET CHANGE_TRACKING = ON");
    expect(sql).toContain("dbo.sync_checkpoints");
    expect(sql).toContain("dbo.sync_change_journal");
    expect(sql).not.toMatch(/sync_change_journal[\s\S]{0,1000}\bpayload\b/i);
  });

  it("keeps server-managed session secrets out of the PC database", () => {
    expect(
      registry.tables.some((table: { cloudTable: string }) => table.cloudTable === "user_sessions"),
    ).toBe(false);
    expect(completeSql).not.toContain("dbo.[user_sessions]");
    expect(completeSql).not.toContain("session_token_hash");
  });

  it("keeps Electron settings current through the SQL Server sync registry", () => {
    const expectedDirections: Record<string, "bidirectional" | "pull"> = {
      integration_settings: "bidirectional",
      pos_settings: "bidirectional",
      pos_store_settings: "bidirectional",
      secure_settings: "pull",
      settings_locks: "pull",
      settings_overrides: "bidirectional",
      settings_scoped: "bidirectional",
    };

    for (const [tableName, direction] of Object.entries(expectedDirections)) {
      const table = registry.tables.find(
        (candidate: { cloudTable: string }) => candidate.cloudTable === tableName,
      );
      expect(table, `${tableName} must be registered`).toMatchObject({
        sqlServerTable: tableName,
        direction,
      });
      expect(completeSql).toContain(`dbo.[${tableName}]`);
      expect(completeSql).toContain(`ALTER TABLE dbo.[${tableName}] ENABLE CHANGE_TRACKING`);
    }
  });

  it("records key metadata and generated migration support", () => {
    expect(sql).toContain("dbo.pos_schema_migrations");
    expect(sql).toContain("dbo.local_operation_receipts");
    expect(sql).toContain("FOREIGN KEY");
    expect(
      registry.tables.some(
        (table: { columns: Array<{ foreignKey: boolean; foreignKeyTarget?: unknown }> }) =>
          table.columns.some((column) => column.foreignKey && column.foreignKeyTarget),
      ),
    ).toBe(true);
  });

  it("preserves every approval column from multi-column cloud upgrades", () => {
    const approvals = registry.tables.find(
      (table: { cloudTable: string }) => table.cloudTable === "authorization_requests",
    );
    const byName = new Map(
      approvals.columns.map((column: { cloudColumn: string }) => [column.cloudColumn, column]),
    );
    for (const name of [
      "requested_amount",
      "approved_amount",
      "approved_payload",
      "bill_snapshot",
      "snapshot_hash",
      "held_order_id",
      "notified_at",
    ]) {
      expect(byName.has(name), name).toBe(true);
    }
    expect(byName.get("requested_amount")).toMatchObject({
      sqlServerType: "decimal(38,12)",
      nullable: true,
      defaultRule: null,
    });
    expect(byName.get("approved_payload")).toMatchObject({
      sqlServerType: "nvarchar(max)",
      nullable: false,
      defaultRule: "N'{}'",
    });
    expect(sql).toContain(
      "ALTER TABLE dbo.[authorization_requests] ALTER COLUMN [requested_amount] decimal(38,12) NULL",
    );
    expect(sql).not.toContain("DF_authorization_requests_requested_amount] DEFAULT (N'[]')");
  });

  it("executes dynamic default-constraint repairs through SQL variables", () => {
    expect(sql).not.toMatch(/EXEC\s*\([^;]*\bREPLACE\s*\(/i);
    expect(sql).toContain("EXEC sys.sp_executesql @legacy_json_default_0_sql");
    expect(sql).toContain("EXEC sys.sp_executesql @legacy_requested_amount_default_sql");
  });

  it("defers new-column backfills until SQL Server has added the column", () => {
    expect(sql).toContain(
      "EXEC sys.sp_executesql N'UPDATE dbo.[booking_payments] SET [change_given]=0 WHERE [change_given] IS NULL;'",
    );
    expect(sql).not.toMatch(/^\s+UPDATE dbo\.\[/m);
  });

  it("ships one complete re-runnable local database script", () => {
    // The installer uses the current additive schema. Migration 001 remains
    // immutable for installed tills; its company-name constraint was retired
    // by migration 006 and must not be reintroduced by the installer.
    const currentSchema = readFileSync("database/sqlserver/schema.sql", "utf8").trim();
    const companyNameRepair = readFileSync(
      "database/sqlserver/migrations/006_allow_missing_company_name.sql",
      "utf8",
    ).trim();
    const pipeline = readFileSync(
      "database/sqlserver/migrations/002_sync_pipeline.sql",
      "utf8",
    ).trim();
    const notificationPreferences = readFileSync(
      "database/sqlserver/migrations/003_activity_notification_preferences.sql",
      "utf8",
    ).trim();
    const normalize = (value: string) => value.replaceAll("\r\n", "\n").trim();
    const normalizedCompleteSql = normalize(completeSql);

    expect(normalizedCompleteSql).toContain(normalize(currentSchema));
    expect(normalizedCompleteSql).toContain(normalize(pipeline));
    expect(normalizedCompleteSql).toContain(normalize(notificationPreferences));
    expect(normalizedCompleteSql).toContain(normalize(companyNameRepair));
    expect(completeSql).toContain("IF DB_ID(N'POS_Local') IS NULL");
    expect(completeSql).toContain("EXEC(N'CREATE DATABASE [POS_Local]')");
    expect(completeSql).toContain("USE [POS_Local]");
    expect(completeSql).toContain(`Application version: ${applicationVersion}`);
    expect(completeSql).toContain("DB_NAME() AS database_name");
    expect(completeSql).toContain("POS_Local installation and validation completed successfully");
    expect(completeSql).toContain("@Required AS required_tables");
    expect(completeSql).toContain("@RequiredColumnCount AS required_columns");
    expect(completeSql).toContain("@MissingColumnCount AS missing_columns");
    expect(completeSql).toContain("Retail POS local database migration history table is missing.");
    expect(completeSql).toContain("WHERE version = 2");
    expect(completeSql).toContain("WHERE version = 3");
    expect(completeSql).toContain("CK_activity_events_cleared_by_json_array");
    expect(completeSql).toContain("IX_activity_events_store_created");
    const columnInserts = [
      ...completeSql.matchAll(
        /INSERT INTO @RequiredColumns \(table_name, column_name\) VALUES([\s\S]*?);/g,
      ),
    ];
    expect(columnInserts).toHaveLength(2);
    expect(columnInserts.every((match) => (match[1].match(/\(N'/g) ?? []).length <= 1_000)).toBe(
      true,
    );
    for (const table of registry.tables) {
      expect(completeSql).toContain(`(N'${table.sqlServerTable}')`);
      for (const column of table.columns) {
        expect(completeSql).toContain(`(N'${table.sqlServerTable}', N'${column.sqlServerColumn}')`);
      }
    }
  });

  it("exports a guarded selected-database migration bundle for update recovery", async () => {
    const { migrationBundleSql } = await import("../../../electron/db/migrations.cjs");
    const bundle = migrationBundleSql("1.3.288");
    expect(bundle).toContain("Retail POS local SQL Server migration bundle");
    expect(bundle).toContain("Select the configured Retail POS database");
    expect(bundle).toContain("001_initial.sql");
    expect(bundle).toContain("003_activity_notification_preferences.sql");
    expect(bundle).toContain("Current additive schema repair");
  });

  it("uses SQL Server-compatible types for every generated index key", () => {
    for (const table of registry.tables) {
      for (const column of table.columns) {
        const indexed =
          column.primaryKey ||
          column.unique ||
          column.uniqueGroup ||
          ["store_id", "branch_id", "organization_id", "updated_at"].includes(
            column.sqlServerColumn,
          );
        if (indexed) {
          expect(
            column.sqlServerType,
            `${table.sqlServerTable}.${column.sqlServerColumn}`,
          ).not.toBe("nvarchar(max)");
        }
      }
    }
    expect(sql).toContain("ALTER COLUMN [store_id] nvarchar(450)");
    expect(sql).toContain("ALTER COLUMN [updated_at] datetimeoffset(7)");
    expect(sql).toContain("EXEC(N'CREATE INDEX IX_sync_change_journal_pending");
  });

  it("mirrors nullable cloud idempotency keys as filtered unique indexes", () => {
    const payments = registry.tables.find(
      (table: { cloudTable: string }) => table.cloudTable === "payment_transactions",
    );
    const sales = registry.tables.find(
      (table: { cloudTable: string }) => table.cloudTable === "sales",
    );

    expect(
      payments.columns.find(
        (column: { cloudColumn: string }) => column.cloudColumn === "client_transaction_id",
      ).unique,
    ).toBe(true);
    expect(
      sales.columns.find(
        (column: { cloudColumn: string }) => column.cloudColumn === "client_transaction_id",
      ).unique,
    ).toBe(true);
    expect(sql).toContain(
      "CREATE UNIQUE INDEX [UX_payment_transactions_client_transaction_id] ON dbo.[payment_transactions]([client_transaction_id]) WHERE [client_transaction_id] IS NOT NULL",
    );
    expect(sql).toContain(
      "CREATE UNIQUE INDEX [UX_sales_client_transaction_id] ON dbo.[sales]([client_transaction_id]) WHERE [client_transaction_id] IS NOT NULL",
    );
  });

  it("orders every foreign-key parent before its children", () => {
    const byName = new Map(
      registry.tables.map((table: { cloudTable: string }) => [table.cloudTable, table]),
    );
    for (const table of registry.tables) {
      for (const column of table.columns.filter(
        (item: { foreignKeyTarget?: { table: string } | null }) =>
          item.foreignKeyTarget?.table && item.foreignKeyTarget.table !== table.cloudTable,
      )) {
        const parent = byName.get(column.foreignKeyTarget.table) as
          { dependencyOrder: number } | undefined;
        expect(parent?.dependencyOrder).toBeLessThan(table.dependencyOrder);
        const targetTable = byName.get(column.foreignKeyTarget.table) as
          { columns: Array<{ sqlServerColumn: string; sqlServerType: string }> } | undefined;
        const targetColumn = targetTable?.columns.find(
          (candidate) => candidate.sqlServerColumn === column.foreignKeyTarget.column,
        );
        expect(
          column.sqlServerType,
          `${table.sqlServerTable}.${column.sqlServerColumn} -> ${column.foreignKeyTarget.table}.${column.foreignKeyTarget.column}`,
        ).toBe(targetColumn?.sqlServerType);
      }
    }
  });
});
