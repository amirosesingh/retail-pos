import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(file, "utf8");

describe("company name cloud-to-Electron sync", () => {
  it("keeps a missing cloud value missing without breaking the local schema", () => {
    const cloudMigration = read("supabase/migrations/20261007110407_restore_pos_settings_sync_contract.sql");
    const localMigration = read("database/sqlserver/migrations/006_allow_missing_company_name.sql");
    const localSchema = read("database/sqlserver/schema.sql");
    expect(cloudMigration).toContain("ALTER COLUMN company_name DROP NOT NULL");
    expect(cloudMigration).not.toContain("company_name = COALESCE");
    expect(localMigration).toContain("ALTER COLUMN company_name nvarchar(max) NULL");
    expect(localMigration).toContain("EXEC sys.sp_executesql @drop_company_name_default_sql");
    expect(localMigration).not.toContain("EXEC(N'ALTER TABLE dbo.pos_settings DROP CONSTRAINT '");
    expect(localSchema).toContain("[company_name] nvarchar(max) NULL");
    expect(localSchema).not.toContain("[company_name]=''RETAIL''");
  });

  it.each([null, "Actual Business Name"])("MERGEs the actual cloud company name %s", async (companyName) => {
    const inputs = new Map<string, unknown>();
    let query = "";
    class Request {
      input(name: string, value: unknown) { inputs.set(name, value); return this; }
      async query(sql: string) { query = sql; return { rowsAffected: [1] }; }
    }
    const { CloudClient } = await import("../../../electron/sync/cloud-client.cjs");
    const client = new CloudClient({
      configStore: { get: () => "" }, terminalStore: { read: () => ({}) },
      connectionManager: { sql: () => ({ Request }) },
    });
    await client.applyLocalBatch({}, {
      cloudTable: "pos_settings", sqlServerTable: "pos_settings", conflictRule: "scoped_version",
      columns: [
        { cloudColumn: "id", sqlServerColumn: "id", primaryKey: true },
        { cloudColumn: "company_name", sqlServerColumn: "company_name" },
      ],
    }, { rows: [{ row_data: { id: 1, company_name: companyName } }], tombstones: [] });
    expect([...inputs.values()]).toContain(companyName);
    expect(query).toContain("[company_name]");
  });

  it("prompts admins but does not block ordinary POS work", () => {
    const store = read("src/lib/pos-store.tsx");
    const identity = read("src/routes/settings.identity.tsx");
    expect(store).toContain("if (!signedIn || !isAdmin || !ready || loadPhase !== \"ready\") return;");
    expect(identity).toContain("Company name is missing from the cloud");
  });
});

describe("scoped settings JSON synchronization", () => {
  it("encodes cloud scalar strings as JSON before storing them in SQL Server", async () => {
    const { toLocalValue, toCloudRow } = await import("../../../electron/sync/row-codec.cjs");
    const column = { cloudColumn: "value", sqlServerColumn: "value", cloudType: "jsonb" };
    const local = toLocalValue(column, "Actual Business Name");
    expect(local).toBe('"Actual Business Name"');
    expect(toCloudRow({ sqlServerTable: "settings_scoped", columns: [column] }, { value: local }).value)
      .toBe("Actual Business Name");
  });

  it("repairs only invalid local scoped JSON while retaining its original text", () => {
    const migration = read("database/sqlserver/migrations/006_allow_missing_company_name.sql");
    const upgradeRepair = read("database/sqlserver/migrations/007_repair_scoped_json_values.sql");
    expect(migration).toContain("UPDATE dbo.settings_scoped");
    expect(migration).toContain("STRING_ESCAPE([value], 'json')");
    expect(migration).toContain("ISJSON(N'[' + [value] + N']') <> 1");
    expect(upgradeRepair).toContain("UPDATE dbo.settings_scoped");
    const manualRepair = read("database/sqlserver/POS_Local_company_name_scoped_json_repair.sql");
    expect(manualRepair).toContain("IF DB_NAME() <> N'POS_Local'");
    expect(manualRepair).toContain("BEGIN TRANSACTION");
    expect(manualRepair).toContain("IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION");
    expect(manualRepair).toContain("invalid_scoped_json_rows");
  });

  it("encodes scalar JSON when a terminal writes directly to SQL Server", async () => {
    const inputs = new Map<string, unknown>();
    class Request {
      input(name: string, value: unknown) { inputs.set(name, value); return this; }
      async query() { return { rowsAffected: [1] }; }
    }
    const { OperationsRepository } = await import("../../../electron/db/repositories/operations.cjs");
    const table = {
      cloudTable: "settings_scoped", sqlServerTable: "settings_scoped", scope: "global",
      columns: [
        { sqlServerColumn: "key", primaryKey: true, cloudType: "text" },
        { sqlServerColumn: "value", cloudType: "jsonb" },
      ],
    };
    const repository = new OperationsRepository(
      { sql: () => ({ Request }) }, { tables: [table] },
    );
    repository.branchPredicate = () => null;
    await repository.applyOperation({}, {
      kind: "upsert", table: "settings_scoped",
      rows: [{ key: "pos_field:company_name", value: "Actual Business Name" }],
    }, { branchId: "branch-1", terminalId: "terminal-1" });
    expect([...inputs.values()]).toContain('"Actual Business Name"');
  });
});
