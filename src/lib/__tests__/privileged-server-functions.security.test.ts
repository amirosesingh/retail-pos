import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("privileged server functions", () => {
  it("requires a proven caller before service-role metadata or settings reads", () => {
    for (const path of [
      "src/lib/activity-events.functions.ts",
      "src/lib/central-inventory.functions.ts",
      "src/lib/central-schema.functions.ts",
      "src/lib/idle-timeout.functions.ts",
      "src/lib/store-groups.functions.ts",
    ]) {
      expect(read(path)).toContain("requireCallerScope");
    }
    expect(read("src/lib/staff-admin.functions.ts")).toContain(
      "verifyRelayCaller({ terminalToken: data.terminalToken })",
    );
    const notifications = read("src/lib/activity-events.functions.ts");
    expect(notifications).toContain("ok: false as const");
    expect(notifications).toContain("ok: true as const, settings:");
  });

  it("keeps PIN-only sessions off direct business-table and roster RPC reads", () => {
    expect(read("src/lib/store-groups.ts")).not.toContain('.from("store_groups")');
    const sync = read("src/lib/sync-engine.ts");
    const mirror = sync.slice(
      sync.indexOf("async function refreshStaffMirror"),
      sync.indexOf("const RETRY_DELAYS_MS"),
    );
    expect(mirror).toContain("if (!hasStaffSession()) return");
  });

  it("does not expose PIN verification or scanner ingest to Data API visitors", () => {
    const migration = read(
      "supabase/migrations/20261001023622_restrict_sensitive_security_definers.sql",
    );
    for (const fn of ["verify_cashier_pin", "verify_terminal_pin", "security_report_findings"]) {
      expect(migration).toContain(`REVOKE EXECUTE ON FUNCTION public.${fn}`);
    }
    expect(migration.match(/FROM PUBLIC, anon, authenticated/g)).toHaveLength(3);
    expect(read("src/lib/pos-permissions.tsx")).not.toContain('.rpc("verify_terminal_pin"');
    expect(read("src/lib/pos-permissions.tsx")).toContain(
      'result.manager.role !== "admin" && result.manager.role !== "manager"',
    );
    expect(read("src/routes/api/public/security-alerts.ts")).toContain(
      'serviceRest("rpc/security_report_findings"',
    );
  });

  it("checks database-health permission after resolving the caller's current scope", () => {
    const route = read("src/routes/api/public/health-metadata.ts");
    expect(route).toContain("resolveRelayScope(caller)");
    expect(route).toContain('scope.permissions["can_manage_sync_backup"]');
  });
});
