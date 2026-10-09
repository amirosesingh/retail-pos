import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(file, "utf8");

describe("company name cloud-to-Electron sync", () => {
  it("renders local structured settings as native values rather than quoted SQL text", async () => {
    const { rowToSettings } = await import("../../core/api/pos-db");
    const settings = rowToSettings({
      company_name: "Actual Business Name",
      fonts: '{"header":{"family":"Arial"}}',
      custom_lines: '[{"text":"Thank you"}]',
      receipt_design: '{"logoLayout":{"position":"above-name"}}',
      payment_details: '{"cash":true}',
    });
    expect(settings.receipt.companyName).toBe("Actual Business Name");
    expect(settings.receipt.fonts.header).toEqual({ family: "Arial" });
    expect(settings.receipt.customLines).toEqual([{ text: "Thank you" }]);
    expect(settings.receipt.fonts).not.toHaveProperty("0");
    expect(settings.payment).toMatchObject({ cash: true });
  });

  it("unwraps legacy JSON-quoted identity text without rendering quotes", async () => {
    const { rowToSettings } = await import("../../core/api/pos-db");
    const settings = rowToSettings({ company_name: '"Actual Business Name"', logo_data_url: '"data:image/png;base64,abc"' });
    expect(settings.receipt.companyName).toBe("Actual Business Name");
    expect(settings.receipt.logo).toBe("data:image/png;base64,abc");
    expect(rowToSettings({ company_name: { invalid: true } }).receipt.companyName).toBe("");
  });

  it("does not let an old blank scoped field erase the cloud company name", async () => {
    const { applySettingsFields } = await import("../../core/api/pos-db");
    expect(applySettingsFields(
      { id: 1, company_name: "Actual Business Name" },
      [{ key: "pos_field:company_name", value: "" }],
    )?.company_name).toBe("Actual Business Name");
    expect(applySettingsFields(
      { id: 1, company_name: "" },
      [{ key: "pos_field:company_name", value: "" }],
    )?.company_name).toBe("");
  });

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

  it("runs each bundled SQL Server migration in a separate batch", () => {
    const bundle = read("database/sqlserver/retail-pos-local-database.sql");
    const declarationBatches = bundle.split(/^GO\s*$/m).filter((batch) =>
      batch.includes("DECLARE @company_name_default sysname"));
    expect(declarationBatches).toHaveLength(2);
    for (const batch of declarationBatches) {
      expect(batch.match(/DECLARE @company_name_default sysname/g)).toHaveLength(1);
    }
  });

  it.each([null, "Actual Business Name"])("MERGEs the actual cloud company name %s", async (companyName) => {
    const inputs = new Map<string, unknown>();
    const queries: string[] = [];
    class Request {
      input(name: string, value: unknown) { inputs.set(name, value); return this; }
      async query(sql: string) { queries.push(sql); return { rowsAffected: [1] }; }
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
    expect(queries[0]).toContain("[company_name]");
    if (companyName) {
      expect(queries[1]).toContain("SET [company_name]");
      expect(queries[1]).toContain("NULLIF(LTRIM(RTRIM([company_name])),N'') IS NULL");
      expect(queries[1]).toContain("CHANGE_TRACKING_CONTEXT (0x434C4F5544)");
    } else expect(queries).toHaveLength(1);
  });

  it("prompts admins but does not block ordinary POS work", () => {
    const store = read("src/lib/pos-store.tsx");
    const identity = read("src/routes/settings.identity.tsx");
    expect(store).toContain("if (!signedIn || !isAdmin || !ready || loadPhase !== \"ready\" || !settingsSnapshotLoaded) return;");
    expect(identity).toContain("Company details have not loaded here yet");
    expect(identity).not.toContain("Company name is missing from the cloud");
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

  it("keeps legacy bare scoped strings syncable and decodes local settings for the renderer", async () => {
    const { toCloudRow, toRendererRow } = await import("../../../electron/sync/row-codec.cjs");
    const scoped = {
      sqlServerTable: "settings_scoped",
      columns: [{ cloudColumn: "value", sqlServerColumn: "value", cloudType: "jsonb" }],
    };
    expect(toCloudRow(scoped, { value: "" }).value).toBe("");
    expect(toCloudRow(scoped, { value: "  " }).value).toBe("  ");
    expect(toCloudRow(scoped, { value: "one,two" }).value).toBe("one,two");
    expect(toRendererRow(scoped, { value: '"Actual Business Name"' }).value)
      .toBe("Actual Business Name");
    expect(toRendererRow(scoped, { value: '{"logoLayout":"left"}' }).value)
      .toEqual({ logoLayout: "left" });
    expect(() => toCloudRow({ ...scoped, sqlServerTable: "products" }, { value: "broken" }))
      .toThrow("Invalid local JSON in products.value");
  });

  it("repairs only invalid local scoped JSON while retaining its original text", () => {
    const migration = read("database/sqlserver/migrations/006_allow_missing_company_name.sql");
    const upgradeRepair = read("database/sqlserver/migrations/007_repair_scoped_json_values.sql");
    expect(migration).toContain("UPDATE dbo.settings_scoped");
    expect(migration).toContain("STRING_ESCAPE([value], 'json')");
    expect(migration).toContain("ISJSON(N'[' + [value] + N']') <> 1");
    expect(upgradeRepair).toContain("UPDATE dbo.settings_scoped");
    const currentRepair = read("database/sqlserver/migrations/008_repair_scoped_values_and_company_name.sql");
    expect(currentRepair).toContain("LTRIM(RTRIM([value])) = N''");
    expect(currentRepair).toContain("ALTER TABLE dbo.pos_settings ALTER COLUMN company_name nvarchar(max) NULL");
    const manualRepair = read("database/sqlserver/POS_Local_company_name_scoped_json_repair.sql");
    expect(manualRepair).toContain("IF DB_NAME() <> N'POS_Local'");
    expect(manualRepair).toContain("BEGIN TRANSACTION");
    expect(manualRepair).toContain("IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION");
    expect(manualRepair).toContain("invalid_scoped_json_rows");
    expect(manualRepair).toContain("LTRIM(RTRIM([value])) = N''");
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
