import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(file, "utf8");

describe("SQL Server IPC surface", () => {
  const preload = read("electron/preload.cjs");
  const main = read("electron/main.cjs");
  const privilege = read("electron/ipc-privilege.cjs");

  it("exposes only named database, job, sync, receipt, and business methods", () => {
    for (const channel of [
      "database:get-state", "database:set-enabled", "database:test-server", "database:list-databases",
      "database:validate", "database:migrate", "database:migrate-saved", "database:provision-connect", "database:export-migrations", "database:save-connect", "database:disconnect",
      "database:remove-configuration", "database:health", "database:schema-status", "database:backup",
      "database:restore", "jobs:get-active", "jobs:get-history", "sync:get-status", "sync:run-now",
      "sync:pause", "sync:resume", "sync:get-failures", "sync:reconcile", "business:write-batch",
      "business:snapshot", "business:query", "receipts:find-exact", "receipts:refund",
      "telemetry:presence",
    ]) {
      expect(preload).toContain(channel);
      expect(main).toContain(`"${channel}"`);
      expect(privilege).toContain(`"${channel}"`);
    }
  });

  it("does not expose SQL execution, passwords, or connection strings", () => {
    expect(preload).not.toMatch(/runSql|executeSql|connectionString|savedPassword/i);
    expect(main).not.toMatch(/ipcMain\.handle\("(?:runSql|executeSql)/i);
  });
});
