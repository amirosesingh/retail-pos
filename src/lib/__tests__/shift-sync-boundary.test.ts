import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("shift sync boundaries", () => {
  it("sends protected shift writes and summaries through the existing relay", () => {
    const engine = read("src/lib/sync-engine.ts");
    expect(engine).toContain('op.table === "shifts"');
    expect(engine).toContain('op.table === "shift_notifications"');

    const policy = read("src/core/api/relay-policy.server.ts");
    expect(policy).toContain('shift_notifications: "store_id"');
    expect(policy).toMatch(/appendOnlyTables[\s\S]*"shift_notifications"/);

    const relay = read("src/core/api/pos-relay.server.ts");
    expect(relay).toMatch(/RELAY_TABLES[\s\S]*"shift_notifications"/);
    expect(relay).toMatch(/RELAY_CONFLICT_KEYS[\s\S]*shift_notifications: "shift_id"/);
  });

  it("installs a branch-scoped, RLS-protected central summary table", () => {
    const sql = read("supabase/schema.sql");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.shift_notifications");
    expect(sql).toContain("CONSTRAINT shift_notifications_shift_key UNIQUE (shift_id)");
    expect(sql).toContain("ALTER TABLE public.shift_notifications ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain('CREATE POLICY "Branch staff publish shift summaries"');
    expect(sql).toContain('CREATE POLICY "Variance viewers read shift summaries"');
    expect(sql).toContain("public.has_perm('can_shift_variance_view')");
    expect(sql).toContain("public.store_visible(store_id)");
  });

  it("publishes idempotently through the relay instead of the missing REST table", () => {
    const alerts = read("src/lib/shift-alerts.ts");
    expect(alerts).toContain('table: "shift_notifications"');
    expect(alerts).toContain('onConflict: "shift_id"');
    expect(alerts).not.toContain("notifications().insert(");
  });
});
