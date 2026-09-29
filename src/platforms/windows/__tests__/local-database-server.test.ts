import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  normalizeServerHost,
  parseServerAddress,
  selectDiscoveredServer,
  validateServerEndpoint,
} from "../components/local-database-server";

// @ts-expect-error CommonJS Electron module has no declaration file.
import { discoverLocalSqlServers } from "../../../../electron/db/local-server-discovery.cjs";

describe("local SQL Server wizard server step", () => {
  it("accepts valid hostnames, localhost values, and IP addresses without a connection test", () => {
    for (const host of ["localhost", "SHOP-TILL", "sql.example.internal", "127.0.0.1", "[::1]"]) {
      expect(validateServerEndpoint(host, 1433)).toBeNull();
    }
  });

  it("normalizes whitespace before validation", () => {
    expect(normalizeServerHost("  localhost  ")).toBe("localhost");
    expect(validateServerEndpoint(normalizeServerHost("  127.0.0.1  "), 1433)).toBeNull();
  });

  it("accepts named instances while rejecting malformed endpoints and invalid ports", () => {
    expect(validateServerEndpoint("", 1433)).toContain("Enter a SQL Server hostname");
    expect(validateServerEndpoint("not a host", 1433)).toContain("valid hostname");
    expect(parseServerAddress("localhost\\SQLEXPRESS")).toEqual({
      host: "localhost",
      instanceName: "SQLEXPRESS",
    });
    expect(validateServerEndpoint("localhost\\SQLEXPRESS", 0)).toBeNull();
    expect(validateServerEndpoint("localhost", 0, "SQLEXPRESS")).toBeNull();
    expect(validateServerEndpoint("localhost", 0, "bad instance!")).toContain(
      "valid SQL Server instance",
    );
    expect(validateServerEndpoint("localhost", 0)).toContain("TCP port");
  });

  it("populates the manual field when a discovered server is selected", () => {
    expect(
      selectDiscoveredServer(
        { host: "manual-host", port: 1433 },
        {
          host: "  POS-01 ",
          label: "POS-01 — SALES",
          instanceName: "SALES",
          port: 51433,
          status: "running",
        },
      ),
    ).toEqual({ host: "POS-01", instanceName: "SALES", port: 51433 });
  });

  it("returns installed local instances with their direct TCP ports", async () => {
    const result = await discoverLocalSqlServers({
      platform: "win32",
      hostname: "POS-01",
      run: (
        _file: string,
        _args: string[],
        _options: unknown,
        done: (error: Error | null, stdout?: string) => void,
      ) =>
        done(
          null,
          JSON.stringify([
            {
              instanceName: "MSSQLSERVER",
              serviceName: "MSSQLSERVER",
              status: "running",
              port: 1433,
            },
            { instanceName: "SALES", serviceName: "MSSQL$SALES", status: "installed", port: 51433 },
          ]),
        ),
    });
    expect(result).toEqual({
      ok: true,
      servers: [
        {
          host: "POS-01",
          serverName: "POS-01",
          instanceName: "MSSQLSERVER",
          serviceName: "MSSQLSERVER",
          label: "POS-01 — default instance",
          status: "running",
          port: 1433,
        },
        {
          host: "POS-01",
          serverName: "POS-01",
          instanceName: "SALES",
          serviceName: "MSSQL$SALES",
          label: "POS-01 — SALES",
          status: "installed",
          port: 51433,
        },
      ],
    });
  });

  it("reports supported error and empty-result scan states without probing a network", async () => {
    const empty = await discoverLocalSqlServers({
      platform: "win32",
      hostname: "POS-01",
      run: (
        _file: string,
        _args: string[],
        _options: unknown,
        done: (error: Error | null, stdout?: string) => void,
      ) => done(new Error("not installed"), ""),
    });
    expect(empty).toMatchObject({
      ok: false,
      servers: [],
      error: expect.stringContaining("inspect"),
    });
    await expect(discoverLocalSqlServers({ platform: "linux" })).resolves.toMatchObject({
      ok: false,
      servers: [],
    });
  });

  it("keeps manual entry available and presents scan loading, error, and empty states", () => {
    const wizard = readFileSync("src/platforms/windows/components/LocalDatabaseWizard.tsx", "utf8");
    expect(wizard).toContain("const [scanning, setScanning]");
    expect(wizard).toContain('scanning ? "Scanning…" : "Scan / Detect"');
    expect(wizard).toContain("discoveryError");
    expect(wizard).toContain("Manual hostname or IP entry is always available.");
    expect(wizard).toContain('aria-label="Detected SQL Server instance"');
    expect(wizard).toContain('aria-label="Available database"');
  });

  it("preserves the seven-step wizard and keeps discovery separate from persistence", () => {
    const wizard = readFileSync("src/platforms/windows/components/LocalDatabaseWizard.tsx", "utf8");
    expect(wizard).toContain(
      'const steps = ["Mode", "Server", "Authentication", "Test", "Database", "Validate", "Save"]',
    );
    expect(wizard).toContain("const response = await database.listServers()");
    expect(wizard).toContain("selectDiscoveredServer(current, server)");
    expect(wizard).toContain("saveAndConnect(profile)");
    expect(wizard).toContain("await mirrorTerminalConfigToDesktop()");
    expect(wizard).toContain("validationHasSchemaDifferences");
    expect(wizard).toContain("Download migration SQL file");
    expect(wizard).toContain("Apply directly and validate again");
    expect(wizard).toContain("Missing tables:");
    expect(wizard).toContain("Table changes required:");

    const scan = wizard.slice(wizard.indexOf("const scanServers"), wizard.indexOf("const ok ="));
    expect(scan).not.toContain("saveAndConnect");
    expect(scan).not.toContain("setEnabled");
    expect(scan).not.toContain("removeConfiguration");
  });

  it("keeps the wizard navigation footer visible while the step body scrolls", () => {
    const wizard = readFileSync("src/platforms/windows/components/LocalDatabaseWizard.tsx", "utf8");
    expect(wizard).toContain("flex max-h-[92dvh] flex-col overflow-hidden");
    expect(wizard).toContain("min-h-0 flex-1 overflow-y-auto");
    expect(wizard).toContain("flex shrink-0 justify-between");
    expect(wizard).toContain("setStep((value) => Math.min(6, value + 1))");
  });

  it("opens all database errors and routes database settings to the local SQL popup", () => {
    const operations = readFileSync("src/platforms/windows/components/LocalDatabaseOperations.tsx", "utf8");
    expect(operations).toContain("setFailureDetailsOpen(true)");
    expect(operations).toContain("Database errors");
    expect(operations).toContain("databaseErrors");
    expect(operations).toContain("businessBatches");
    expect(operations).toContain("failure.error_message");
    expect(operations).toContain("conflict.reason");
    expect(operations.match(/await mirrorTerminalConfigToDesktop\(\)/g)).toHaveLength(4);
    expect(operations).toContain("hasDatabaseConnectivityError");
    expect(operations).toContain("Open Database Settings");
    expect(operations).toContain("OPEN_LOCAL_DATABASE_SETTINGS_EVENT");
    const wizard = readFileSync("src/platforms/windows/components/LocalDatabaseWizard.tsx", "utf8");
    expect(wizard).toContain('"pos:open-local-database-settings"');
    expect(wizard).toContain("window.addEventListener(OPEN_LOCAL_DATABASE_SETTINGS_EVENT");
  });

  it("performs migration connectivity preflight and revalidation", () => {
    const main = readFileSync("electron/main.cjs", "utf8");
    const handler = main.slice(main.indexOf('ipcMain.handle("database:migrate"'), main.indexOf('ipcMain.handle("database:migrate-saved"'));
    expect(handler).toContain('observedDatabaseOperation("migration","preflight"');
    expect(handler).toContain('observedDatabaseOperation("migration","apply"');
    expect(handler).toContain('observedDatabaseOperation("migration","revalidate"');
    const health = readFileSync("electron/db/health.cjs", "utf8");
    expect(health).toContain('kind:"index"');
    expect(health).toContain('kind:"constraint"');
    expect(health).toContain("requiredIndexes()");
  });

  it("repairs the legacy terminal platform default without rewriting terminal rows", () => {
    const migration = readFileSync("database/sqlserver/migrations/004_repair_terminal_platform_default.sql", "utf8");
    const installer = readFileSync("database/sqlserver/retail-pos-local-database.sql", "utf8");
    expect(migration).toContain("DROP CONSTRAINT");
    expect(migration).toContain("DEFAULT (N'pc') FOR platform");
    expect(migration).not.toMatch(/UPDATE\s+dbo\.terminal_tokens/i);
    expect(installer).toContain("repair_terminal_platform_default");
  });

  it("reports reconciliation drift as a completed comparison", () => {
    const main = readFileSync("electron/main.cjs", "utf8");
    const handler = main.slice(
      main.indexOf('ipcMain.handle("sync:reconcile"'),
      main.indexOf('ipcMain.handle("telemetry:presence"'),
    );
    expect(handler).toContain("{ok:true,matched:differences.length===0,differences");
    expect(handler).toContain("{ok:true,verified:report.verified,differences");
    expect(handler).toContain('{ok:false,code:error?.code??"ERECONCILE"');
  });
});
