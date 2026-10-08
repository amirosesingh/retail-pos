import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import registry from "../../../database/sqlserver/schema-registry.json";

const root = join(import.meta.dirname, "../../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("coupon and voucher boundaries", () => {
  it("replicates issued vouchers organization-wide even before redemption", () => {
    const voucher = registry.tables.find((table) => table.cloudTable === "issued_vouchers");
    expect(voucher?.scope).toBe("organization");

    const generator = read("scripts/generate-supabase-sync-contract.cjs");
    expect(generator).toContain('const ORGANIZATION_WIDE = new Set(["issued_vouchers"])');
    expect(generator).toContain("SYNC_VOUCHER_TRANSITION_FORBIDDEN");
    expect(generator).toContain("SELECT 'global'::text branch_id,NULL::text terminal_id");

    const migration = read(
      "supabase/migrations/20261008113000_harden_coupon_sync_and_redemption.sql",
    );
    expect(migration).toContain("'default','global',NULL,'issued_vouchers'");
    expect(migration).toContain("FROM public.issued_vouchers x");
    expect(migration).not.toContain(
      "FROM public.issued_vouchers x WHERE x.store_id::text=p_branch_id",
    );
    const transitions = read(
      "supabase/migrations/20261008114500_restrict_offline_voucher_transitions.sql",
    );
    expect(transitions).toContain("SYNC_VOUCHER_TRANSITION_FORBIDDEN");
    expect(transitions).toContain("v_existing.status='REDEEMED'");
    expect(transitions).toContain("CREATE OR REPLACE FUNCTION public.sync_delete_issued_vouchers");
    expect(transitions).toContain("RETURN 0;");
  });

  it("permission-gates campaign management at the relay and database", () => {
    const relay = read("src/core/api/relay-policy.server.ts");
    expect(relay).toContain('coupon_campaigns: { write: "can_manage_promotions"');

    const migration = read(
      "supabase/migrations/20261008113000_harden_coupon_sync_and_redemption.sql",
    );
    expect(migration).toContain("public.has_perm('can_manage_promotions')");
    expect(migration).toContain("PERMISSION_DENIED_PROMOTIONS");
    expect(migration).toContain("VOUCHER_BRANCH_FORBIDDEN");
  });

  it("rejects unavailable campaigns and vouchers before discounting a ticket", () => {
    const register = read("src/lib/register/use-promotions.ts");
    expect(register).toContain("isLive(p)");
    expect(register).toContain('view.voucher.status === "DISABLED"');
    expect(register).toContain("isVoucherExpired(view.voucher, campaign)");
    expect(register).toContain(
      'status === "Scheduled" || status === "Off" || status === "Expired"',
    );
  });
});
