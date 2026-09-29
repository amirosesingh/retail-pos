import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8").replaceAll("\r\n", "\n");
const require = createRequire(import.meta.url);

describe("scoped SQL Server synchronization", () => {
  it("uses revisions so a stale desktop setting cannot overwrite a newer server row", () => {
    const schema = read("supabase/schema.sql");
    expect(schema).toMatch(/settings_overrides[\s\S]*row_version integer DEFAULT 1 NOT NULL/);
    expect(schema).toMatch(/settings_scoped[\s\S]*row_version integer NOT NULL DEFAULT 1/);
    expect(schema).toContain("NEW.row_version := GREATEST");
    expect(schema).toMatch(/sync_apply_settings_overrides[\s\S]*WHERE EXCLUDED\."row_version">public\."settings_overrides"\."row_version"/);
    expect(schema).toMatch(/sync_apply_settings_scoped[\s\S]*WHERE EXCLUDED\."row_version">public\."settings_scoped"\."row_version"/);
  });

  it("routes mixed settings and authorization scopes without organization-wide operational downloads", () => {
    const schema = read("supabase/schema.sql");
    expect(schema).toContain("lower(x.scope)='branch' AND x.scope_id::text=p_branch_id");
    expect(schema).toContain("lower(x.scope)='terminal' AND x.scope_id::text=p_terminal_id");
    expect(schema).toContain("lower(x.scope_type)='cluster'");
    expect(schema).toContain("terminal_id text");
    expect(schema).toContain("f.terminal_id IS NULL OR f.terminal_id=p_terminal_id");
    expect(schema).toContain("NULLIF(x.owner_store_id::text,'') IS NULL OR x.owner_store_id::text=p_branch_id");
    expect(schema).toContain("SYNC_PRODUCT_SCOPE_FORBIDDEN");
  });

  it("binds the relay and Electron manual sync to verified device identity", () => {
    const endpoint = read("src/lib/sync-endpoint.server.ts");
    const relay = read("src/core/api/pos-relay.server.ts");
    const main = read("electron/main.cjs");
    expect(endpoint).toContain('p_terminal_id:scope.terminalId ?? ""');
    expect(relay).toContain("terminalId = input.terminalToken");
    expect(main).toContain("const branchId=localBranchId()");
    expect(main).not.toContain("branchId:input.branchId??localBranchId()");
    expect(read("supabase/schema.sql")).toContain("SYNC_TERMINAL_SCOPE_FORBIDDEN");
  });

  it("uses branch-filtered realtime only as a durable-sync wake-up hint", () => {
    const engine = read("src/lib/sync-engine.ts");
    const activity = read("src/lib/activity-events.ts");
    const approvals = read("src/lib/approval-centre.ts");
    expect(engine).toContain("filter: `${column}=eq.${liveBranchId}`");
    expect(engine).not.toMatch(/LIVE_SETTINGS_TABLES[\s\S]{0,500}\.\.\.LIVE_SETTINGS_TABLES/);
    expect(activity).toContain("filter: `store_id=eq.${branchId}`");
    expect(approvals).toContain("filter: `store_id=eq.${branchId}`");
  });

  it("keeps master/configuration and stock-request transition history append-only", () => {
    const migration = read("supabase/migrations/20260929080000_change_history_stock_request_lifecycle.sql");
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
    expect(unpair.indexOf("await revokeTerminalToken")).toBeLessThan(unpair.indexOf("await unpairTerminal"));
  });

  it("filters the local product snapshot and applies scoped price records", () => {
    const operations = read("electron/db/repositories/operations.cjs");
    const inventory = read("src/routes/inventory.tsx");
    const store = read("src/lib/pos-store.tsx");
    expect(operations).toContain("NULLIF(owner_store_id,N'') IS NULL OR owner_store_id=@branch");
    expect(operations).toContain("product_price:%");
    expect(operations).toContain("global: 0, cluster: 1, branch: 2, terminal: 3");
    expect(inventory).toContain("Use these prices only at {currentStore.name}");
    expect(inventory).toContain("upsertProductPriceOverride(draft.id, draft.price, draft.ecomPrice)");
    expect(store).toContain("db.commitProductPriceOverride");
  });

  it("rejects generic local writes aimed at another branch or a central settings scope", () => {
    const { OperationsRepository } = require("../../../electron/db/repositories/operations.cjs");
    const columns = (names: string[]) => names.map((name) => ({ cloudColumn: name, sqlServerColumn: name }));
    const repository = new OperationsRepository({}, { tables: [
      { cloudTable: "sales", sqlServerTable: "sales", columns: columns(["id", "store_id"]) },
      { cloudTable: "settings_overrides", sqlServerTable: "settings_overrides", columns: columns(["scope", "scope_id", "section"]) },
      { cloudTable: "stock_transfers", sqlServerTable: "stock_transfers", columns: columns(["id", "from_store_id", "to_store_id"]) },
    ] });
    expect(() => repository.assertWriteScope([
      { kind: "insert", table: "sales", rows: [{ id: "1", store_id: "B" }] },
    ], { branchId: "A", terminalId: "T" })).toThrow(/terminal's branch/);
    expect(() => repository.assertWriteScope([
      { kind: "upsert", table: "settings_overrides", rows: [{ scope: "GLOBAL", scope_id: "", section: "tax" }] },
    ], { branchId: "A", terminalId: "T" })).toThrow(/own branch or terminal settings/);
    expect(() => repository.assertWriteScope([
      { kind: "insert", table: "stock_transfers", rows: [{ id: "1", from_store_id: "B", to_store_id: "C" }] },
    ], { branchId: "A", terminalId: "T" })).toThrow(/must involve/);
    expect(() => repository.assertWriteScope([
      { kind: "insert", table: "sales", rows: [{ id: "1", store_id: "A" }] },
      { kind: "update", table: "settings_overrides", match: { scope: "TERMINAL", scope_id: "T", section: "tax" }, values: { section: "tax" } },
    ], { branchId: "A", terminalId: "T" })).not.toThrow();
  });

  it("removes permissive settings and terminal command policies", () => {
    const migration = read("supabase/migrations/20260929062541_harden_scoped_settings_sync.sql");
    expect(migration).toContain("settings_scope_visible(scope,scope_id)");
    expect(migration).toContain("DROP POLICY IF EXISTS terminal_commands_staff_read");
    expect(migration).toContain("public.store_visible(store_id)");
    expect(migration).not.toMatch(/CREATE POLICY settings_(?:overrides|scoped)_read[\s\S]{0,100}USING \(true\)/);
  });
});
