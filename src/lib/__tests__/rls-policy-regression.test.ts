/**
 * Guards the access rules that Part 4 tightened.
 *
 * Each of these rule names was a wide-open duplicate (`USING true`) that
 * cancelled the stricter staff/branch rule beside it. The last word about
 * each remaining legacy name in the migration history must be a removal.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const schema = readFileSync(join(process.cwd(), "supabase", "schema.sql"), "utf8");

const REMOVED = [
  "branch_telemetry_staff_read",
  "branch_telemetry_staff_write",
  "branch_telemetry_staff_update",
  "payment_types_staff_read",
  "payment_types_staff_write",
];

describe("row-rule regression", () => {
  it.each(REMOVED)("%s stays removed", (name) => {
    const line = schema
      .split("\n")
      .filter((entry) => entry.includes(name))
      .pop()!;
    expect(line, `${name} not found in the canonical schema`).toBeTruthy();
    expect(line.toUpperCase()).toContain("DROP POLICY");
  });

  it("keeps audit-log access behind the canonical staff gate", () => {
    const tail = schema.slice(schema.lastIndexOf("CREATE POLICY audit_logs_staff_insert"));
    expect(tail).toContain("CREATE POLICY audit_logs_staff_insert");
    expect(tail).toContain("CREATE POLICY audit_logs_staff_read");
    expect(tail.match(/\(SELECT public\.is_staff_now\(\)\)/gi)).toHaveLength(2);
    expect(tail).not.toMatch(/(?:USING|WITH CHECK)\s*\(\s*true\s*\)/i);
  });

  it("telemetry is branch-scoped on read, insert and update", () => {
    const sql = schema;
    const tail = sql.slice(sql.lastIndexOf("Telemetry visible in own branch"));
    expect(tail).toContain("user_has_store_access(store_id)");
    expect(sql).toContain("Telemetry reported for own branch");
    expect(sql).toContain("Telemetry refreshed for own branch");
  });

  it("PIN tables are unreachable from the data API", () => {
    const sql = schema;
    expect(sql).toContain("REVOKE ALL ON public.pin_attempts FROM anon, authenticated");
    expect(sql).toContain("REVOKE ALL ON public.cashiers FROM anon, authenticated");
    expect(sql).not.toMatch(/GRANT[^;]*ON public\.(pin_attempts|cashiers) TO (anon|authenticated)/);
  });

  it("keeps approval decisions server-owned while allowing signed-in reads", () => {
    for (const table of ["authorization_actions", "authorization_requests", "authorization_log"]) {
      expect(schema).toContain(`REVOKE ALL ON public.${table} FROM anon, authenticated`);
      expect(schema).toContain(`GRANT SELECT ON public.${table} TO authenticated`);
      expect(schema).not.toContain(`GRANT ALL ON public.${table} TO authenticated`);
    }
  });
});
