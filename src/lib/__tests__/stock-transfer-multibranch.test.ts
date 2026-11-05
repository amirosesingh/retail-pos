import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { Store } from "@/core/types/pos-types";
const { routedQuery } = vi.hoisted(() => ({ routedQuery: vi.fn() }));
vi.mock("@/core/api/db-query", () => ({ routedQuery }));
import { loadTransfer, loadTransfers, scopeBetween } from "@/lib/stock-transfers";

const store = (id: string, groupId: string): Store =>
  ({ id, code: id, name: id, groupId, address: "", phone: "", isActive: true }) as Store;

describe("multi-branch stock transfer contract", () => {
  it("distinguishes a detail read failure from a missing record", async () => {
    routedQuery.mockReset();
    routedQuery.mockRejectedValueOnce(new Error("Network error"));
    await expect(loadTransfer("note", { throwOnError: true })).rejects.toThrow("Network error");
    routedQuery.mockResolvedValueOnce([]);
    await expect(loadTransfer("note", { throwOnError: true })).resolves.toBeNull();
  });
  it("does not display a partly loaded note when line loading fails", async () => {
    routedQuery.mockReset();
    routedQuery.mockResolvedValueOnce([{ id: "note", status: "draft" }]).mockRejectedValueOnce(new Error("Line read failed"));
    await expect(loadTransfer("note", { throwOnError: true })).rejects.toThrow("Line read failed");
  });
  it("loads transfer line groups with bounded concurrency and retains every page", async () => {
    routedQuery.mockReset();
    const headers = Array.from({ length: 350 }, (_, id) => ({ id: `transfer-${id}`, status: "draft" }));
    let active = 0, peak = 0;
    routedQuery.mockImplementation(async (table: string, options: { offset: number; in?: { values: string[] } }) => {
      if (table === "stock_transfers") return headers;
      active++; peak = Math.max(peak, active);
      try {
        await new Promise(resolve => setTimeout(resolve, 0));
        const ids = options.in!.values;
        if (ids[0] === "transfer-0") {
          if (options.offset === 1000) return [{ id: "last", transfer_id: ids[0], product_id: "last-product", quantity: 1 }];
          return Array.from({ length: 1000 }, (_, index) => ({ id: `line-${index}`, transfer_id: ids[index % ids.length], product_id: `product-${index}`, quantity: 1 }));
        }
        return ids.map(id => ({ id: `line-${id}`, transfer_id: id, product_id: "product", quantity: 1 }));
      } finally { active--; }
    });
    const result = await loadTransfers();
    expect(peak).toBe(3);
    expect(result).toHaveLength(350);
    expect(result.reduce((total, row) => total + row.items.length, 0)).toBe(1251);
    expect(result[0].items).toHaveLength(11);
    expect(result[0].items.at(-1)?.productId).toBe("last-product");
    expect(routedQuery).toHaveBeenCalledWith("stock_transfer_items", expect.objectContaining({ offset: 1000 }));
  });

  it("rejects the complete list if a parallel line group fails instead of exposing partial transfers", async () => {
    routedQuery.mockReset();
    routedQuery.mockImplementation(async (table: string, options: { in?: { values: string[] } }) => {
      if (table === "stock_transfers") return Array.from({ length: 250 }, (_, id) => ({ id: `transfer-${id}` }));
      if (options.in?.values[0] === "transfer-100") throw new Error("line query failed");
      return [];
    });
    await expect(loadTransfers()).rejects.toThrow("line query failed");
  });
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
    expect(store).toContain("const savedTransfer = (await loadTransfer(transfer.id)) ?? transfer");
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
    const followUp = readFileSync(
      "supabase/migrations/20261008083500_preserve_submitted_transfer_approval.sql",
      "utf8",
    );
    const schema = readFileSync("supabase/schema.sql", "utf8");
    for (const sql of [migration, followUp, schema]) {
      expect(sql).toContain("IF NEW.status = 'draft' THEN");
      expect(sql).toContain("IF OLD.status = 'draft' THEN");
      expect(sql).toContain(
        "WHEN v_needs_approval OR NEW.status = 'awaiting_approval' THEN 'awaiting_approval'",
      );
      const lifecycleStart = sql.indexOf(
        "CREATE OR REPLACE FUNCTION public.stock_transfers_enforce_lifecycle",
      );
      const lifecycle = sql.slice(
        lifecycleStart,
        sql.indexOf("$function$;", lifecycleStart) + "$function$;".length,
      );
      expect(lifecycle).not.toContain("OR public.has_perm('can_receive_transfer')");
    }
    expect(schema).toContain(
      "CREATE TRIGGER stock_transfers_enforce_lifecycle BEFORE INSERT OR UPDATE ON public.stock_transfers",
    );
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
