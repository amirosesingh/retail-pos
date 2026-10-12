import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
vi.mock("@/core/api/pos-relay.server", () => ({ serviceRest: vi.fn() }));
import { safeAuthorizeRelayOp, type RelayScope } from "@/core/api/relay-policy.server";
const admin: RelayScope = { kind: "cashier", label: "Admin", role: "admin", roleSlug: "admin", storeId: "branch-a", staffUserId: "admin-a", isSupervisor: true, permissions: {} };
const op = { kind: "upsert" as const, table: "settings_scoped", rows: [{ scope: "GLOBAL", scope_id: "", key: "pos_field:integration_settings", value: { dateFormat: "dd/MM/yyyy" }, updated_by: "forged", row_version: 999 }] };
describe("global settings session saves", () => {
  it("accepts PIN administrators and stamps the verified author without client revisions", async () => {
    const result = await safeAuthorizeRelayOp(op, admin);
    expect(result.ok).toBe(true);
    if (result.ok && result.op.kind === "upsert") {
      expect(result.op.onConflict).toBe("scope,scope_id,key");
      expect(result.op.rows[0]).toMatchObject({ updated_by: "admin-a", value: op.rows[0].value });
      expect(result.op.rows[0]).not.toHaveProperty("row_version");
    }
  });
  it.each([
    { ...admin, kind: "terminal" as const },
    { ...admin, stale: true },
    { ...admin, role: "manager", roleSlug: "supervisor" },
    { ...admin, role: "staff", roleSlug: "cashier", isSupervisor: false, permissions: { can_access_pos_settings: true, can_edit_product_price: true } },
  ])("refuses unverified and non-admin global writes", async scope => {
    expect((await safeAuthorizeRelayOp(op, scope)).ok).toBe(false);
  });
  it("rejects mixed scope and unrelated private settings rows", async () => {
    for (const row of [{ ...op.rows[0], scope: "BRANCH", scope_id: "branch-a" }, { ...op.rows[0], key: "personal_appearance" }]) {
      expect((await safeAuthorizeRelayOp({ ...op, rows: [op.rows[0], row] }, admin)).ok).toBe(false);
    }
  });
  it("saves global settings through the common verified commit path", () => {
    const source = readFileSync("src/core/api/pos-db.ts", "utf8");
    const save = source.slice(source.indexOf("async saveSettingsNow"), source.indexOf("refundSale(saleId"));
    expect(save).toContain('commitOps("Saving settings", [fieldOp, op])');
    expect(save).not.toContain('supabase.from("settings_scoped")');
    expect(save).not.toContain('supabase.from("pos_settings")');
  });
});
