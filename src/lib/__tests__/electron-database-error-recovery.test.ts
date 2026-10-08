import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (file: string) => readFileSync(file, "utf8");

describe("Electron database error recovery", () => {
  it("starts a fresh active-error window for each app launch and resolves successful syncs", () => {
    const diagnostics = source("electron/diagnostics.cjs");
    const main = source("electron/main.cjs");

    expect(main).toContain('diagnostics.logConnection("application.started"');
    expect(main).toContain('diagnostics.logConnection("synchronization.automatic.succeeded"');
    expect(main).toContain('diagnostics.logConnection("synchronization.bootstrap.succeeded"');
    expect(main).toContain("diagnostics.logConnection(`${category}.${stage}.succeeded`");
    expect(diagnostics).toContain("const lastStart");
    expect(diagnostics).toContain("const active = new Map()");
    expect(diagnostics).toContain("row.stage !== detail.stage");
    expect(diagnostics).toContain("occurrences:");
  });

  it("lets Main replace stale renderer branch aliases for till-owned audit and shift sessions", () => {
    const main = source("electron/main.cjs");
    const database = source("src/core/api/pos-db.ts");
    const aggregateRepository = source("electron/db/repositories/aggregates.cjs");

    expect(main).toContain('const verifiedBranchTables=new Set(["audit_logs","shift_sessions"])');
    expect(main).toContain("verifiedBranchTables.has(operation.table)");
    expect(database).toContain("store_id: null");
    expect(main).toContain("Other supplied mismatches remain rejected");
    expect(main).toContain('const saleBranchFields=new Map([');
    expect(main).toContain('["sales",["store_id","branch_id"]]');
    expect(main).toContain('["sale_items",["branch_id"]]');
    expect(main).toContain('["payment_transactions",["store_id"]]');
    expect(main).toContain('stampVerifiedBranchOperations(aggregate.operations,branchId,aggregate.kind)');
    expect(main).toContain('terminalId:terminal.tokenId??terminal.terminalId??null');
    expect(main.match(/stampVerifiedBranchOperations/g)).toHaveLength(3);
    expect(aggregateRepository).toContain(
      "this.operationsRepository.applyOperation(transaction, operation, {",
    );
    expect(aggregateRepository).toContain("branchId: aggregate.branchId");
    expect(aggregateRepository).toContain("terminalId: aggregate.terminalId");
  });

  it("routes public flags through the central authenticated relay on Electron", () => {
    const flags = source("src/lib/public-flags.ts");
    const policy = source("src/core/api/relay-policy.server.ts");

    expect(flags).toContain('platformName() === "electron"');
    expect(flags).toContain("await relayOp");
    expect(policy).toContain('public_flags: { write: "can_access_pos_settings"');
    expect(flags).toContain('onConflict: "key"');
  });

  it("hides failed bootstrap jobs after a later successful recovery", () => {
    const repository = source("electron/jobs/repository.cjs");
    expect(repository).toContain("recovered.status='completed'");
    expect(repository).toContain("recovered.updated_at>failed.updated_at");
    expect(repository).toContain("recovered.job_type=failed.job_type");
    expect(repository).toContain("recovered.organization_id=failed.organization_id");
    expect(repository).toContain("recovered.terminal_id=failed.terminal_id");
  });

  it("returns from Save and Connect while the first branch bootstrap continues", () => {
    const main = source("electron/main.cjs");
    const start = main.indexOf('ipcMain.handle("database:save-connect"');
    const end = main.indexOf('ipcMain.handle("database:disconnect"', start);
    const handler = main.slice(start, end);

    expect(handler).toContain("databaseService.saveAndConnect");
    expect(handler).toContain("void prepareLocalData().catch(()=>undefined)");
    expect(handler).toContain("synchronization:{ok:true,pending:true}");
    expect(handler).not.toContain("await prepareLocalData()");
  });

  it("persists a safe checkout failure reference for support", () => {
    const checkout = source("src/lib/register/use-checkout.ts");
    const diagnostics = source("electron/diagnostics.cjs");
    expect(checkout).toContain('logConnection?.("checkout.commit.failed"');
    expect(checkout).toContain("sqlNumber: failure.sqlNumber");
    expect(diagnostics).toContain('"table", "sqlNumber"');
  });
});
