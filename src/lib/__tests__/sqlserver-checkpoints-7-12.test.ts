import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

describe("SQL Server checkpoints 7 through 12", () => {
  it("validates same-aggregate sale items by their explicit branch", () => {
    const schema = readFileSync("supabase/schema.sql", "utf8");
    const migration = readFileSync(
      "supabase/migrations/20260927085119_fix_sale_item_aggregate_branch_guard.sql",
      "utf8",
    );
    const guard = "r->>'branch_id' IS NULL OR r->>'branch_id'<>p_branch_id";
    expect(schema).toContain("WHEN 'sale_items' THEN IF EXISTS");
    expect(schema).toContain(guard);
    expect(migration).toContain(guard);
    expect(migration).toContain("unexpected sale_items guard; migration stopped safely");
  });

  it("deploys the canonical explicit-branch guard to change-tracked sale items", () => {
    const schema = readFileSync("supabase/schema.sql", "utf8");
    const migration = readFileSync(
      "supabase/migrations/20260927090830_fix_sale_item_batch_branch_guard.sql",
      "utf8",
    );
    const guard = "COALESCE(p_rows,'[]'::jsonb)) r WHERE r->>'branch_id' IS NULL OR r->>'branch_id'<>p_branch_id";
    expect(schema).toContain(guard);
    expect(migration).toContain(guard);
    expect(migration).toContain("unexpected sale_items guard; migration stopped safely");
  });

  it("stamps only missing legacy audit branches before enforcing isolation", () => {
    const schema = readFileSync("supabase/schema.sql", "utf8");
    const migration = readFileSync(
      "supabase/migrations/20260927085816_normalize_legacy_audit_log_branch.sql",
      "utf8",
    );
    const stamp = "NULLIF(btrim(r->>'store_id'),'') IS NULL THEN r||jsonb_build_object('store_id',p_branch_id)";
    const reject = "WHERE r->>'store_id'<>p_branch_id";
    expect(schema).toContain(stamp);
    expect(schema).toContain(reject);
    expect(migration).toContain(stamp);
    expect(migration).toContain(reject);
    expect(migration).toContain("unexpected audit_logs guard; migration stopped safely");
  });

  it("uses stable batch identities and a transactional cloud aggregate receipt", async () => {
    const { stableUuid } = await import("../../../electron/db/repositories/aggregates.cjs");
    const { collapseChanges } = await import("../../../electron/sync/push-worker.cjs");
    const payload = { branchId: "B1", table: "sales", from: 9, changes: [{ version: 10, key: { id: "S1" } }] };
    expect(stableUuid(payload)).toBe(stableUuid(JSON.parse(JSON.stringify(payload))));

    const schema = readFileSync("supabase/schema.sql", "utf8");
    expect(schema).toContain("pos_sync_push_aggregate");
    expect(schema).toContain("SYNC_IDEMPOTENCY_MISMATCH");
    expect(schema).toMatch(/FOR v_op[\s\S]+INSERT INTO public\.sync_idempotency_receipts/);
    expect(schema).toContain("SYNC_BRANCH_FORBIDDEN");
    expect(schema).toMatch(/sync_delete_sales\(p_changes jsonb,p_branch_id text,p_terminal_id text\)/);
    expect(schema).toContain("REVOKE ALL ON FUNCTION public.sync_apply_sales(jsonb) FROM PUBLIC");
    expect(schema).toMatch(/sync_apply_item_activity_logs[\s\S]+stock_apply_delta/);
    expect(schema).toMatch(/sync_apply_products[\s\S]+DO UPDATE SET[\s\S]+WHERE EXCLUDED\."row_version">public\."products"\."row_version"/);
    expect(schema).toMatch(/pos_sync_push_aggregate[\s\S]+product_rows\(row_value\)/);
    expect(collapseChanges([
      { entity_type: "sales", entity_id: "S1", operation: "delete" },
      { entity_type: "sales", entity_id: "S1", operation: "insert" },
    ])).toEqual([{ entity_type: "sales", entity_id: "S1", operation: "insert" }]);
  });

  it("rolls back inbound data without advancing its cursor", async () => {
    const commit = vi.fn(); const rollback = vi.fn();
    class Transaction { begin = vi.fn(); commit = commit; rollback = rollback; }
    const checkpoints = { get: vi.fn().mockResolvedValue(null), save: vi.fn() };
    const cloud = {
      pullBatch: vi.fn().mockResolvedValue({ count: 1, cursor: 8, rows: [{ table_name: "products", entity_id: '{"id":"P1"}', row_version: 2, row_data: { id: "P1" } }], tombstones: [] }),
      applyLocalBatch: vi.fn().mockRejectedValue(new Error("injected apply failure")),
    };
    const reader = { unacknowledged: vi.fn().mockResolvedValue(new Set()) };
    const conflicts = { record: vi.fn() };
    const { PullWorker } = await import("../../../electron/sync/pull-worker.cjs");
    const worker = new PullWorker({ connectionManager: { sql: () => ({ Transaction, ISOLATION_LEVEL: { SERIALIZABLE: 4 } }), pool: {} }, cloud, checkpoints, reader, conflicts, registry: { tables: [{ cloudTable: "products", sqlServerTable: "products", dependencyOrder: 1 }] } });
    await expect(worker.run({ branchId: "B1" })).rejects.toThrow("injected");
    expect(rollback).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
    expect(checkpoints.save).not.toHaveBeenCalled();
  });

  it("retries an uncertain outbound commit with the exact same batch ID", async () => {
    vi.useFakeTimers();
    try {
      const change = { version: 4, operation: "I", remote: false, key: { id: "S1" }, entityId: '{"id":"S1"}' };
      const reader = {
        pendingAggregates: vi.fn().mockResolvedValue([]),
        changedIds: vi.fn().mockResolvedValueOnce([change]).mockResolvedValueOnce([]),
        rows: vi.fn().mockResolvedValue([{ id: "S1", store_id: "B1" }]),
      };
      const cloud = { pushBatch: vi.fn().mockRejectedValueOnce(new Error("ack lost")).mockResolvedValue({ ok: true, replayed: true }) };
      const checkpoints = { get: vi.fn().mockResolvedValue({ change_tracking_version: 3 }), save: vi.fn() };
      const { PushWorker } = await import("../../../electron/sync/push-worker.cjs");
      const worker = new PushWorker({ reader, cloud, checkpoints, registry: { tables: [{ cloudTable: "sales", sqlServerTable: "sales", dependencyOrder: 0, direction: "bidirectional", columns: [{ primaryKey: true }] }] } });
      const running = worker.run({ branchId: "B1" });
      await vi.runAllTimersAsync();
      await expect(running).resolves.toMatchObject({ pushed: 1 });
      expect(cloud.pushBatch).toHaveBeenCalledTimes(2);
      expect(cloud.pushBatch.mock.calls[0][0].batchId).toBe(cloud.pushBatch.mock.calls[1][0].batchId);
      expect(checkpoints.save).toHaveBeenCalledWith("B1", "sales", "push", { change_tracking_version: 4 });
    } finally { vi.useRealTimers(); }
  });

  it("advances past cloud-applied SQL changes without echoing them back to Supabase", async () => {
    const remoteChange = {
      version: 12,
      operation: "U",
      remote: true,
      key: { id: "P1" },
      entityId: '{"id":"P1"}',
    };
    const reader = {
      pendingAggregates: vi.fn().mockResolvedValue([]),
      changedIds: vi.fn().mockResolvedValueOnce([remoteChange]).mockResolvedValueOnce([]),
      rows: vi.fn(),
    };
    const cloud = { pushBatch: vi.fn(), terminalId: vi.fn().mockReturnValue("T1") };
    const checkpoints = {
      get: vi.fn().mockResolvedValue({ change_tracking_version: 11 }),
      save: vi.fn(),
    };
    const { PushWorker } = await import("../../../electron/sync/push-worker.cjs");
    const worker = new PushWorker({
      reader,
      cloud,
      checkpoints,
      registry: {
        tables: [
          {
            cloudTable: "products",
            sqlServerTable: "products",
            dependencyOrder: 0,
            direction: "bidirectional",
            columns: [{ primaryKey: true }],
          },
        ],
      },
    });
    await expect(worker.run({ branchId: "B1" })).resolves.toEqual({ pushed: 0 });
    expect(reader.rows).not.toHaveBeenCalled();
    expect(cloud.pushBatch).not.toHaveBeenCalled();
    expect(checkpoints.save).toHaveBeenCalledWith("B1", "products", "push", {
      change_tracking_version: 12,
    });
  });

  it("defers a membership page that claims more data without advancing its cursor", async () => {
    const checkpoints = {
      get: vi.fn(async (_branch: string, table: string) =>
        table === "__membership_directory__" ? { committed_cursor: 8 } : null,
      ),
      save: vi.fn(),
    };
    const cloud = {
      membershipDirectory: vi.fn().mockResolvedValue({
        ok: true,
        mirrored: 0,
        nextRevision: 8,
        hasMore: true,
      }),
      pullBatch: vi.fn().mockResolvedValue({ count: 0, rows: [], tombstones: [] }),
    };
    const { PullWorker } = await import("../../../electron/sync/pull-worker.cjs");
    const worker = new PullWorker({
      connectionManager: {},
      cloud,
      checkpoints,
      registry: { tables: [] },
      reader: {},
      conflicts: {},
    });
    await expect(worker.run({ branchId: "B1" })).resolves.toMatchObject({
      membershipMirrored: 0,
      membershipDeferred: true,
    });
    expect(cloud.membershipDirectory).toHaveBeenCalledOnce();
    expect(cloud.pullBatch).toHaveBeenCalledOnce();
  });

  it("runs the private member-profile cleanup only before migration 5 is recorded", () => {
    const installer = readFileSync("database/sqlserver/retail-pos-local-database.sql", "utf8");
    const migration = readFileSync(
      "database/sqlserver/migrations/005_staff_sql_and_member_directory.sql",
      "utf8",
    );
    const guardedCleanup =
      /IF NOT EXISTS \(SELECT 1 FROM dbo\.pos_schema_migrations WHERE version = 5\)\s+BEGIN\s+UPDATE dbo\.members\s+SET email = NULL/;
    expect(installer).toMatch(guardedCleanup);
    expect(migration).toMatch(guardedCleanup);
  });

  it("selects complete journal aggregates rather than cutting one at the row limit", () => {
    const reader = readFileSync("electron/sync/change-reader.cjs", "utf8");
    expect(reader).toMatch(/SELECT TOP \(@limit\) aggregate_id,MIN\(change_id\)/);
    expect(reader).toMatch(/JOIN selected ON selected\.aggregate_id=journal\.aggregate_id/);
  });

  it("reports a concurrent sync as busy and reads live journal counters", async () => {
    const pendingSummary = vi.fn().mockResolvedValue({ pending: 7, failed: 2 });
    const { SyncCoordinator } = await import("../../../electron/sync/coordinator.cjs");
    const coordinator = new SyncCoordinator({
      pushWorker: { reader: { connectionManager: { pool: {} }, pendingSummary }, run: vi.fn() },
      pullWorker: { run: vi.fn() },
    });
    await expect(coordinator.refresh("B1")).resolves.toMatchObject({ pending: 7, failed: 2 });
    coordinator.running = true;
    await expect(coordinator.runNow({ branchId: "B1" })).resolves.toMatchObject({
      ok: false,
      busy: true,
      code: "ESYNC_BUSY",
    });
  });

  it("keeps an unacknowledged local row and records the cloud conflict", async () => {
    const commit = vi.fn();
    class Transaction { begin = vi.fn(); commit = commit; rollback = vi.fn(); }
    const checkpoints = { get: vi.fn().mockResolvedValue(null), save: vi.fn() };
    const cloud = {
      pullBatch: vi.fn().mockResolvedValue({ count: 1, cursor: 9, rows: [{ table_name: "products", entity_id: '{"id":"P1"}', row_version: 3, row_data: { id: "P1" } }], tombstones: [] }),
      applyLocalBatch: vi.fn(),
    };
    const reader = { unacknowledged: vi.fn().mockResolvedValue(new Set(['{"id":"P1"}'])) };
    const conflicts = { record: vi.fn() };
    const { PullWorker } = await import("../../../electron/sync/pull-worker.cjs");
    const worker = new PullWorker({ connectionManager: { sql: () => ({ Transaction, ISOLATION_LEVEL: { SERIALIZABLE: 4 } }), pool: {} }, cloud, checkpoints, reader, conflicts, registry: { tables: [{ cloudTable: "products", sqlServerTable: "products", dependencyOrder: 1 }] } });
    await expect(worker.run({ branchId: "B1" })).resolves.toMatchObject({ merged: 0, conflicts: 1 });
    expect(cloud.applyLocalBatch).not.toHaveBeenCalled();
    expect(conflicts.record).toHaveBeenCalledOnce();
    expect(checkpoints.save).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledOnce();
  });

  it("streams one million rows through bounded resumable job pages", async () => {
    let held = 0; let cursor = 0;
    const repository = { create: vi.fn(), checkpoint: vi.fn() };
    const { JobManager } = await import("../../../electron/jobs/manager.cjs");
    const manager = new JobManager(repository, { maxBytes: 6 * 1024 * 1024 });
    const result = await manager.runPaged("million", {
      fetchPage: async ({ limit }: { limit: number }) => {
        const count = Math.min(limit, 1_000_000 - cursor);
        const rows = Array.from({ length: count }, (_, index) => cursor + index + 1);
        held = Math.max(held, rows.length); cursor += count;
        return { rows, cursor: String(cursor), done: cursor === 1_000_000 };
      },
      processPage: async () => null,
    });
    expect(result.status).toBe("completed");
    expect(result.completed_rows).toBe(1_000_000);
    expect(held).toBeLessThanOrEqual(2000);
    expect(repository.checkpoint).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ last_committed_cursor: "1000000" }), null);
  });

  it("contains resumable branch bootstrap and protected retention", () => {
    const bootstrap = readFileSync("electron/jobs/bootstrap.cjs", "utf8");
    const retention = readFileSync("electron/jobs/retention.cjs", "utf8");
    const schema = readFileSync("supabase/schema.sql", "utf8");
    expect(schema).toContain("pos_sync_bootstrap");
    expect(schema).toContain("p_history_days>=7300");
    expect(bootstrap).toContain("last_committed_cursor");
    expect(bootstrap).toContain("transaction.commit");
    expect(retention).toContain("acknowledged_at IS NULL");
    expect(retention).toContain("status='unresolved'");
    expect(retention).toContain("payment.status NOT IN ('completed','settled','paid')");
    expect(retention).toContain("shift.closed_at IS NULL");
  });

  it("resumes branch bootstrap from its committed table and page cursor", async () => {
    const committed = vi.fn();
    class Transaction {
      begin = vi.fn();
      commit = committed;
      rollback = vi.fn();
    }
    const checkpoint = vi.fn();
    const cloud = {
      bootstrapPage: vi.fn().mockResolvedValueOnce({ rows: [{ id: "S2" }], cursor: null }),
      applyLocalBatch: vi.fn(),
    };
    const checkpoints = { save: vi.fn() };
    const connectionManager = {
      sql: () => ({ Transaction, ISOLATION_LEVEL: { SERIALIZABLE: 4 } }),
      pool: { request: () => ({ query: vi.fn().mockResolvedValue({ recordset: [{ current_version: 12 }] }) }) },
    };
    const registry = {
      tables: [
        { cloudTable: "stores", sqlServerTable: "stores", dependencyOrder: 0, columns: [{ cloudColumn: "id", primaryKey: true }] },
        { cloudTable: "sales", sqlServerTable: "sales", dependencyOrder: 1, columns: [{ cloudColumn: "id", primaryKey: true }] },
      ],
    };
    const context = {
      job: { dependency_index: 1, last_committed_cursor: "page-4", completed_rows: 200, batch_size: 500, batch_number: 4 },
      waitWhilePaused: vi.fn(),
      checkpoint,
    };
    const { runBootstrap } = await import("../../../electron/jobs/bootstrap.cjs");
    await expect(runBootstrap({ registry, cloud, connectionManager, checkpoints, branchId: "B1", historyDays: 90, context })).resolves.toEqual({ completed: 201 });
    expect(cloud.bootstrapPage).toHaveBeenCalledWith({ table: "sales", branchId: "B1", historyDays: 90, cursor: "page-4", limit: 500 });
    expect(cloud.applyLocalBatch).toHaveBeenCalledOnce();
    expect(checkpoint).toHaveBeenCalledWith(expect.objectContaining({ completed_rows: 201, dependency_index: 1 }), expect.any(Transaction));
    expect(checkpoints.save).toHaveBeenCalledWith("B1", "sales", "push", { change_tracking_version: 12 });
    expect(committed).toHaveBeenCalledOnce();
  });

  it("records the table being requested before a bootstrap failure", async () => {
    const failure = new Error("SYNC_TABLE_FORBIDDEN");
    const checkpoint = vi.fn();
    const cloud = {
      bootstrapPage: vi.fn().mockRejectedValue(failure),
      applyLocalBatch: vi.fn(),
    };
    const context = {
      job: { dependency_index: 0, last_committed_cursor: null, batch_size: 500 },
      waitWhilePaused: vi.fn(),
      checkpoint,
    };
    const registry = {
      tables: [
        {
          cloudTable: "shift_notifications",
          sqlServerTable: "shift_notifications",
          dependencyOrder: 0,
          columns: [{ cloudColumn: "id", primaryKey: true }],
        },
      ],
    };
    const { runBootstrap } = await import("../../../electron/jobs/bootstrap.cjs");

    await expect(
      runBootstrap({
        registry,
        cloud,
        connectionManager: {},
        checkpoints: {},
        branchId: "B1",
        historyDays: 7300,
        context,
      }),
    ).rejects.toBe(failure);

    expect(checkpoint).toHaveBeenCalledWith({
      status: "running",
      phase: "bootstrap",
      current_table: "shift_notifications",
      dependency_index: 0,
      last_committed_cursor: null,
    });
  });

  it("passes sync checkpoints through the reinstall lifecycle", async () => {
    const checkpoints = { save: vi.fn() };
    const { LocalDataLifecycle } = await import("../../../electron/jobs/lifecycle.cjs");
    const lifecycle = new LocalDataLifecycle({
      connectionManager: {}, databaseService: {}, jobManager: {}, jobRepository: {},
      registry: {}, cloud: {}, syncCoordinator: {}, checkpoints,
    });
    expect(lifecycle.checkpoints).toBe(checkpoints);
    expect(lifecycle.bootstrapType(30)).toBe("bootstrap_30");
    expect(lifecycle.bootstrapType(7300)).toBe("bootstrap_7300");
  });

  it("refreshes a reference table even when an older bootstrap is already complete", async () => {
    class Transaction {
      begin = vi.fn();
      commit = vi.fn();
      rollback = vi.fn();
    }
    const table = {
      cloudTable: "store_groups", sqlServerTable: "store_groups", dependencyOrder: 0,
      columns: [{ cloudColumn: "id", primaryKey: true }],
    };
    const cloud = {
      bootstrapPage: vi.fn().mockResolvedValue({ rows: [{ id: "default" }], cursor: null }),
      applyLocalBatch: vi.fn(),
    };
    const { refreshTable } = await import("../../../electron/jobs/bootstrap.cjs");
    await expect(refreshTable({
      registry: { tables: [table] }, cloud,
      connectionManager: { sql: () => ({ Transaction, ISOLATION_LEVEL: { SERIALIZABLE: 4 } }), pool: {} },
      branchId: "B1", historyDays: 90, tableName: "store_groups",
    })).resolves.toEqual({ completed: 1 });
    expect(cloud.bootstrapPage).toHaveBeenCalledWith({ table: "store_groups", branchId: "B1", historyDays: 90, cursor: null, limit: 500 });
    expect(cloud.applyLocalBatch).toHaveBeenCalledWith(expect.any(Transaction), table, expect.objectContaining({
      rows: [expect.objectContaining({ row_data: { id: "default" } })],
    }));
  });

  it("pushes pending local work before the first cloud bootstrap", async () => {
    const order: string[] = [];
    const lifecycle = new (await import("../../../electron/jobs/lifecycle.cjs")).LocalDataLifecycle({
      connectionManager: {},
      databaseService: { transition: vi.fn(), markReady: vi.fn() },
      jobManager: {},
      jobRepository: { active: vi.fn().mockResolvedValue(null), completed: vi.fn().mockResolvedValue(null) },
      registry: {}, cloud: {}, checkpoints: {},
      syncCoordinator: {
        pushWorker: { run: vi.fn(async () => { order.push("push"); return { pushed: 1 }; }) },
        runNow: vi.fn(async () => { order.push("sync"); return { ok: true }; }),
      },
    });
    lifecycle.bootstrap = vi.fn(async () => { order.push("bootstrap"); return {}; });
    lifecycle.retain = vi.fn(async () => ({}));
    lifecycle.reconcile = vi.fn(async () => []);
    await lifecycle.ensure({ branchId: "B1", historyDays: 90 });
    expect(order).toEqual(["push", "bootstrap", "sync"]);
  });
});
