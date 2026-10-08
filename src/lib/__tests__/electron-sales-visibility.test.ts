import { describe, expect, it, vi } from "vitest";

describe("Electron sales visibility", () => {
  it("hydrates local receipt headers with their items and payments", async () => {
    const query = vi.fn(async (sql: string) => {
      expect(sql).toContain("DECLARE @recent_sales");
      expect(sql).toContain("dbo.sale_items");
      expect(sql).toContain("dbo.payment_transactions");
      return {
        recordsets: [
          [{ id: "11111111-1111-4111-8111-111111111111", payments: "[]" }],
          [
            {
              id: "22222222-2222-4222-8222-222222222222",
              sale_id: "11111111-1111-4111-8111-111111111111",
              product_name: "Racket",
            },
          ],
          [
            {
              id: "33333333-3333-4333-8333-333333333333",
              sale_id: "11111111-1111-4111-8111-111111111111",
              source_type: "sale",
              method: "card",
              amount: 25,
              metadata: '{"bank":"BIBD"}',
            },
          ],
        ],
      };
    });
    const request = { input: vi.fn(() => request), query };
    const manager = { pool: { request: () => request } };
    const registry = {
      tables: ["sales", "sale_items", "payment_transactions"].map((sqlServerTable) => ({
        sqlServerTable,
        columns: [],
      })),
    };
    const { OperationsRepository } =
      await import("../../../electron/db/repositories/operations.cjs");
    const repository = new OperationsRepository(manager, registry);

    const result = await repository.snapshot("branch-1");
    expect(result.sales).toHaveLength(1);
    expect(result.sales[0].sale_items).toHaveLength(1);
    expect(result.sales[0].payments).toEqual([
      expect.objectContaining({ method: "card", amount: 25, bankName: "BIBD" }),
    ]);
  });

  it("wires durable commit notifications through main and preload", async () => {
    const { readFileSync } = await import("node:fs");
    const main = readFileSync("electron/main.cjs", "utf8");
    const preload = readFileSync("electron/preload.cjs", "utf8");
    const store = readFileSync("src/lib/pos-store.tsx", "utf8");
    expect(main).toContain('webContents.send("business:changed",change)');
    expect(main).toContain("publishBusinessChange({kind:aggregate.kind");
    expect(preload).toContain('ipcRenderer.on("business:changed", handler)');
    expect(store).toContain("bridge.onBusinessChanged");
    expect(store).toContain("loadLocalSales()");
  });

  it("keeps renderer reads branch-scoped and blocks secret tables", async () => {
    const query = vi.fn(async (_sql: string) => ({ recordset: [{ id: "booking-1", store_id: "branch-1" }] }));
    const inputs: Record<string, unknown> = {};
    const request = {
      input: vi.fn((name: string, value: unknown) => { inputs[name] = value; return request; }),
      query,
    };
    const manager = { pool: { request: () => request } };
    const registry = { tables: [{
      cloudTable: "bookings", sqlServerTable: "bookings", scope: "branch",
      columns: [
        { cloudColumn: "id", sqlServerColumn: "id", primaryKey: true },
        { cloudColumn: "store_id", sqlServerColumn: "store_id", primaryKey: false },
      ],
    }, {
      cloudTable: "secure_settings", sqlServerTable: "secure_settings", scope: "organization",
      columns: [{ cloudColumn: "id", sqlServerColumn: "id", primaryKey: true }],
    }] };
    const { OperationsRepository } = await import("../../../electron/db/repositories/operations.cjs");
    const repository = new OperationsRepository(manager, registry);

    await expect(repository.query("branch-1", "bookings", { limit: 25 })).resolves.toMatchObject({ ok: true });
    expect(inputs.branch).toBe("branch-1");
    expect(query.mock.calls[0][0]).toContain("source.[store_id]=@branch");
    await expect(repository.query("branch-1", "secure_settings", {})).rejects.toMatchObject({ code: "EQUERY_TABLE" });
  });

  it("binds terminal scope and decodes scoped settings on local queries", async () => {
    const inputs = new Map<string, unknown>();
    let statement = "";
    const request = {
      input(name: string, value: unknown) { inputs.set(name, value); return this; },
      async query(sql: string) {
        statement = sql;
        return { recordset: [{ scope: "GLOBAL", scope_id: "", key: "pos_field:company_name", value: '"Actual Business Name"' }] };
      },
    };
    const registry = { tables: [{
      cloudTable: "settings_scoped", sqlServerTable: "settings_scoped",
      columns: [
        { cloudColumn: "scope", sqlServerColumn: "scope", primaryKey: true },
        { cloudColumn: "scope_id", sqlServerColumn: "scope_id", primaryKey: true },
        { cloudColumn: "key", sqlServerColumn: "key", primaryKey: true },
        { cloudColumn: "value", sqlServerColumn: "value", cloudType: "jsonb" },
      ],
    }] };
    const { OperationsRepository } = await import("../../../electron/db/repositories/operations.cjs");
    const repository = new OperationsRepository({ pool: { request: () => request } }, registry);
    const result = await repository.query("branch-1", "settings_scoped", { limit: 1 }, "terminal-1");
    expect(inputs.get("terminal")).toBe("terminal-1");
    expect(statement).toContain("[scope_id]=@terminal");
    expect(statement).toContain("[scope_id]=@branch");
    expect(statement).toContain("scoped_store.[group_id]");
    expect(result.rows[0].value).toBe("Actual Business Name");
  });

  it("binds terminal scope during local/cloud verification", async () => {
    const inputs = new Map<string, unknown>();
    let statement = "";
    const request = {
      input(name: string, value: unknown) { inputs.set(name, value); return this; },
      async query(sql: string) { statement = sql; return { recordset: [] }; },
    };
    const table = {
      cloudTable: "settings_scoped", sqlServerTable: "settings_scoped",
      columns: [{ cloudColumn: "key", sqlServerColumn: "key", primaryKey: true }],
    };
    const { localSignature } = await import("../../../electron/sync/verifier.cjs");
    await localSignature({
      connectionManager: { pool: { request: () => request } },
      registry: { tables: [table] }, table, branchId: "branch-1", terminalId: "terminal-1", historyDays: 90,
    });
    expect(inputs.get("terminal")).toBe("terminal-1");
    expect(statement).toContain("[scope_id]=@terminal");
  });

  it("keeps Electron local-first and uses the nested sync bridge", async () => {
    const { readFileSync } = await import("node:fs");
    const store = readFileSync("src/lib/pos-store.tsx", "utf8");
    const sync = readFileSync("src/lib/sync-engine.ts", "utf8");
    const database = readFileSync("src/core/api/pos-db.ts", "utf8");

    expect(store).toContain("const cloudTask = loadPrimaryState(undefined, locationTask ?? undefined, (name) =>");
    expect(store).toContain(".then(() => loadPrimaryState(active ?? undefined))");
    expect(store).toContain(".then(() => loadLocalSales())");
    expect(database).toContain("branch_id: s.storeId");
    expect(sync).toContain("desktopBridge.sync?.auto");
    expect(sync).toContain("desktopBridge?.sync?.subscribe");
    expect(sync).toContain("desktopBridge.sync?.getStatus");
  });

  it("canonicalizes only missing or SQL-equivalent legacy branch fields before upload", async () => {
    const { rowsForBranch } = await import("../../../electron/sync/push-worker.cjs");
    const rows = rowsForBranch("sale_items", [
      { id: "missing", branch_id: null },
      { id: "correct", branch_id: "branch-1" },
      { id: "case", branch_id: "BRANCH-1" },
      { id: "space", branch_id: "branch-1 " },
      { id: "wrong", branch_id: "branch-2" },
    ], "branch-1");

    expect(rows).toEqual([
      { id: "missing", branch_id: "branch-1" },
      { id: "correct", branch_id: "branch-1" },
      { id: "case", branch_id: "branch-1" },
      { id: "space", branch_id: "branch-1" },
      { id: "wrong", branch_id: "branch-2" },
    ]);
    expect(rowsForBranch("audit_logs", [
      { id: "missing", store_id: null },
      { id: "correct", store_id: "branch-1" },
      { id: "case", store_id: "BRANCH-1" },
      { id: "space", store_id: "branch-1\t" },
      { id: "wrong", store_id: "branch-2" },
    ], "branch-1")).toEqual([
      { id: "missing", store_id: "branch-1" },
      { id: "correct", store_id: "branch-1" },
      { id: "case", store_id: "branch-1" },
      { id: "space", store_id: "branch-1" },
      { id: "wrong", store_id: "branch-2" },
    ]);
    expect(rowsForBranch("sales", [{ id: "sale" }], "branch-1")).toEqual([{ id: "sale" }]);
    expect(rowsForBranch({
      cloudTable: "purchase_orders", scope: "branch", direction: "bidirectional",
      columns: [{ cloudColumn: "id" }, { cloudColumn: "store_id" }],
    }, [
      { id: "missing", store_id: null },
      { id: "correct", store_id: "branch-1" },
      { id: "case", store_id: "BRANCH-1" },
      { id: "space", store_id: " branch-1 " },
      { id: "wrong", store_id: "branch-2" },
    ], "branch-1")).toEqual([
      { id: "missing", store_id: "branch-1" },
      { id: "correct", store_id: "branch-1" },
      { id: "case", store_id: "branch-1" },
      { id: "space", store_id: "branch-1" },
      { id: "wrong", store_id: "branch-2" },
    ]);
    expect(rowsForBranch({
      cloudTable: "stock_count_drafts", scope: "branch", direction: "bidirectional",
      columns: [{ cloudColumn: "id" }, { cloudColumn: "store_id" }],
    }, [{ id: "draft", store_id: "" }], "branch-1"))
      .toEqual([{ id: "draft", store_id: "branch-1" }]);
    expect(rowsForBranch({
      cloudTable: "app_users", scope: "branch", direction: "pull",
      columns: [{ cloudColumn: "id" }, { cloudColumn: "store_id" }],
    }, [{ id: "global-admin", store_id: null }], "branch-1"))
      .toEqual([{ id: "global-admin", store_id: null }]);
  });

  it("reveals only unowned legacy receiving drafts to the paired till", async () => {
    const statements: string[] = [];
    const request = {
      input: vi.fn(() => request),
      query: vi.fn(async (sql: string) => {
        statements.push(sql);
        return { recordset: [] };
      }),
    };
    const purchaseOrders = {
      cloudTable: "purchase_orders",
      sqlServerTable: "purchase_orders",
      scope: "branch",
      columns: [
        { cloudColumn: "id", sqlServerColumn: "id", primaryKey: true },
        { cloudColumn: "store_id", sqlServerColumn: "store_id", primaryKey: false },
      ],
    };
    const purchaseItems = {
      cloudTable: "purchase_order_items",
      sqlServerTable: "purchase_order_items",
      scope: "branch",
      columns: [
        { cloudColumn: "id", sqlServerColumn: "id", primaryKey: true },
        {
          cloudColumn: "po_id",
          sqlServerColumn: "po_id",
          primaryKey: false,
          foreignKey: true,
          foreignKeyTarget: { table: "purchase_orders", column: "id" },
        },
      ],
    };
    const { OperationsRepository } = await import(
      "../../../electron/db/repositories/operations.cjs"
    );
    const repository = new OperationsRepository(
      { pool: { request: () => request } },
      { tables: [purchaseOrders, purchaseItems] },
    );

    await repository.query("branch-1", "purchase_orders", { limit: 10 });
    await repository.query("branch-1", "purchase_order_items", { limit: 10 });

    expect(statements[0]).toContain(
      "(source.[store_id]=@branch OR NULLIF(source.[store_id],N'') IS NULL)",
    );
    expect(statements[1]).toContain("dbo.[purchase_orders] parent");
    expect(statements[1]).toContain(
      "(parent.[store_id]=@branch OR NULLIF(parent.[store_id],N'') IS NULL)",
    );
    expect(statements.join("\n")).not.toContain("store_id<>@branch");
  });

  it("stores the branch on offline sign-in audit rows", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/lib/offline-sign-ins.ts", "utf8");
    expect(source).toContain("store_id: input.storeId");
  });

  it("preserves the PostgREST reason behind an HTTP 400", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify({ code: "P0001", message: "SYNC_BRANCH_FORBIDDEN", details: "sale_items" }),
      { status: 400, headers: { "content-type": "application/json" } },
    ));
    try {
      const { CloudClient } = await import("../../../electron/sync/cloud-client.cjs");
      const client = new CloudClient({
        configStore: { get: () => "https://pos.example.test" },
        terminalStore: { read: () => ({ tokenId: "terminal-token" }) },
      });
      await expect(client.pushAggregate({
        batchId: "batch-1",
        branchId: "branch-1",
        operations: [],
      })).rejects.toMatchObject({
        message: "SYNC_BRANCH_FORBIDDEN",
        code: "P0001",
        status: 400,
        detail: "sale_items",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
