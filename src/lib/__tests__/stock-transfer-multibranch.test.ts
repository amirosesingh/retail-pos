import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { Store } from "@/core/types/pos-types";
const { routedQuery } = vi.hoisted(() => ({ routedQuery: vi.fn() }));
vi.mock("@/core/api/db-query", () => ({ routedQuery }));
import { loadTransfers, scopeBetween } from "@/lib/stock-transfers";

const store = (id: string, groupId: string): Store =>
  ({ id, code: id, name: id, groupId, address: "", phone: "", isActive: true }) as Store;

describe("multi-branch stock transfer contract", () => {
  it("restores every page of persisted drafts and their lines", async () => {
    routedQuery.mockReset();
    const firstPage = Array.from({ length: 500 }, (_, index) => ({
      id: `transfer-${index}`,
      status: "pending",
      from_store_id: "branch-a",
      to_store_id: "branch-b",
      created_at: "2026-10-07T00:00:00Z",
    }));
    routedQuery.mockImplementation(async (table: string, options: { offset?: number }) => {
      if (table === "stock_transfers")
        return options.offset === 0
          ? firstPage
          : [{ ...firstPage[0], id: "transfer-500", status: "draft", fulfilment: "partial" }];
      return [];
    });
    const transfers = await loadTransfers();
    expect(transfers).toHaveLength(501);
    expect(transfers[500]).toMatchObject({
      id: "transfer-500",
      status: "draft",
      fulfilment: "partial",
    });
    expect(transfers[0].status).toBe("awaiting_approval");
    expect(routedQuery).toHaveBeenCalledWith(
      "stock_transfers",
      expect.objectContaining({ offset: 500 }),
    );
  });

  it("reports a failed transfer read instead of presenting an empty draft list", async () => {
    routedQuery.mockReset();
    routedQuery.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(loadTransfers()).rejects.toThrow("database unavailable");
  });

  it("models a transfer as a source/destination branch pair, independent of terminals", () => {
    expect(scopeBetween(store("branch-a", "group-1"), store("branch-b", "group-1"))).toBe(
      "INTRA_GROUP",
    );
    expect(scopeBetween(store("branch-a", "group-1"), store("branch-z", "group-9"))).toBe(
      "INTER_GROUP",
    );
  });

  it("gives each locally journaled transfer line a stable primary key", () => {
    const source = readFileSync("src/lib/stock-transfers.ts", "utf8");
    expect(source).toContain('id: stableChildId(transfer.id, "6", index)');
    expect(source).toContain('table: "stock_transfer_items", rows: lines');
    expect(source).not.toContain(
      'table: "stock_transfer_items", match: { transfer_id: transfer.id }',
    );
  });

  it("persists, resumes and finalizes request and transfer drafts without orphaning lines", () => {
    const store = readFileSync("src/lib/pos-store.tsx", "utf8");
    const persistence = readFileSync("src/lib/stock-transfers.ts", "utf8");
    const composer = readFileSync("src/platforms/web/components/pos/TransferComposer.tsx", "utf8");
    const transferPage = readFileSync("src/routes/transfers.new.tsx", "utf8");
    const requestPage = readFileSync("src/routes/requests.new.tsx", "utf8");

    expect(store).toContain('status: saveAsDraft ? "draft"');
    expect(store).toContain('forcedId: stableChildId(before.id, "8", 0)');
    expect(persistence).toContain("previousLineCount - lines.length");
    expect(persistence).toContain('table: "stock_transfer_items",');
    expect(composer).toContain("Save draft");
    expect(transferPage).toContain("initialDraft={draft}");
    expect(transferPage).toContain("draftId: draft?.id");
    expect(requestPage).toContain("initialDraft={draft}");
    expect(requestPage).toContain("draftId: draft?.id");
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

  it("keeps drafts outside the approval lifecycle until explicit submission", () => {
    const migration = readFileSync(
      "supabase/migrations/20261008081500_enable_stock_transfer_drafts.sql",
      "utf8",
    );
    const schema = readFileSync("supabase/schema.sql", "utf8");
    for (const sql of [migration, schema]) {
      expect(sql).toContain("IF NEW.status = 'draft' THEN");
      expect(sql).toContain("IF OLD.status = 'draft' THEN");
      expect(sql).toContain(
        "NEW.status := CASE WHEN v_needs_approval THEN 'awaiting_approval' ELSE 'approved' END",
      );
    }
  });

  it("scopes synchronization to either participating branch rather than a terminal pair", () => {
    const schema = readFileSync("supabase/schema.sql", "utf8");
    expect(schema).toContain("p_branch_id IN (x.from_store_id::text,x.to_store_id::text)");
    expect(schema).toContain("public.user_has_store_access(from_store_id)");
    expect(schema).toContain("public.user_has_store_access(to_store_id)");
  });

  it("keeps privileged stock movement behind location- and permission-checked wrappers", () => {
    const migration = readFileSync(
      "supabase/migrations/20261007111500_harden_warehouse_transfer_lifecycle.sql",
      "utf8",
    );

    expect(migration).toContain(
      "DROP FUNCTION IF EXISTS public.stock_transfer_receive(uuid, text, boolean)",
    );
    for (const fn of ["approve", "dispatch", "receive", "verify"]) {
      expect(migration).toContain(`ALTER FUNCTION public.stock_transfer_${fn}`);
      expect(migration).toMatch(
        new RegExp(
          `CREATE OR REPLACE FUNCTION public\\.stock_transfer_${fn}[\\s\\S]*?SECURITY DEFINER[\\s\\S]*?SET search_path = ''`,
        ),
      );
      expect(migration).toContain(`PERFORM private.stock_transfer_${fn}`);
    }

    expect(migration).not.toMatch(
      /GRANT EXECUTE ON FUNCTION private\.stock_transfer_[^(]+\([^;]+?\)\s+TO authenticated/,
    );

    expect(migration).toContain("public.has_perm('can_approve_transfer')");
    expect(migration).toContain("public.has_perm('can_create_transfer')");
    expect(migration).toContain("public.has_perm('can_receive_transfer')");
    expect(migration).toContain("public.user_has_store_access(t.from_store_id)");
    expect(migration).toContain("public.user_has_store_access(t.to_store_id)");
  });

  it("enforces every transfer quantity ceiling in the database", () => {
    const migration = readFileSync(
      "supabase/migrations/20261007111500_harden_warehouse_transfer_lifecycle.sql",
      "utf8",
    );

    for (const constraint of [
      "stock_transfer_items_quantity_nonnegative",
      "stock_transfer_items_approved_within_request",
      "stock_transfer_items_dispatched_within_approval",
      "stock_transfer_items_received_within_dispatch",
      "stock_transfer_items_verified_within_dispatch",
    ]) {
      expect(migration).toContain(`ADD CONSTRAINT ${constraint}`);
      expect(migration).toContain(`VALIDATE CONSTRAINT ${constraint}`);
    }
  });
});
