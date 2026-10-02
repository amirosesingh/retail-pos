import { describe, expect, it, vi, beforeEach } from "vitest";

const restMock = vi.fn();
vi.mock("@/core/api/pos-relay.server", () => ({ serviceRest: (...a: unknown[]) => restMock(...a) }));

import { safeAuthorizeRelayOp, batchInsertIds, type RelayScope } from "@/core/api/relay-policy.server";

const cashier: RelayScope = {
  kind: "cashier",
  label: "till1",
  storeId: "STORE-A",
  role: "staff",
  roleSlug: "cashier",
  permissions: { can_process_sale: true },
  isSupervisor: false,
  staffUserId: "u-1",
  actorName: "Amy",
};

const admin: RelayScope = { ...cashier, role: "admin", roleSlug: "admin", isSupervisor: true };

beforeEach(() => restMock.mockReset());

describe("relay authorisation", () => {
  it("stamps the caller's branch onto inserted rows", async () => {
    const out = await safeAuthorizeRelayOp(
      { kind: "insert", table: "sales", rows: [{ id: "1" }] },
      cashier,
    );
    expect(out.ok).toBe(true);
    if (out.ok && out.op.kind === "insert") expect(out.op.rows[0]!["store_id"]).toBe("STORE-A");
  });

  it.each(["payment_transactions", "item_activity_logs"])(
    "pins %s rows to the proven branch",
    async (table) => {
      const out = await safeAuthorizeRelayOp(
        { kind: "upsert", table, rows: [{ id: "row-1" }] },
        cashier,
      );
      expect(out.ok).toBe(true);
      if (out.ok && out.op.kind === "upsert") {
        expect(out.op.rows[0]?.["store_id"]).toBe("STORE-A");
      }
    },
  );

  it("refuses a row that claims another branch", async () => {
    const out = await safeAuthorizeRelayOp(
      { kind: "insert", table: "sales", rows: [{ id: "1", store_id: "STORE-B" }] },
      cashier,
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("STORE_FORBIDDEN");
  });

  it("pins updates to the caller's branch", async () => {
    const out = await safeAuthorizeRelayOp(
      { kind: "update", table: "shifts", values: { note: "x" }, match: { id: "s1" } },
      cashier,
    );
    expect(out.ok).toBe(true);
    if (out.ok && out.op.kind === "update") expect(out.op.match["store_id"]).toBe("STORE-A");
  });

  it("blocks a permission-gated column", async () => {
    const out = await safeAuthorizeRelayOp(
      { kind: "update", table: "products", values: { selling_price: 1 }, match: { id: "p" } },
      cashier,
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("PERMISSION_DENIED");
  });

  it("allows only permissioned product-price overrides for the proven branch", async () => {
    const allowed = await safeAuthorizeRelayOp(
      {
        kind: "upsert",
        table: "settings_scoped",
        rows: [{
          scope: "BRANCH",
          scope_id: "STORE-A",
          key: "product_price:p-1",
          value: { selling_price: 12, ecom_price: 14 },
          row_version: 999,
          updated_by: "spoofed",
        }],
      },
      { ...cashier, permissions: { ...cashier.permissions, can_edit_product_price: true } },
    );
    expect(allowed.ok).toBe(true);
    if (allowed.ok && allowed.op.kind === "upsert") {
      expect(allowed.op.onConflict).toBe("scope,scope_id,key");
      expect(allowed.op.rows[0]).not.toHaveProperty("row_version");
      expect(allowed.op.rows[0]?.["updated_by"]).toBe("u-1");
    }

    for (const rows of [
      [{ scope: "BRANCH", scope_id: "STORE-B", key: "product_price:p-1", value: { selling_price: 12 } }],
      [{ scope: "GLOBAL", scope_id: "", key: "product_price:p-1", value: { selling_price: 12 } }],
      [{ scope: "BRANCH", scope_id: "STORE-A", key: "tax.rate", value: { selling_price: 12 } }],
    ]) {
      const denied = await safeAuthorizeRelayOp(
        { kind: "upsert", table: "settings_scoped", rows },
        { ...cashier, permissions: { ...cashier.permissions, can_edit_product_price: true } },
      );
      expect(denied.ok).toBe(false);
    }
  });

  it("enforces tender corrections on the backend", async () => {
    const denied = await safeAuthorizeRelayOp(
      { kind: "update", table: "sales", values: { payment_type: "cash" }, match: { id: "s1" } },
      cashier,
    );
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.code).toBe("PERMISSION_DENIED");

    const permissionAloneIsDenied = await safeAuthorizeRelayOp(
      { kind: "update", table: "sales", values: { payment_type: "cash" }, match: { id: "s1" } },
      { ...cashier, permissions: { ...cashier.permissions, can_edit_tenders: true } },
    );
    expect(permissionAloneIsDenied.ok).toBe(false);

    const allowed = await safeAuthorizeRelayOp(
      { kind: "update", table: "sales", values: { payment_type: "cash" }, match: { id: "s1" } },
      admin,
    );
    expect(allowed.ok).toBe(true);
  });

  it("allows new and idempotent sale upserts but blocks tender changes", async () => {
    const sale = {
      id: "s-new",
      store_id: "STORE-A",
      payment_type: "cash",
      payments: [{ method: "cash", amount: 10 }],
    };
    restMock.mockResolvedValueOnce({ ok: true, json: async () => [] });
    expect(
      (await safeAuthorizeRelayOp({ kind: "upsert", table: "sales", rows: [sale] }, cashier)).ok,
    ).toBe(true);

    restMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          id: "s-new",
          payment_type: "cash",
          payments: [{ amount: 10, method: "cash" }],
        },
      ],
    });
    expect(
      (await safeAuthorizeRelayOp({ kind: "upsert", table: "sales", rows: [sale] }, cashier)).ok,
    ).toBe(true);

    restMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { id: "s-new", payment_type: "cash", payments: [{ method: "cash", amount: 10 }] },
      ],
    });
    expect(
      (await safeAuthorizeRelayOp({ kind: "upsert", table: "sales", rows: [sale] }, cashier)).ok,
    ).toBe(true);

    restMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { id: "s-new", payment_type: "card", payments: [{ method: "card", amount: 10 }] },
      ],
    });
    const changed = await safeAuthorizeRelayOp(
      { kind: "upsert", table: "sales", rows: [sale] },
      cashier,
    );
    expect(changed.ok).toBe(false);
    if (!changed.ok) expect(changed.code).toBe("PERMISSION_DENIED");
  });

  it("accepts correction history only from an administrator", async () => {
    const op = {
      kind: "insert" as const,
      table: "record_edits",
      rows: [{ record_type: "sale", record_id: "s1", store_id: "STORE-A" }],
    };
    expect((await safeAuthorizeRelayOp(op, cashier)).ok).toBe(false);
    expect((await safeAuthorizeRelayOp(op, admin)).ok).toBe(true);
  });

  it("allows a supervisor across branches", async () => {
    const out = await safeAuthorizeRelayOp(
      { kind: "update", table: "sales", values: { is_refunded: true }, match: { store_id: "STORE-B" } },
      admin,
    );
    expect(out.ok).toBe(true);
  });

  it("never writes tables outside the relay set", async () => {
    const out = await safeAuthorizeRelayOp(
      { kind: "insert", table: "app_users", rows: [{ id: "x" }] },
      cashier,
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("TABLE_FORBIDDEN");
  });

  it("lets an administrator register a branch but not a cashier", async () => {
    const mine = await safeAuthorizeRelayOp(
      { kind: "insert", table: "stores", rows: [{ id: "STORE-A", name: "Main" }] },
      admin,
    );
    expect(mine.ok).toBe(true);

    const theirs = await safeAuthorizeRelayOp(
      { kind: "insert", table: "stores", rows: [{ id: "STORE-B", name: "Other" }] },
      cashier,
    );
    expect(theirs.ok).toBe(false);
    if (!theirs.ok) expect(theirs.code).toBe("STORE_FORBIDDEN");
  });

  it("refuses a child row whose parent belongs to another branch", async () => {
    restMock.mockResolvedValue({ ok: true, json: async () => [{ store_id: "STORE-B" }] });
    const out = await safeAuthorizeRelayOp(
      { kind: "insert", table: "sale_items", rows: [{ id: "i", sale_id: "s2" }] },
      cashier,
    );
    expect(out.ok).toBe(false);
  });

  it("writes the cashier from the proven caller, not the payload", async () => {
    const out = await safeAuthorizeRelayOp(
      { kind: "insert", table: "sales", rows: [{ id: "1", cashier_name: "Someone else" }] },
      cashier,
    );
    expect(out.ok).toBe(true);
    if (out.ok && out.op.kind === "insert") {
      expect(out.op.rows[0]!["cashier_name"]).toBe("Amy");
      expect(out.op.rows[0]!["cashier_id"]).toBe("u-1");
    }
  });

  it("refuses a child whose parent the server has never seen", async () => {
    restMock.mockResolvedValue({ ok: true, json: async () => [] });
    const out = await safeAuthorizeRelayOp(
      { kind: "insert", table: "sale_items", rows: [{ id: "i", sale_id: "ghost" }] },
      cashier,
    );
    expect(out.ok).toBe(false);
  });

  it("accepts a child pushed alongside its parent", async () => {
    const ops = [
      { kind: "insert" as const, table: "sales", rows: [{ id: "s9" }] },
      { kind: "insert" as const, table: "sale_items", rows: [{ id: "i", sale_id: "s9" }] },
    ];
    const out = await safeAuthorizeRelayOp(ops[1]!, cashier, batchInsertIds(ops));
    expect(out.ok).toBe(true);
    expect(restMock).not.toHaveBeenCalled();
  });

  it("refuses a transfer change by a branch at neither end", async () => {
    restMock.mockResolvedValue({
      ok: true,
      json: async () => [{ from_store_id: "STORE-B", to_store_id: "STORE-C" }],
    });
    const out = await safeAuthorizeRelayOp(
      { kind: "update", table: "stock_transfers", values: { status: "RECEIVED" }, match: { id: "t1" } },
      cashier,
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("STORE_FORBIDDEN");
  });

  it("allows a transfer change by the receiving branch", async () => {
    restMock.mockResolvedValue({
      ok: true,
      json: async () => [{ from_store_id: "STORE-B", to_store_id: "STORE-A" }],
    });
    const out = await safeAuthorizeRelayOp(
      { kind: "update", table: "stock_transfers", values: { status: "RECEIVED" }, match: { id: "t1" } },
      cashier,
    );
    expect(out.ok).toBe(true);
  });

  it("asks a stale account to sign in again instead of failing blankly", async () => {
    const out = await safeAuthorizeRelayOp(
      { kind: "insert", table: "sales", rows: [{ id: "1" }] },
      { ...cashier, stale: true },
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("SCOPE_STALE");
  });

  it("never lets a till write telemetry through the relay", async () => {
    const out = await safeAuthorizeRelayOp(
      { kind: "insert", table: "branch_telemetry", rows: [{ store_id: "STORE-B" }] },
      cashier,
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("TABLE_FORBIDDEN");
  });

  it("keeps PIN tables out of the relay entirely", async () => {
    for (const table of ["cashiers", "pin_attempts", "user_roles", "terminal_tokens"]) {
      const out = await safeAuthorizeRelayOp(
        { kind: "insert", table, rows: [{ id: "x" }] },
        admin,
      );
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.code).toBe("TABLE_FORBIDDEN");
    }
  });

  it("writes the audit actor from the proven caller, not the payload", async () => {
    const out = await safeAuthorizeRelayOp(
      {
        kind: "insert",
        table: "audit_logs",
        rows: [{ id: "a1", user_name: "Someone else", user_id: "u-9" }],
      },
      cashier,
    );
    expect(out.ok).toBe(true);
    if (out.ok && out.op.kind === "insert") {
      expect(out.op.rows[0]!["user_name"]).toBe("Amy");
      expect(out.op.rows[0]!["user_id"]).toBe("u-1");
    }
  });

  it("refuses a cross-branch operational write from an ordinary cashier", async () => {
    const out = await safeAuthorizeRelayOp(
      { kind: "update", table: "drawer_events", values: { note: "x" }, match: { store_id: "STORE-B" } },
      cashier,
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("STORE_FORBIDDEN");
  });

  it("refuses a caller with no branch at all", async () => {
    const out = await safeAuthorizeRelayOp(
      { kind: "insert", table: "sales", rows: [{ id: "1" }] },
      { ...cashier, storeId: null },
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("SCOPE_MISSING");
  });

  it("lets a supervisor read-write across branches without spoofing", async () => {
    const out = await safeAuthorizeRelayOp(
      { kind: "insert", table: "sales", rows: [{ id: "1", store_id: "STORE-C" }] },
      admin,
    );
    expect(out.ok).toBe(true);
    if (out.ok && out.op.kind === "insert") expect(out.op.rows[0]!["store_id"]).toBe("STORE-C");
  });
});
