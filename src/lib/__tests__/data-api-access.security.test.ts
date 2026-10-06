import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync("supabase/schema.sql", "utf8");
const finalHardening = schema.slice(schema.lastIndexOf("-- Close anonymous table access"));
const systemHealth = readFileSync("src/lib/system-health.ts", "utf8");
const dbHealth = readFileSync("src/lib/db-health.ts", "utf8");
const featureSchema = readFileSync("src/core/types/feature-schema.ts", "utf8");
const posDb = readFileSync("src/core/api/pos-db.ts", "utf8");

describe("anonymous Data API access", () => {
  it("revokes table and sequence privileges before granting two public read surfaces", () => {
    expect(finalHardening).toContain(
      "REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon",
    );
    expect(finalHardening).toContain(
      "REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon",
    );
    expect(finalHardening).toContain("GRANT SELECT ON TABLE public.public_flags TO anon");
    expect(finalHardening).toContain("GRANT SELECT ON TABLE public.coupon_campaigns TO anon");
    expect(finalHardening).not.toMatch(/GRANT (?:ALL|INSERT|UPDATE|DELETE).* TO anon/i);
  });

  it("removes every legacy allow-all business-table policy", () => {
    for (const table of [
      "audit_logs",
      "members",
      "membership_tiers",
      "pos_settings",
      "products",
      "promotions",
      "purchase_order_items",
      "purchase_orders",
    ]) {
      expect(finalHardening).toContain(`DROP POLICY IF EXISTS "Public access" ON public.${table}`);
    }
  });

  it("keeps voucher rows private and settings readable only after sign-in", () => {
    expect(finalHardening).toContain(
      'DROP POLICY IF EXISTS "vouchers readable" ON public.issued_vouchers',
    );
    expect(finalHardening).toMatch(
      /CREATE POLICY "settings_locks_read"[\s\S]*FOR SELECT TO authenticated USING \(true\)/,
    );
    expect(finalHardening).toMatch(
      /CREATE POLICY "settings_overrides_read"[\s\S]*FOR SELECT TO authenticated USING \(true\)/,
    );
  });

  it("uses the anonymous-safe health surface and avoids protected probes on PIN-only tills", () => {
    expect(systemHealth).toContain('.from("public_flags")');
    expect(systemHealth).not.toContain('.from("pos_settings")');
    expect(dbHealth).toContain("if (session)");
    expect(featureSchema).toContain("if (!directAccess)");
    expect(posDb).toContain("if (localDb() && !hasStaffSession())");
    expect(posDb).toContain('throw new Error("No verified cloud staff session is active.")');
  });

  it("finishes every fresh install with authenticated core access and a PostgREST reload", () => {
    const repair = schema.slice(schema.lastIndexOf("-- Final Data API authorization repair"));

    expect(repair).toContain("GRANT USAGE ON SCHEMA public TO authenticated, service_role");
    expect(repair).toContain("public.settings_locks");
    expect(repair).toContain("public.stores");
    expect(repair).toContain("public.user_roles");
    expect(repair).toContain("TO authenticated");
    expect(schema).toContain(
      "CREATE POLICY audit_logs_staff_update ON public.audit_logs FOR UPDATE TO authenticated",
    );
    expect(repair).toContain(
      "GRANT SELECT, INSERT, UPDATE ON TABLE public.audit_logs TO authenticated",
    );
    expect(repair).toContain("REVOKE DELETE ON TABLE public.audit_logs FROM authenticated");
    expect(repair).toContain(
      "REVOKE ALL ON FUNCTION public.current_app_user() FROM PUBLIC, anon",
    );
    expect(repair).toContain(
      "GRANT EXECUTE ON FUNCTION public.current_app_user() TO authenticated, service_role",
    );
    expect(repair).toContain("NOTIFY pgrst, 'reload schema'");
    expect(repair).not.toMatch(/GRANT (?:ALL|INSERT|UPDATE|DELETE).* TO anon/i);
  });
});
