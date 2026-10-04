import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { internationalPhone, PHONE_COUNTRIES } from "../phone-countries";

const read = (path: string) => readFileSync(path, "utf8").replaceAll("\r\n", "\n");

describe("customer membership portal security", () => {
  it("isolates member authentication from the staff Supabase session", () => {
    const client = read("src/integrations/supabase/external-client.ts");
    expect(client).toContain('const MEMBER_STORAGE_KEY = "sb-member-portal-auth-token"');
    expect(client).toContain('"membership"');
    expect(client).toContain("storage: persistSession &&");
    expect(client).toContain("const { url, key } = supabaseConfig(configScope)");
    expect(client).toContain('configScope: "pos" | "membership" = "pos"');
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

  it("keeps membership lookup private while SQL Server owns POS activity", () => {
    const membershipSql = read(
      "supabase/membership/migrations/20261002183000_isolated_membership_project.sql",
    );
    const lookupSql = read(
      "supabase/membership/migrations/20261002183500_membership_lookup_scaling.sql",
    );
    const consistencySql = read(
      "supabase/membership/migrations/20261002184000_membership_event_consistency.sql",
    );
    const phoneNumberSql = read(
      "supabase/membership/migrations/20261002184200_phone_membership_number.sql",
    );
    const emailOtpSql = read(
      "supabase/membership/migrations/20261002201500_email_otp_phone_membership.sql",
    );
    const service = read("src/lib/membership-service.server.ts");
    const mirrorIdentitySql = read(
      "supabase/migrations/20261003183000_harden_membership_directory_identity.sql",
    );
    const commitOrderedSql = read(
      "supabase/membership/migrations/20261003200000_commit_ordered_member_directory.sql",
    );
    const posDb = read("src/core/api/pos-db.ts");
    const client = read("src/lib/membership-service.functions.ts");
    const register = read("src/routes/index.tsx");
    const memberEditor = read("src/routes/members.tsx");
    const checkout = read("src/lib/register/use-checkout.ts");

    expect(membershipSql).toContain("event_id text primary key");
    expect(membershipSql).toContain("MEMBERSHIP_SERVICE_REQUIRED");
    expect(lookupSql).toContain("v_phone <> ''");
    expect(lookupSql).toContain("members_name_prefix_idx");
    expect(consistencySql).toContain("round(coalesce((p_event->>'amount_delta')::numeric, 0), 2)");
    expect(phoneNumberSql).toContain("MEMBERSHIP_PHONE_VERIFICATION_REQUIRED");
    expect(phoneNumberSql).toContain("v_uid, v_phone, v_name");
    expect(emailOtpSql).toContain("u.email_confirmed_at is not null");
    expect(emailOtpSql).toContain("v_uid, v_phone, v_name, v_email, v_phone");
    expect(emailOtpSql).toContain("true, now(), 'email'");
    expect(emailOtpSql).not.toMatch(
      /(?:otp|token|verification)_?(?:code|hash)\s+(?:text|varchar)/i,
    );
    expect(service).toContain("AbortSignal.timeout(8_000)");
    expect(service).toContain("phone: row.member_code");
    expect(service).toContain("await verifyCaller(parsed.data)");
    expect(service).toContain('serviceRpc("membership_directory_delta"');
    expect(service).toContain('serviceRest("rpc/membership_directory_apply"');
    expect(client).toContain('posFetch("/api/v1/pos/sync?operation=membership_lookup"');
    expect(client).not.toContain("MEMBERSHIP_SUPABASE_SERVICE_ROLE_KEY");
    expect(register).toContain("void upsertMember(cached)");
    expect(memberEditor).toContain("Email and date of birth are verified profile details");
    expect(memberEditor.match(/aria-readonly="true"/g)).toHaveLength(2);
    expect(checkout).not.toContain("postMembershipSale");
    expect(service).not.toContain("membership_event_outbox");
    expect(mirrorIdentitySql).toContain("member.membership_member_id = source.id");
    expect(mirrorIdentitySql).toContain("member.phone = source.phone");
    expect(mirrorIdentitySql).toContain("and member.membership_member_id is null");
    expect(mirrorIdentitySql).toContain("when member.membership_member_id = source.id then 0");
    expect(mirrorIdentitySql).toMatch(
      /get diagnostics v_affected = row_count;\s+if v_affected > 0 then\s+update public\.members\s+set membership_member_id = null/,
    );
    expect(mirrorIdentitySql).toContain("pg_advisory_xact_lock");
    expect(mirrorIdentitySql).not.toMatch(/delete\s+from\s+public\.members/i);
    expect(commitOrderedSql).toContain("lock table public.members in access exclusive mode");
    expect(commitOrderedSql).toContain("pg_advisory_xact_lock");
    expect(commitOrderedSql).toContain(
      "m.directory_revision > greatest(coalesce(p_after_revision, 0), 0)",
    );
    expect(commitOrderedSql).not.toContain("overlap");
    expect(service).toContain("rows.length === pageSize && nextRevision > cursorRevision");
    const memberWriter = posDb.slice(
      posDb.indexOf("const memberToRow"),
      posDb.indexOf("const rowToPromotion"),
    );
    expect(memberWriter).not.toContain("membership_revision:");
    expect(memberWriter).not.toContain("membership_member_id:");
    expect(memberWriter).not.toContain("membership_status:");
  });

  it("embeds the configured company gateway in phone-issued terminal QR codes", () => {
    const activation = read("src/core/activation/terminal-tokens.ts");
    expect(activation).toContain("const configured = serverOrigin()");
    expect(activation).toContain("backendUrl: activationBackendUrl()");
    expect(activation).not.toContain("backendUrl: typeof window !==");
  });

  it("delivers both public project profiles only after proof-bound pairing", () => {
    const endpoint = read("src/routes/api/public/terminal-pairing.ts");
    const activation = read("src/core/activation/terminal-tokens.ts");
    expect(endpoint).toContain('publicSupabaseConfig("membership")');
    expect(endpoint).toContain("membershipSupabaseUrl: membership?.url");
    expect(endpoint).toContain("membershipSupabaseKey: membership?.key");
    expect(activation).toContain("membershipSupabaseUrl: approval.membershipSupabaseUrl");
    expect(activation).toContain("membershipSupabaseKey: approval.membershipSupabaseKey");
    expect(activation).not.toContain("MEMBERSHIP_SUPABASE_SERVICE_ROLE_KEY");
  });

  it("documents membership hosting configuration without accepting a service key in the client", () => {
    const panel = read("src/platforms/web/components/pos/settings/panels/CloudConnectionPanel.tsx");
    const join = read("src/routes/join.tsx");
    const membership = read("src/routes/membership.tsx");

    expect(panel).toContain('publicSupabaseConfig("membership")');
    expect(panel).toContain("MEMBERSHIP_SUPABASE_URL");
    expect(panel).toContain("MEMBERSHIP_SUPABASE_PUBLISHABLE_KEY");
    expect(panel).not.toContain("MEMBERSHIP_SUPABASE_SERVICE_ROLE_KEY");
    expect(panel).toContain("encrypted hosting");
    expect(panel).not.toMatch(/setMembership|membershipServiceKey|membership-service-key/i);
    expect(panel).not.toContain("Membership user");
    expect(panel).not.toContain("Project ID");
    expect(join).not.toContain("Already a member?");
    expect(join).not.toContain("Sign in with OTP");
    expect(join).not.toContain('label="Country"');
    expect(membership).toContain('redirect({ to: "/join", replace: true })');
    expect(membership).not.toContain("MemberLogin");
  });

  it("persists the submitted phone when email OTP claims an existing member", () => {
    const completion = read(
      "supabase/membership/migrations/20261004223000_complete_claimed_member_enrollment.sql",
    );

    expect(completion).toContain("v_member_id := public.membership_claim()");
    expect(completion).toContain("member_code = v_phone");
    expect(completion).toContain("phone = v_phone");
    expect(completion).toContain("where id = v_member_id and auth_user_id = v_uid");
    expect(completion).toContain("MEMBERSHIP_PHONE_ALREADY_REGISTERED");
  });
});
