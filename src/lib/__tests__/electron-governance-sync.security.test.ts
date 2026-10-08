import { describe, expect, it, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);
vi.mock("@/lib/external-supabase-config", () => ({
  supabaseConfig: () => ({ url: "https://example.test", key: "k" }),
  runtimeEnvValue: () => "service-key",
}));

import { runRelayRpc } from "@/core/api/pos-relay.server";
import {
  safeAuthorizeRelayOp,
  type RelayScope,
} from "@/core/api/relay-policy.server";

const cashier: RelayScope = {
  kind: "cashier",
  label: "till1",
  storeId: "STORE-A",
  role: "staff",
  roleSlug: "cashier",
  permissions: { can_shift_cash_count: true },
  isSupervisor: false,
  staffUserId: "u-1",
  actorName: "Amy",
};

const supervisor: RelayScope = {
  ...cashier,
  kind: "staff",
  role: "manager",
  roleSlug: "supervisor",
  permissions: { can_access_pos_settings: true, can_approve_requests: true },
  isSupervisor: true,
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

beforeEach(() => fetchMock.mockReset());

describe("Electron supervisor/governance sync relay", () => {
  it("pins an offline authorization request to the cashier branch and strips decision fields", async () => {
    const out = await safeAuthorizeRelayOp(
      {
        kind: "upsert",
        table: "authorization_requests",
        rows: [{
          id: "req-1",
          action_key: "discount",
          requested_by: "u-1",
          requested_by_name: "Amy",
          store_id: "STORE-B",
          terminal_id: "till1",
          status: "approved",
          decided_by: "spoofed",
          approved_amount: 999,
        }],
        onConflict: "id",
      },
      cashier,
    );
    expect(out.ok).toBe(false);
    expect(out.ok ? null : out.code).toBe("STORE_FORBIDDEN");
  });

  it("allows a cashier to queue a pending request for their own branch without approval authority", async () => {
    const out = await safeAuthorizeRelayOp(
      {
        kind: "upsert",
        table: "authorization_requests",
        rows: [{
          id: "req-1",
          action_key: "discount",
          requested_by: "u-1",
          requested_by_name: "Amy",
          store_id: "STORE-A",
          terminal_id: "till1",
          status: "approved",
          decided_by: "spoofed",
          approved_amount: 999,
        }],
        onConflict: "id",
      },
      cashier,
    );
    expect(out.ok).toBe(true);
    if (!out.ok || (out.op.kind !== "upsert" && out.op.kind !== "insert")) return;
    expect(out.op.rows[0]?.status).toBe("pending");
    expect(out.op.rows[0]?.decided_by).toBeNull();
    expect(out.op.rows[0]?.approved_amount).toBeNull();
    expect(out.op.rows[0]?.store_id).toBe("STORE-A");
  });

  it("refuses non-supervisor edits to authorization action configuration", async () => {
    const out = await safeAuthorizeRelayOp(
      {
        kind: "upsert",
        table: "authorization_actions",
        rows: [{ id: "a-1", action_key: "discount", mode: "pin" }],
        onConflict: "id",
      },
      cashier,
    );
    expect(out.ok).toBe(false);
    expect(out.ok ? null : out.code).toBe("PERMISSION_DENIED");
  });

  it("allows a supervisor to sync authorization action configuration", async () => {
    const out = await safeAuthorizeRelayOp(
      {
        kind: "upsert",
        table: "authorization_actions",
        rows: [{ id: "a-1", action_key: "discount", mode: "pin" }],
        onConflict: "id",
      },
      supervisor,
    );
    expect(out.ok).toBe(true);
  });

  it("permission-gates settings, promotions and suppliers relay writes", async () => {
    for (const table of ["pos_settings", "public_flags", "promotions", "suppliers"] as const) {
      const denied = await safeAuthorizeRelayOp(
        {
          kind: "upsert",
          table,
          rows: [{ id: "row-1", name: "Example" }],
          onConflict: "id",
        },
        cashier,
      );
      expect(denied.ok, table).toBe(false);
      expect(denied.ok ? null : denied.code, table).toBe("PERMISSION_DENIED");
    }

    const settings = await safeAuthorizeRelayOp(
      { kind: "upsert", table: "pos_settings", rows: [{ id: "row-1" }], onConflict: "id" },
      { ...cashier, permissions: { can_access_pos_settings: true } },
    );
    expect(settings.ok).toBe(false);

    const promotion = await safeAuthorizeRelayOp(
      { kind: "upsert", table: "promotions", rows: [{ id: "row-1" }], onConflict: "id" },
      { ...cashier, permissions: { can_manage_promotions: true } },
    );
    expect(promotion.ok).toBe(true);

    const supplier = await safeAuthorizeRelayOp(
      { kind: "upsert", table: "suppliers", rows: [{ id: "row-1" }], onConflict: "id" },
      { ...cashier, permissions: { can_receive_purchase_order: true } },
    );
    expect(supplier.ok).toBe(true);
  });

  it("refuses offline shift cash-count replay without count/close permission", async () => {
    const out = await runRelayRpc(
      {
        kind: "rpc",
        table: "shift_cash_counts",
        fn: "shift_cash_count_submit",
        args: { p_shift: "shift-1", p_cash: 100 },
      },
      { ...cashier, permissions: {} },
    );
    expect(out.ok).toBe(false);
    expect(out.code).toBe("PERMISSION_DENIED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses shift cash-count replay for another branch", async () => {
    fetchMock.mockResolvedValueOnce(json([{ store_id: "STORE-B" }]));
    const out = await runRelayRpc(
      {
        kind: "rpc",
        table: "shift_cash_counts",
        fn: "shift_cash_count_submit",
        args: { p_shift: "shift-1", p_cash: 100 },
      },
      cashier,
    );
    expect(out.ok).toBe(false);
    expect(out.code).toBe("STORE_FORBIDDEN");
  });

  it("runs shift cash-count replay for an authorised caller's own branch", async () => {
    fetchMock
      .mockResolvedValueOnce(json([{ store_id: "STORE-A" }]))
      .mockResolvedValueOnce(json({}));
    const out = await runRelayRpc(
      {
        kind: "rpc",
        table: "shift_cash_counts",
        fn: "shift_cash_count_submit",
        args: {
          p_shift: "shift-1",
          p_cash: 100,
          p_card: 20,
          p_digital: 5,
          p_client_key: "shift-1:original",
          p_terminal: "till1",
        },
      },
      cashier,
    );
    expect(out.ok).toBe(true);
    const [url] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toContain("/rest/v1/rpc/shift_cash_count_submit");
  });

  it("permission- and branch-gates transfer routines and stamps the verified actor", async () => {
    const denied = await runRelayRpc(
      {
        kind: "rpc",
        table: "stock_transfers",
        fn: "stock_transfer_approve",
        args: { p_transfer_id: "transfer-1", p_approved_by: "Spoofed" },
      },
      cashier,
    );
    expect(denied).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });

    fetchMock
      .mockResolvedValueOnce(json([{ from_store_id: "STORE-A" }]))
      .mockResolvedValueOnce(json({}));
    const approved = await runRelayRpc(
      {
        kind: "rpc",
        table: "stock_transfers",
        fn: "stock_transfer_approve",
        args: { p_transfer_id: "transfer-1", p_approved_by: "Spoofed" },
      },
      { ...cashier, permissions: { can_approve_transfer: true } },
    );
    expect(approved.ok).toBe(true);
    const [, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ p_approved_by: "Amy" });
  });
});
