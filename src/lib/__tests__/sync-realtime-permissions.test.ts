import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260930083000_repair_authenticated_sync_reads.sql",
  "utf8",
);

describe("browser sync database privileges", () => {
  it("restores SELECT under RLS for every direct background read", () => {
    for (const table of [
      "products",
      "members",
      "membership_tiers",
      "promotions",
      "stores",
      "suppliers",
      "bookings",
      "stock_transfers",
      "held_orders",
    ]) {
      expect(migration).toContain(`'${table}'`);
    }
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("GRANT SELECT ON TABLE public.%I TO authenticated");
    expect(migration).not.toMatch(/GRANT\s+SELECT[^;]*\bTO\s+(?:anon|PUBLIC)\b/i);
  });

  it("publishes every table used by postgres_changes listeners", () => {
    for (const table of [
      "staff_roles",
      "stores",
      "members",
      "promotions",
      "app_users",
      "sales",
      "sale_items",
      "payment_transactions",
      "products",
      "purchase_orders",
      "authorization_requests",
      "activity_events",
    ]) {
      expect(migration).toContain(`'${table}'`);
    }
    expect(migration).toContain("ALTER PUBLICATION supabase_realtime ADD TABLE");
    expect(migration).toContain("ALTER TABLE public.%I REPLICA IDENTITY FULL");
  });
});
