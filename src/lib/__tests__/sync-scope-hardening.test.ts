import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8").replaceAll("\r\n", "\n");
const require = createRequire(import.meta.url);

describe("scoped SQL Server synchronization", () => {
  it("uses revisions so a stale desktop setting cannot overwrite a newer server row", () => {
    const schema = read("supabase/schema.sql");
    const migration = read(
      "supabase/migrations/20261004093000_settings_last_writer_wins.sql",
    );
    const cloudClient = read("electron/sync/cloud-client.cjs");
    expect(schema).toMatch(/settings_overrides[\s\S]*row_version integer DEFAULT 1 NOT NULL/);
    expect(schema).toMatch(/settings_scoped[\s\S]*row_version integer NOT NULL DEFAULT 1/);
    expect(schema).toContain("NEW.row_version := GREATEST");
    expect(schema).toMatch(
      /sync_apply_settings_overrides[\s\S]*WHERE EXCLUDED\."row_version">public\."settings_overrides"\."row_version"/,
    );
    expect(schema).toMatch(
      /sync_apply_settings_scoped[\s\S]*WHERE EXCLUDED\."row_version">public\."settings_scoped"\."row_version"/,
    );
    for (const table of [
      "integration_settings",
      "pos_settings",
      "pos_store_settings",
      "settings_overrides",
      "settings_scoped",
    ]) {
      expect(cloudClient).toContain(`"${table}"`);
    }
    expect(cloudClient).toContain(
      "source.[updated_at]>target.[updated_at]",
    );
    expect(cloudClient).toContain(
      "source.[updated_at]=target.[updated_at] AND source.[row_version]>=target.[row_version]",
    );
    expect(migration).toContain("NEW.updated_at > current_updated_at");
    expect(migration).toContain("NEW.updated_at < current_updated_at");
    expect(migration).toContain("NEW.row_version := current_version");
    expect(migration).toContain("integration_settings_insert_freshness");
  });

  it("routes mixed settings and authorization scopes without organization-wide operational downloads", () => {
    const schema = read("supabase/schema.sql");
    expect(schema).toContain("lower(x.scope)='branch' AND x.scope_id::text=p_branch_id");
    expect(schema).toContain("lower(x.scope)='terminal' AND x.scope_id::text=p_terminal_id");
    expect(schema).toContain("lower(x.scope_type)='cluster'");
    expect(schema).toContain("terminal_id text");
    expect(schema).toContain(
      "candidate.terminal_id IS NULL OR candidate.terminal_id=p_terminal_id",
    );
    expect(schema).toContain(
      "NULLIF(x.owner_store_id::text,'') IS NULL OR x.owner_store_id::text=p_branch_id",
    );
    expect(schema).toContain("SYNC_PRODUCT_SCOPE_FORBIDDEN");
  });

  it("binds the relay and Electron manual sync to verified device identity", () => {
    const endpoint = read("src/lib/sync-endpoint.server.ts");
    const relay = read("src/core/api/pos-relay.server.ts");
    const main = read("electron/main.cjs");
    expect(endpoint).toContain('p_terminal_id: scope.terminalId ?? ""');
    expect(endpoint).toContain("terminalSync && !scope.terminalId");
    expect(endpoint).toContain('code: "TERMINAL_REQUIRED"');
    expect(relay).toContain("terminalId = input.terminalToken");
    expect(main).toContain("const branchId=localBranchId()");
    expect(main).not.toContain("branchId:input.branchId??localBranchId()");
    expect(read("supabase/schema.sql")).toContain("SYNC_TERMINAL_SCOPE_FORBIDDEN");
    expect(read("supabase/schema.sql")).toContain("t.status IN ('active','used')");
  });

  it("uses branch-filtered realtime only as a durable-sync wake-up hint", () => {
    const engine = read("src/lib/sync-engine.ts");
    const activity = read("src/lib/activity-events.ts");
    const approvals = read("src/lib/approval-centre.ts");
    expect(engine).toContain("filter: `${column}=eq.${liveBranchId}`");
    expect(engine).not.toMatch(/LIVE_SETTINGS_TABLES[\s\S]{0,500}\.\.\.LIVE_SETTINGS_TABLES/);
    expect(activity).toContain("filter: `store_id=eq.${branchId}`");
    expect(approvals).toContain("filter: `store_id=eq.${branchId}`");
    expect(engine).toContain("supabaseExternal.auth.onAuthStateChange");
    expect(engine).toContain("installLiveChannel(staffPresent)");
    expect(engine).toContain("authListener.subscription.unsubscribe()");
    expect(activity).toContain("if (!hasStaffSession()) return");
    expect(approvals).toContain("if (!hasStaffSession()) return");
  });

  it("keeps master/configuration and stock-request transition history append-only", () => {
    const migration = read(
      "supabase/migrations/20260929080000_change_history_stock_request_lifecycle.sql",
    );
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.change_history");
    expect(migration).toContain("change_history is append-only");
    expect(migration).toContain("products_change_history");
    expect(migration).toContain("settings_scoped_change_history");
    expect(migration).toContain("stock_transfers_status_history");
    expect(migration).toContain("request_status");
  });

  it("blocks terminal reassignment until local synchronization is clean", () => {
    const unpair = read("src/platforms/web/components/pos/UnpairTerminal.tsx");
    expect(unpair).toContain("status?.pending");
    expect(unpair).toContain("status?.failed");
    expect(unpair).toContain("status?.conflicts");
    expect(unpair).toContain("await sync?.pause?.()");
    expect(unpair.indexOf("await revokeTerminalToken")).toBeLessThan(
      unpair.indexOf("await unpairTerminal"),
    );
  });

  it("filters the local product snapshot and applies scoped price records", () => {
    const operations = read("electron/db/repositories/operations.cjs");
    const inventory = read("src/routes/inventory.tsx");
    const store = read("src/lib/pos-store.tsx");
    expect(operations).toContain("NULLIF(owner_store_id,N'') IS NULL OR owner_store_id=@branch");
    expect(operations).toContain("product_price:%");
    expect(operations).toContain("global: 0, cluster: 1, branch: 2, terminal: 3");
    expect(inventory).toContain("Use these prices only at {currentStore.name}");
    expect(inventory).toContain(
      "canCreate || canEditDetails || canPrice || canAdjustStock || canLinkBarcode",
    );
    expect(inventory).toContain(
      "!canEditDetails && !canPrice && !canAdjustStock && !canLinkBarcode",
    );
    expect(inventory).toMatch(/\{showMoney && \(\s*<Field label="Cost">/);
    expect(inventory).toMatch(/<Field label="Reorder level">\s*<Input\s*disabled=\{!canEditDetails\}/);
    expect(read("src/core/api/relay-policy.server.ts")).toContain(
      'reorder_level: "can_edit_product_details"',
    );
    expect(inventory).toMatch(
      /upsertProductPriceOverride\(\s*draft\.id,\s*draft\.price,\s*draft\.ecomPrice,?\s*\)/,
    );
    expect(store).toContain("db.commitProductPriceOverride");
    expect(store).toContain("loadProductsByIds(wanted, { branchId, clusterId })");
    expect(read("supabase/schema.sql")).toContain(
      "NULLIF(r->>'foc_product_id','') IS NOT NULL AND NOT EXISTS",
    );
    expect(read("supabase/schema.sql")).toContain(
      "NULLIF(p.owner_store_id::text,'') IS NULL OR p.owner_store_id::text=p_branch_id",
    );
  });

  it("scopes offline push rows to the active branch, including owned catalogue rows", () => {
    const { branchPredicate } = require("../../../electron/db/branch-scope.cjs");
    const registry = {
      tables: [
        {
          sqlServerTable: "products",
          cloudTable: "products",
          columns: [
            { sqlServerColumn: "id", cloudColumn: "id" },
            { sqlServerColumn: "owner_store_id", cloudColumn: "owner_store_id" },
          ],
        },
        {
          sqlServerTable: "product_barcodes",
          cloudTable: "product_barcodes",
          columns: [
            {
              sqlServerColumn: "product_id",
              cloudColumn: "product_id",
              foreignKey: true,
              foreignKeyTarget: { table: "products", column: "id" },
            },
          ],
        },
      ],
    };
    expect(branchPredicate(registry, registry.tables[0], "source")).toBe(
      "(NULLIF(source.[owner_store_id],N'') IS NULL OR source.[owner_store_id]=@branch)",
    );
    expect(branchPredicate(registry, registry.tables[1], "source")).toContain(
      "parent.[id]=source.[product_id]",
    );
    expect(branchPredicate(registry, registry.tables[1], "source")).toContain(
      "parent.[owner_store_id]=@branch",
    );
  });

  it("leaves zero-stock lifecycle decisions to the current database row", () => {
    const store = read("src/lib/pos-store.tsx");
    const catalog = read("src/routes/settings.catalog.tsx");
    expect(store).not.toContain("autoArchiveReconciledRef");
    expect(store).not.toContain("const zeroActive = state.products");
    expect(catalog).not.toContain("patchProducts(");
  });

  it("keeps an empty booking visible on the customer display", () => {
    const display = read("src/routes/display.tsx");
    expect(display).toContain('(snap.mode === "cart" && snap.lines.length === 0)');
    expect(display).not.toContain('snap.mode === "idle" || snap.lines.length === 0');
  });

  it("rejects generic local writes aimed at another branch or a central settings scope", () => {
    const { OperationsRepository } = require("../../../electron/db/repositories/operations.cjs");
    const columns = (names: string[]) =>
      names.map((name) => ({ cloudColumn: name, sqlServerColumn: name }));
    const repository = new OperationsRepository(
      {},
      {
        tables: [
          { cloudTable: "sales", sqlServerTable: "sales", columns: columns(["id", "store_id"]) },
          {
            cloudTable: "settings_overrides",
            sqlServerTable: "settings_overrides",
            columns: columns(["scope", "scope_id", "section"]),
          },
          {
            cloudTable: "stock_transfers",
            sqlServerTable: "stock_transfers",
            columns: columns(["id", "from_store_id", "to_store_id"]),
          },
        ],
      },
    );
    expect(() =>
      repository.assertWriteScope(
        [{ kind: "insert", table: "sales", rows: [{ id: "1", store_id: "B" }] }],
        { branchId: "A", terminalId: "T" },
      ),
    ).toThrow(/terminal's branch/);
    expect(() =>
      repository.assertWriteScope(
        [
          {
            kind: "upsert",
            table: "settings_overrides",
            rows: [{ scope: "GLOBAL", scope_id: "", section: "tax" }],
          },
        ],
        { branchId: "A", terminalId: "T" },
      ),
    ).toThrow(/own branch or terminal settings/);
    expect(() =>
      repository.assertWriteScope(
        [
          {
            kind: "insert",
            table: "stock_transfers",
            rows: [{ id: "1", from_store_id: "B", to_store_id: "C" }],
          },
        ],
        { branchId: "A", terminalId: "T" },
      ),
    ).toThrow(/must involve/);
    expect(() =>
      repository.assertWriteScope(
        [
          { kind: "insert", table: "sales", rows: [{ id: "1", store_id: "A" }] },
          {
            kind: "update",
            table: "settings_overrides",
            match: { scope: "TERMINAL", scope_id: "T", section: "tax" },
            values: { section: "tax" },
          },
        ],
        { branchId: "A", terminalId: "T" },
      ),
    ).not.toThrow();
  });

  it("accepts only verified global POS field saves and keeps other global settings read-only", () => {
    const { OperationsRepository } = require("../../../electron/db/repositories/operations.cjs");
    const repository = new OperationsRepository({}, { tables: [
      { cloudTable: "pos_settings", sqlServerTable: "pos_settings", columns: [] },
      { cloudTable: "settings_scoped", sqlServerTable: "settings_scoped", columns: [] },
    ] });
    const scope = { branchId: "A", terminalId: "T", enforcePermissions: true,
      permissions: { can_access_pos_settings: true } };
    const field = { kind: "upsert", table: "settings_scoped", rows: [
      { scope: "GLOBAL", scope_id: "", key: "pos_field:company_name", value: "Business" },
    ] };
    expect(() => repository.assertWriteScope([field], scope)).not.toThrow();
    expect(() => repository.assertWriteScope([field], { ...scope, permissions: {} }))
      .toThrow(/own branch or terminal settings/);
    expect(() => repository.assertWriteScope([{ ...field, rows: [
      { scope: "GLOBAL", scope_id: "", key: "secret", value: "bad" },
    ] }], scope)).toThrow(/own branch or terminal settings/);
    expect(() => repository.assertWriteScope([
      { kind: "upsert", table: "pos_settings", rows: [{ id: 1 }] },
    ], scope)).not.toThrow();
    expect(() => repository.assertWriteScope([
      { kind: "upsert", table: "pos_settings", rows: [{ id: 1 }] },
    ], { ...scope, permissions: {} })).toThrow(/verified settings operator/);
  });

  it("routes global settings through the permission-gated SQL batch and cloud sync", () => {
    const db = read("src/core/api/pos-db.ts");
    const privilege = read("electron/ipc-privilege.cjs");
    const endpoint = read("src/lib/sync-endpoint.server.ts");
    const push = read("electron/sync/push-worker.cjs");
    const migration = read("supabase/migrations/20261007142937_secure_global_pos_settings_sync.sql");
    expect(db).toContain('aggregateKind !== "settings"');
    expect(privilege).toContain('channel === "business:write-batch"');
    expect(privilege).toContain('adminSession.hasPermission("can_access_pos_settings")');
    for (const name of ["pos_settings", "settings_scoped"]) {
      expect(endpoint).toContain(`"${name}"`);
      expect(push).toContain(`"${name}"`);
    }
    expect(migration).toContain("INSERT INTO public.pos_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING");
    expect(migration).toContain("r->>'key' LIKE 'pos_field:%'");
    expect(migration).toContain("auth.role()='service_role'");
  });

  it("starts new versioned local records at revision one", async () => {
    const queries: string[] = [];
    const inputs: Record<string, unknown> = {};
    const request = {
      input: vi.fn((name: string, value: unknown) => {
        inputs[name] = value;
        return request;
      }),
      query: vi.fn(async (sql: string) => {
        queries.push(sql);
        return { rowsAffected: [1] };
      }),
    };
    const transaction = {};
    const manager = {
      sql: () => ({ Request: class { constructor(_tx: unknown) { return request; } } }),
    };
    const registry = {
      tables: [{
        cloudTable: "products",
        sqlServerTable: "products",
        conflictRule: "last_write_wins",
        columns: [
          { cloudColumn: "id", sqlServerColumn: "id", primaryKey: true },
          { cloudColumn: "name", sqlServerColumn: "name", primaryKey: false },
          { cloudColumn: "row_version", sqlServerColumn: "row_version", primaryKey: false },
        ],
      }],
    };
    const { OperationsRepository } = require("../../../electron/db/repositories/operations.cjs");
    const repository = new OperationsRepository(manager, registry);

    await repository.applyOperation(
      transaction,
      { kind: "upsert", table: "products", rows: [{ id: "P1", name: "New" }] },
      { branchId: "B1", terminalId: "T1" },
    );

    expect(Object.values(inputs)).toContain(1);
    expect(queries[0]).toContain("[row_version]");
  });

  it("checks protected member updates even when the match is not the member id", async () => {
    const inputs: Record<string, unknown> = {};
    const query = vi.fn(async (_sql: string) => ({
      recordset: [{ loyalty_points: 10, total_spent: 50, tier_id: "silver" }],
    }));
    const request = {
      input: vi.fn((name: string, value: unknown) => {
        inputs[name] = value;
        return request;
      }),
      query,
    };
    const manager = {
      sql: () => ({ Request: class { constructor(_tx: unknown) { return request; } } }),
    };
    const { OperationsRepository } = require("../../../electron/db/repositories/operations.cjs");
    const repository = new OperationsRepository(manager, { tables: [] });

    await expect(repository.assertMemberPermissions(
      {},
      { kind: "update", table: "members", match: { member_code: "M-1" }, values: { loyalty_points: 11 } },
      { enforcePermissions: true, permissions: { can_add_member: true } },
    )).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(inputs.member_match_0).toBe("M-1");
    expect(query.mock.calls[0][0]).toContain("[member_code]=@member_match_0");

    await expect(repository.assertMemberPermissions(
      {},
      { kind: "update", table: "members", match: { member_code: "M-1" }, values: { loyalty_points: 10 } },
      { enforcePermissions: true, permissions: { can_add_member: true } },
    )).resolves.toBeUndefined();
  });

  it.each([1, 100_000])("reads a %i-product catalogue without serializable range locks", async (count) => {
    const transaction = { begin: vi.fn(), commit: vi.fn(), rollback: vi.fn() };
    let offset = 0;
    let limit = 2000;
    let yielded = false;
    const heartbeat = setImmediate(() => { yielded = true; });
    const query = vi.fn(async (_sql: string) => ({ recordset: Array.from(
      { length: Math.max(0, Math.min(limit, count - offset)) },
      (_, index) => ({ id: `P${offset + index + 1}`, deleted_at: null }),
    ) }));
    const request = {
      input: vi.fn((name: string, value: number) => {
        if (name === "offset") offset = value;
        if (name === "limit") limit = value;
        return request;
      }),
      query,
    };
    class Transaction { constructor(_pool: unknown) { return transaction; } }
    class Request { constructor(received: unknown) { expect(received).toBe(transaction); return request; } }
    const manager = {
      pool: {},
      sql: () => ({ Transaction, Request, ISOLATION_LEVEL: { READ_COMMITTED: 2 } }),
    };
    const registry = { tables: [{
      cloudTable: "products",
      sqlServerTable: "products",
      columns: [
        { cloudColumn: "id", sqlServerColumn: "id", primaryKey: true },
        { cloudColumn: "deleted_at", sqlServerColumn: "deleted_at", primaryKey: false },
        { cloudColumn: "owner_store_id", sqlServerColumn: "owner_store_id", primaryKey: false },
      ],
    }] };
    const { OperationsRepository } = require("../../../electron/db/repositories/operations.cjs");
    const repository = new OperationsRepository(manager, registry);

    const rows = await repository.snapshotRows("products", "B1");
    clearImmediate(heartbeat);
    expect(rows).toHaveLength(count);
    expect(rows[0]).toEqual({ id: "P1", deleted_at: null });
    expect(rows.at(-1)?.id).toBe(`P${count}`);
    if (count > 2000) expect(yielded).toBe(true);
    expect(transaction.begin).toHaveBeenCalledWith(2);
    expect(transaction.commit).toHaveBeenCalledOnce();
    expect(transaction.rollback).not.toHaveBeenCalled();
    expect(query.mock.calls[0][0]).toContain("deleted_at IS NULL");
  });

  it("removes permissive settings and terminal command policies", () => {
    const migration = read("supabase/migrations/20260929062541_harden_scoped_settings_sync.sql");
    expect(migration).toContain("settings_scope_visible(scope,scope_id)");
    expect(migration).toContain("DROP POLICY IF EXISTS terminal_commands_staff_read");
    expect(migration).toContain("public.store_visible(store_id)");
    expect(migration).not.toMatch(
      /CREATE POLICY settings_(?:overrides|scoped)_read[\s\S]{0,100}USING \(true\)/,
    );
  });

  it("bounds the change-feed page before hydrating synchronized rows", () => {
    const schema = read("supabase/schema.sql");
    const pull = schema.slice(
      schema.indexOf("CREATE OR REPLACE FUNCTION public.pos_sync_pull"),
      schema.indexOf("CREATE OR REPLACE FUNCTION public.pos_sync_bootstrap"),
    );
    expect(pull).toContain("WITH feed_page AS MATERIALIZED");
    expect(pull).toContain("SECURITY DEFINER SET search_path=public,pg_temp");
    expect(pull.indexOf("LIMIT LEAST(GREATEST(p_limit,100),2000)")).toBeLessThan(
      pull.indexOf("CASE f.table_name"),
    );
    expect(pull).toContain("FROM feed_page f ORDER BY f.cursor");
    expect(pull).toContain(`x."id"=((f.entity_id::jsonb)->>'id')::uuid`);
    expect(pull).toContain(`x."id"=((f.entity_id::jsonb)->>'id')::integer`);
    expect(pull).toContain(`x."key"=((f.entity_id::jsonb)->>'key')`);
    expect(pull).not.toContain(`x."id"::text=(f.entity_id::jsonb)->>'id'`);
  });

  it("allows byte-safe sync pages for unusually large settings and audit rows", () => {
    const migration = read(
      "supabase/migrations/20261006043000_allow_byte_safe_sync_pages.sql",
    );
    const endpoint = read("src/lib/sync-endpoint.server.ts");
    const pullWorker = read("electron/sync/pull-worker.cjs");
    const canonical = read("supabase/schema.sql");
    expect(migration).toContain("LEAST(GREATEST(p_limit,10),2000)");
    expect(migration).toContain("public.pos_sync_pull(text,text,text,bigint,integer)");
    expect(migration).toContain(
      "public.pos_sync_bootstrap(text,text,text,text,text,integer,integer)",
    );
    expect(endpoint).toMatch(/limit:\s*z\.number\(\)\.int\(\)\.min\(10\)/);
    expect(pullWorker).toContain("batchSize = 10");
    expect(canonical.lastIndexOf("LEAST(GREATEST(p_limit,10),2000)")).toBeGreaterThan(
      canonical.lastIndexOf("LEAST(GREATEST(p_limit,100),2000)"),
    );
  });

  it("returns stale authorization edits once instead of triggering PostgreSQL retries", () => {
    const schema = read("supabase/schema.sql");
    const migration = read(
      "supabase/migrations/20260929174500_stop_retrying_application_conflicts.sql",
    );
    for (const sql of [schema, migration]) {
      const legacyRules = sql.slice(
        sql.indexOf("CREATE OR REPLACE FUNCTION public.pos_rules_save"),
        sql.indexOf("REVOKE ALL ON FUNCTION public.pos_rules_save"),
      );
      const authorizationRules = sql.slice(
        sql.indexOf("CREATE OR REPLACE FUNCTION public.authorization_rule_save"),
        sql.indexOf("REVOKE ALL ON FUNCTION public.authorization_rule_save"),
      );
      expect(legacyRules).toContain("ERRCODE = 'PT409'");
      expect(authorizationRules).toContain("ERRCODE='PT409'");
      expect(legacyRules).not.toContain("ERRCODE = '40001'");
      expect(authorizationRules).not.toContain("ERRCODE='40001'");
    }
  });

  it("discards legacy central-setting uploads without weakening scope enforcement", () => {
    const schema = read("supabase/schema.sql");
    const migration = read("supabase/migrations/20260929080650_ignore_central_settings_push.sql");
    const { terminalWritableChanges } = require("../../../electron/sync/push-worker.cjs");
    const changes = [
      { key: { scope: "GLOBAL", scope_id: "" } },
      { entityId: JSON.stringify({ scope: "CLUSTER", scope_id: "C1" }) },
      { key: { scope: "BRANCH", scope_id: "B1" } },
      { key: { scope: "BRANCH", scope_id: "B2" } },
      { key: { scope: "TERMINAL", scope_id: "T1" } },
      { key: { scope: "INVALID", scope_id: "X" } },
    ];
    expect(
      terminalWritableChanges("settings_overrides", changes, { branchId: "B1", terminalId: "T1" }),
    ).toEqual([changes[2], changes[4], changes[5]]);
    expect(terminalWritableChanges("sales", changes)).toEqual(changes);
    expect(schema).toContain(
      "lower(COALESCE(r->>'scope','')) NOT IN ('global','cluster','branch','terminal')",
    );
    expect(schema).toContain("jsonb_agg(r) FILTER (WHERE");
    expect(migration).toContain("SYNC_SCOPE_FORBIDDEN");
    expect(migration).toContain("pos_sync_push_batch");
    expect(migration).toContain("pos_sync_push_aggregate");
    expect(
      read("supabase/migrations/20260929161909_ignore_stale_scoped_settings_push.sql"),
    ).toContain("NOT IN (''global'',''cluster'',''branch'',''terminal'')");
    const deleteMigration = read(
      "supabase/migrations/20260929162248_restrict_terminal_settings_deletes.sql",
    );
    expect(deleteMigration).toContain("sync_delete_settings_overrides");
    expect(deleteMigration).toContain("sync_delete_settings_scoped");
    expect(deleteMigration).not.toContain("lower(x.scope)='global'");
  });
});
