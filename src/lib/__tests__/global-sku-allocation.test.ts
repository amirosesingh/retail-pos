import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8").replaceAll("\r\n", "\n");

describe("global SKU allocation", () => {
  const migration = read(
    "supabase/migrations/20261002114036_global_sku_allocator_and_notification_retention.sql",
  );

  it("serializes one never-reused sequence across every cluster", () => {
    expect(migration).toContain("from public.sku_number_state state");
    expect(migration).toContain("for update;");
    expect(migration).toContain("v_end := v_start + p_count - 1");
    expect(migration).toContain("next_value = v_end + 1");
    expect(migration).not.toMatch(/group_id|cluster_id/);
  });

  it("keeps lease tables private and validates the active staff scope", () => {
    expect(migration).toContain("alter table public.sku_number_leases enable row level security");
    expect(migration).toContain(
      "revoke all on table public.sku_number_leases from public, anon, authenticated",
    );
    expect(migration).toContain("where auth_user_id = (select auth.uid())");
    expect(migration).toContain("SKU_STORE_SCOPE_FORBIDDEN");
    expect(migration).toContain("to authenticated, service_role");
  });

  it("uses durable local leases instead of an unsafe terminal-only counter", () => {
    const sku = read("src/lib/sku.ts");
    const relay = read("src/lib/sku.functions.ts");
    expect(sku).toContain('const LEASE_KEY = "pos.sku.global-lease.v1"');
    expect(sku).toContain("reserveSkuLease");
    expect(sku).toContain("getPosCallerAuth");
    expect(sku).not.toContain('supabaseExternal.rpc("reserve_product_skus"');
    expect(relay).toContain('permission: "can_add_new_product"');
    expect(relay).toContain('serviceRpc("reserve_product_skus"');
    expect(relay).toContain("requestedStore !== scope.storeId");
    expect(sku).toContain('supabaseConfig("pos").url');
    expect(sku).toContain('locks.request("pos-global-sku-lease", run)');
    expect(sku).toContain("No globally reserved SKU numbers are available offline");
    expect(sku).toContain("while (allocated <= lease.end && used.has(formatSku(s, allocated)))");
    expect(sku).not.toContain("const n = Math.max(s.next, highestUsed(existing, s.prefix) + 1)");
  });

  it("advances the global sequence when trusted sync imports an explicit numeric SKU", () => {
    expect(migration).toContain("v_explicit_number := nullif(substring(new.sku from '([0-9]+)$'), '')::bigint");
    expect(migration).toContain(
      "next_value = greatest(public.sku_number_state.next_value, excluded.next_value)",
    );
  });
});
