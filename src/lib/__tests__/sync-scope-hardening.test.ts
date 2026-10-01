import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8").replaceAll("\r\n", "\n");
const require = createRequire(import.meta.url);

describe("scoped SQL Server synchronization", () => {
  it("uses revisions so a stale desktop setting cannot overwrite a newer server row", () => {
    const schema = read("supabase/schema.sql");
    expect(schema).toMatch(/settings_overrides[\s\S]*row_version integer DEFAULT 1 NOT NULL/);
    expect(schema).toMatch(/settings_scoped[\s\S]*row_version integer NOT NULL DEFAULT 1/);
    expect(schema).toContain("NEW.row_version := GREATEST");
    expect(schema).toMatch(
      /sync_apply_settings_overrides[\s\S]*WHERE EXCLUDED\."row_version">public\."settings_overrides"\."row_version"/,
    );
    expect(schema).toMatch(
      /sync_apply_settings_scoped[\s\S]*WHERE EXCLUDED\."row_version">public\."settings_scoped"\."row_version"/,
    );
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
