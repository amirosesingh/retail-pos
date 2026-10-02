import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("administrator corrections and shared table controls", () => {
  it("rejects posted-record correction writes unless the verified role is admin", () => {
    const server = read("src/lib/record-edits.functions.ts");
    const flow = read("src/lib/record-edit-flow.ts");
    expect(server).toContain('who.role.trim().toLowerCase() !== "admin"');
    expect(server).toContain("verifyRelayCaller");
    expect(server).toContain("resolveRelayScope");
    expect(server).toContain("scope.roleSlug || scope.role");
    expect(server.match(/requireAdmin\(who\)/g)?.length).toBeGreaterThanOrEqual(4);
    expect(server).toContain('error: "A branch scope is required"');
    expect(flow).toContain('identity.role.trim().toLowerCase() !== "admin"');
    expect(flow).not.toContain("Sent for approval");
  });

  it("keeps shift correction behind server-verified admin and branch checks", () => {
    const source = read("src/lib/shift-corrections.functions.ts");
    expect(source).toContain("verifyRelayCaller");
    expect(source).toContain("resolveRelayScope");
    expect(source).toContain('scope.roleSlug === "admin" || scope.role === "admin"');
    expect(source).toContain("select=store_id&limit=1");
    expect(source).toContain("scope.storeId && scope.storeId !== shiftStoreId");
    expect(source).toContain('serviceRest("rpc/pos_admin_correct_closed_shift"');
    const route = read("src/routes/shifts.tsx");
    expect(route).toContain("correctionClientKey.current = crypto.randomUUID()");
    expect(route).toContain("clientKey: correctionClientKey.current");
    const migration = read(
      "supabase/migrations/20261002023000_admin_only_posted_record_corrections.sql",
    );
    expect(migration.indexOf("FOR UPDATE")).toBeLessThan(
      migration.indexOf("WHERE client_key = p_client_key"),
    );
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("v_existing_cash IS DISTINCT FROM p_cash");
  });

  it("provides sort, per-column filter and resize controls on shared table headers", () => {
    const source = read("src/components/ui/table.tsx");
    expect(source).toContain('Sort ${direction === "asc" ? "descending" : "ascending"}');
    expect(source).toContain("Filter ${label} values");
    expect(source).toContain("Resize ${label} column");
    expect(source).toContain('event.key !== "ArrowLeft" && event.key !== "ArrowRight"');
    expect(source).toContain('window.addEventListener("pointermove", move)');
    expect(source).toContain('window.addEventListener("pointercancel", stop)');
    expect(source).toContain("resizeCleanupRef.current?.()");
    expect(source).not.toContain("function decorateTableHeaders(");
    expect(source).toContain("sortTableBodies(child, sort)");
    expect(source).toContain("filterTableBodies(child, filters)");
    expect(source).toContain("clientDataControls");
    expect(read("src/routes/audit.tsx")).toContain("<Table clientDataControls={false}>");
  });

  it("deploys the post-review database integrity follow-up", () => {
    const migration = read("supabase/migrations/20261002053711_close_review_integrity_gaps.sql");
    expect(migration).toContain("variant_code, unit_price");
    expect(migration).toContain("v_existing_cash IS DISTINCT FROM p_cash");
    expect(migration).toContain("AND NOT stock_state.has_stock");
    expect(migration).toContain("TO service_role");
  });

  it("deploys the final null-state and manual-archive safeguards", () => {
    const migration = read("supabase/migrations/20261002061927_close_coderabbit_review_edges.sql");
    expect(migration).toContain("v.status IS DISTINCT FROM 'CLOSED'");
    expect(migration).toContain("NEW.is_archived := COALESCE(NEW.is_archived, false)");
    expect(migration).toContain("WHEN NEW.is_archived THEN COALESCE(NEW.archived_at, now())");
    expect(migration).not.toMatch(/\b(UPDATE|DELETE)\s+public\.products\b/i);
  });

  it("uses net company stock for the zero-stock catalogue lifecycle", () => {
    const migration = read(
      "supabase/migrations/20261002062526_use_net_stock_for_catalog_lifecycle.sql",
    );
    expect(migration).toContain("has_stock := net_stock > 0");
    expect(migration).toContain("had_stock := old_net_stock > 0");
    expect(migration).toContain("AND s.quantity <= 0");
    expect(migration).toContain("AND p.is_archived IS NOT TRUE");
    expect(migration).toContain("lifecycle_setting");
    expect(migration).toContain("COALESCE((SELECT enabled FROM lifecycle_setting), true)");
  });

  it("aligns setting-toggle backfills with net stock", () => {
    const migration = read("supabase/migrations/20261002063556_align_net_stock_backfill.sql");
    expect(migration).toContain("FUNCTION public.backfill_zero_stock_catalog_lifecycle()");
    expect(migration).toContain("COALESCE(sum(e.value::numeric) FILTER");
    expect(migration).toContain(") > 0 AS has_stock");
  });
});
