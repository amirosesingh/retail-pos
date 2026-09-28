import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (file: string) => readFileSync(file, "utf8");

describe("atomic central sale contract", () => {
  it("commits the financial graph and stock deltas inside one database function", () => {
    const migration = read("supabase/schema.sql");
    const hotfix = read("supabase/migrations/20260925105427_fix_pos_sale_commit_stock_alias.sql");
    const idempotency = read(
      "supabase/migrations/20260925105919_persist_pos_sale_payment_idempotency.sql",
    );
    const memberOrder = read(
      "supabase/migrations/20260925130000_fix_sale_member_dependency_order.sql",
    );
    expect(migration).toContain("FUNCTION public.pos_sale_commit");
    expect(migration).toContain("INSERT INTO public.sales");
    expect(migration).toContain("INSERT INTO public.sale_items");
    expect(migration).toContain("INSERT INTO public.payment_transactions");
    expect(migration).toContain("id, client_transaction_id, source_type, sale_id");
    expect(migration).toContain("INSERT INTO public.item_activity_logs");
    expect(migration).toContain("public.stock_apply_deltas");
    expect(migration).toContain("AS movement_entry(value)");
    expect(migration).not.toContain(
      "FROM jsonb_array_elements(COALESCE(_movements,'[]'::jsonb)) r)",
    );
    expect(hotfix).toContain("AS movement_entry(value)");
    expect(hotfix).not.toContain("DECLARE\n  s jsonb := COALESCE(_sale, '{}'::jsonb);\n  r jsonb;");
    expect(idempotency).toContain("id, client_transaction_id, source_type, sale_id");
    expect(memberOrder.indexOf("INSERT INTO public.members")).toBeLessThan(
      memberOrder.indexOf("INSERT INTO public.sales"),
    );
    expect(memberOrder).toContain(
      "GRANT EXECUTE ON FUNCTION public.pos_sale_commit(jsonb,jsonb,jsonb,jsonb,jsonb,text)",
    );
    expect(migration).toContain("SECURITY INVOKER");
  });

  it("routes every client through the central sale RPC", () => {
    const gateway = read("src/core/api/pos-db.ts");
    expect(gateway).toContain('fn: "pos_sale_commit"');
    expect(gateway).toContain("_member: member ? memberToRow(member, tierId) : null");
  });

  it("allows the Electron atomic sale RPC through the HTTP relay contract", () => {
    const endpoint = read("src/lib/sync-endpoint.server.ts");
    const relay = read("src/core/api/pos-relay.server.ts");
    for (const rpc of ["pos_sale_commit", "sale_refund", "shift_cash_count_submit"]) {
      expect(endpoint).toContain(`"${rpc}"`);
    }
    expect(relay).toContain('if (op.fn === "pos_sale_commit")');
    expect(relay).toContain("scope.permissions.can_process_sale");
  });
});
