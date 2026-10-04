import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Store } from "@/core/types/pos-types";
import { scopeBetween } from "@/lib/stock-transfers";

const store = (id: string, groupId: string): Store =>
  ({ id, code: id, name: id, groupId, address: "", phone: "", isActive: true }) as Store;

describe("multi-branch stock transfer contract", () => {
  it("models a transfer as a source/destination branch pair, independent of terminals", () => {
    expect(scopeBetween(store("branch-a", "group-1"), store("branch-b", "group-1"))).toBe(
      "INTRA_GROUP",
    );
    expect(scopeBetween(store("branch-a", "group-1"), store("branch-z", "group-9"))).toBe(
      "INTER_GROUP",
    );
  });

  it("accepts every current lifecycle state while preserving rolling-upgrade aliases", () => {
    const migration = readFileSync(
      "supabase/migrations/20261004220000_align_stock_transfer_statuses.sql",
      "utf8",
    );
    for (const status of [
      "pending",
      "awaiting_approval",
      "approved",
      "in_transit",
      "dispatched",
      "received",
      "verified",
      "completed",
      "completed_with_discrepancy",
      "rejected",
      "cancelled",
    ]) {
      expect(migration).toContain(`'${status}'`);
    }
  });

  it("scopes synchronization to either participating branch rather than a terminal pair", () => {
    const schema = readFileSync("supabase/schema.sql", "utf8");
    expect(schema).toContain("p_branch_id IN (x.from_store_id::text,x.to_store_id::text)");
    expect(schema).toContain("public.user_has_store_access(from_store_id)");
    expect(schema).toContain("public.user_has_store_access(to_store_id)");
  });
});
