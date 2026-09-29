import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("SQL Server checkpoints 13 through 15", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("retrieves an exact cloud receipt and materializes the aggregate atomically", async () => {
    const commit = vi.fn();
    const rollback = vi.fn();
    class Transaction {
      begin = vi.fn();
      commit = commit;
      rollback = rollback;
    }
    const pool = {
      request: () => ({
        input() { return this; },
        query: vi.fn().mockResolvedValue({ recordset: [] }),
      }),
    };
    const remote = {
      sale: { id: "S1", store_id: "B1", bill_number: "R-1" },
      items: [{ id: "I1", sale_id: "S1" }],
      payments: [{ id: "P1", sale_id: "S1" }],
    };
    const cloud = { oldReceipt: vi.fn().mockResolvedValue(remote), applyLocalBatch: vi.fn() };
    const { ReceiptRepository } = await import("../../../electron/db/repositories/receipts.cjs");
    const repository = new ReceiptRepository({
      pool,
      sql: () => ({ Transaction, ISOLATION_LEVEL: { SERIALIZABLE: 4 } }),
    }, cloud);

    await expect(repository.findExact("R-1", "B1")).resolves.toEqual({ source: "cloud", ...remote });
    expect(cloud.oldReceipt).toHaveBeenCalledWith("R-1", "B1", {});
    expect(cloud.applyLocalBatch).toHaveBeenCalledTimes(3);
    expect(commit).toHaveBeenCalledOnce();
    expect(rollback).not.toHaveBeenCalled();
  });

  it("requires connectivity when a receipt is outside retained local history", async () => {
    const pool = {
      request: () => ({
        input() { return this; },
        query: vi.fn().mockResolvedValue({ recordset: [] }),
      }),
    };
    const cloud = { oldReceipt: vi.fn().mockRejectedValue(new Error("offline")) };
    const { ReceiptRepository } = await import("../../../electron/db/repositories/receipts.cjs");
    const repository = new ReceiptRepository({ pool }, cloud);
    await expect(repository.findExact("R-OLD", "B1")).rejects.toMatchObject({ code: "EONLINE_REQUIRED" });
  });

  it("enforces branch and refund permission before the service-role historical lookup", () => {
    const endpoint = readFileSync("src/lib/sync-endpoint.server.ts", "utf8");
    expect(endpoint).toMatch(/body\.oldReceipt[\s\S]+permissions\.can_process_refund/);
    expect(endpoint).toContain('code:"PERMISSION_DENIED"');
    expect(endpoint).toMatch(/branchId !== scope\.storeId/);
    expect(endpoint).toContain("terminalBound || !mayManageOtherBranches");
  });

  it("pins desktop synchronization and local snapshots to the activated branch", () => {
    const caller = readFileSync("src/core/api/pos-relay.server.ts", "utf8");
    const cloud = readFileSync("electron/sync/cloud-client.cjs", "utf8");
    const operations = readFileSync("electron/db/repositories/operations.cjs", "utf8");
    const main = readFileSync("electron/main.cjs", "utf8");

    expect(caller).toContain("if (terminalStore) identity = { ...identity, storeId: terminalStore, terminalId }");
    expect(cloud).toContain("JSON.stringify({ ...payload, ...personProof, terminalToken })");
    expect(main).toContain("operationsRepository.snapshot(localBranchId(), terminalStore.read()?.tokenId ?? null)");
    expect(operations).toContain("FROM dbo.shifts WHERE store_id=@branch");
    expect(operations).toContain("FROM dbo.sales WHERE store_id=@branch");
    expect(operations).toContain("NULLIF(owner_store_id,N'') IS NULL OR owner_store_id=@branch");
  });

  it("publishes every synced table and pulls only branch or shared rows", () => {
    const schema = readFileSync("supabase/schema.sql", "utf8");
    expect(schema.match(/CREATE TRIGGER sync_feed_change AFTER INSERT OR UPDATE OR DELETE/g)).toHaveLength(69);
    expect(schema).toContain("candidate.branch_id IN (p_branch_id,'global')");
    expect(schema).toContain("candidate.terminal_id IS NULL OR candidate.terminal_id=p_terminal_id");
    expect(schema).toContain("x.store_id::text=p_branch_id");
    expect(schema).toContain("p_branch_id IN (x.from_store_id::text,x.to_store_id::text)");
  });

  it("publishes Windows SQL Server health and signed-in presence through the authenticated relay", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetch);
    const { createTelemetry } = await import("../../../electron/telemetry.cjs");
    const telemetry = createTelemetry({
      databaseService: { manager: { pool: null }, snapshot: () => ({ enabled: true, connected: false, state: "enabled_degraded", profile: { database: "POS" } }) },
      syncCoordinator: { snapshot: () => ({ phase: "idle", failed: 0, lastPushAt: null, lastPullAt: null }) },
      jobRepository: { active: vi.fn() },
      configStore: { get: () => "https://pos.example" },
      terminalStore: { read: () => ({ tokenId: "terminal-token", terminalId: "T1", storeId: "B1", deviceName: "Till 1" }) },
      app: { getVersion: () => "1.2.3" },
    });
    telemetry.setPresence({ sessionStatus: "signed_in", staffName: "Asha", staffRole: "cashier" });
    await telemetry.beat();

    const [url, request] = fetch.mock.calls.at(-1)!;
    const body = JSON.parse(String(request.body));
    expect(url).toBe("https://pos.example/api/v1/pos/sync");
    expect(body.terminalToken).toBe("terminal-token");
    expect(body.sqlServerTelemetry).toMatchObject({
      store_id: "B1", storage_engine: "sqlserver", session_status: "signed_in",
      staff_name: "Asha", staff_role: "cashier", sql_server_state: "enabled_degraded",
    });
  });

  it("renders live snake-case job progress and subscribes to operational state", () => {
    const jobs = readFileSync("src/platforms/windows/components/DatabaseJobProgress.tsx", "utf8");
    const operations = readFileSync("src/platforms/windows/components/LocalDatabaseOperations.tsx", "utf8");
    expect(jobs).toContain("completed_rows");
    expect(jobs).toContain("estimated_total_rows");
    expect(jobs).toContain("current_table");
    expect(operations).toContain("database?.subscribe");
    expect(operations).toContain("jobs?.subscribe");
    expect(operations).toContain("sync?.subscribe");
    expect(operations).toContain('state.state === "disabled"');
    expect(operations).not.toContain("JSON.stringify(sync");
  });
});
