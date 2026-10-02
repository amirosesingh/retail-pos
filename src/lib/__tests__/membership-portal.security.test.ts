import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { internationalPhone, PHONE_COUNTRIES } from "../phone-countries";

const read = (path: string) => readFileSync(path, "utf8").replaceAll("\r\n", "\n");

describe("customer membership portal security", () => {
  it("isolates member authentication from the staff Supabase session", () => {
    const client = read("src/integrations/supabase/external-client.ts");
    expect(client).toContain('const MEMBER_STORAGE_KEY = "sb-member-portal-auth-token"');
    expect(client).toContain(
      "createExternalClient(MEMBER_STORAGE_KEY, MEMBER_PROJECT_MARK_KEY, false, false)",
    );
    expect(client).toContain("storage: persistSession &&");
    expect(client).toContain("const { url, key } = supabaseConfig()");
  });

  it("binds portal reads and edits to verified auth ownership", () => {
    const sql = read("supabase/migrations/20261002093000_secure_member_portal.sql");
    expect(sql).toContain("auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL");
    expect(sql).toContain("members_auth_user_id_uidx");
    expect(sql).toContain("m.auth_user_id = (SELECT auth.uid())");
    expect(sql).toContain("WHERE auth_user_id = v_uid AND deleted_at IS NULL FOR UPDATE");
    expect(sql).toContain("MEMBERSHIP_CONTACT_AMBIGUOUS");
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public.membership_portal_claim() FROM PUBLIC, anon, authenticated",
    );
    expect(sql).not.toContain(
      "GRANT EXECUTE ON FUNCTION public.membership_portal_claim() TO authenticated",
    );
  });

  it("does not let customer auth users read staff OTP verification state", () => {
    const sql = read("supabase/migrations/20261002093000_secure_member_portal.sql");
    expect(sql.match(/\(SELECT public\.is_staff_now\(\)\)/g)).toHaveLength(4);
    expect(sql).not.toMatch(/member_verifications_staff_[\s\S]{0,180}USING \(true\)/);
  });

  it("normalizes a local phone number with its selected calling code", () => {
    const brunei = PHONE_COUNTRIES.find((country) => country.code === "BN");
    expect(brunei).toBeDefined();
    expect(internationalPhone(brunei!, "0812 3456")).toBe("+6738123456");
  });

  it("adds optional profile details without rewriting existing members", () => {
    const sql = read("supabase/migrations/20261002163000_member_profile_details.sql");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS country_code text");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS postal_code text");
    expect(sql).toContain("membership_portal_enroll_details(p_profile jsonb)");
    expect(sql).toContain("auth_user_id = (SELECT auth.uid())");
    expect(sql).toContain("TO authenticated, service_role");
    expect(sql).not.toMatch(/\b(?:DELETE|TRUNCATE|DROP\s+TABLE)\b/i);
  });

  it("supports multiple email-only members and keeps barcode writes staff-only", () => {
    const sql = read("supabase/migrations/20261002170000_harden_member_and_barcode_edges.sql");
    expect(sql).toContain("members_phone_nonblank_uidx");
    expect(sql).toContain("nullif(btrim(phone), '') IS NOT NULL");
    expect(sql).toContain("USING ((SELECT public.is_staff_now()))");
    expect(sql).toContain("WITH CHECK ((SELECT public.is_staff_now()))");
  });
});
