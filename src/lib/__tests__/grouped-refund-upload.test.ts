import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyGroupedRefundUpload, groupedRefundUploadSchema } from "../grouped-refund-upload.server";
import { handleSyncRequest } from "../sync-endpoint.server";

const mocks = vi.hoisted(() => ({
  env: vi.fn(), verify: vi.fn(), scope: vi.fn(), rest: vi.fn(), approve: vi.fn(),
}));
vi.mock("../external-supabase-config", () => ({
  runtimeEnvValue: mocks.env,
  supabaseConfig: () => ({ url: "https://refund-pilot.test", key: "fixture" }),
}));
vi.mock("@/core/api/pos-relay.server", () => ({ verifyRelayCaller: mocks.verify, serviceRest: mocks.rest }));
vi.mock("@/core/api/relay-policy.server", () => ({ resolveRelayScope: mocks.scope }));
vi.mock("../business-authorization.server", () => ({ checkBusinessAuthorization: mocks.approve }));

const terminal = { id: "66666666-6666-4666-8666-666666666666", branchId: "A", platform: "pc", mode: "operations" };
const operator = { appUserId: "11111111-1111-4111-8111-111111111111", staffUserId: "operator", roleSlug: "cashier" };
const proof = { terminalToken: terminal.id, deviceBindingProof: "a".repeat(64), sessionToken: "person-session" };
const pilot = () => [terminal.id];
const command = {
  branchId: "A", saleId: "22222222-2222-4222-8222-222222222222",
  operationId: "33333333-3333-4333-8333-333333333333", refundKey: "refund:exact",
  lines: [{ item_id: "44444444-4444-4444-8444-444444444444", qty: 2, expected_refunded_qty: 0, expected_row_version: 1 }],
  expectedSaleVersion: 1, reason: null, grantToken: "bound-grant",
};
const context = { operation_id: command.operationId, sale_id: command.saleId };
const basis = { bill_number: "A-123", total: "12.30", row_version: 1 };
const preflight = { ...context, status: "APPROVAL_CHECK_REQUIRED", basis };
const product = "55555555-5555-4555-8555-555555555555";
const receipt = {
  ...context, status: "APPLIED", sale_row_version: 1, fully_refunded: false,
  effects: [{
    item_id: command.lines[0].item_id, product_id: product, movement_id: "aa09765b-8b2f-fda9-5370-48ecd0bfb6ac",
    branch_id: "A", delta: 2, refunded_qty: 2, row_version: 2,
  }],
  stock: [{ product_id: product, branch_id: "A", balance: 7 }],
};
const apply = () => applyGroupedRefundUpload(command, proof, pilot, new AbortController().signal);
const route = (extra = {}) => handleSyncRequest(new Request("https://relay.test/api/v1/pos/sync", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ ...proof, sqlServerRefund: command, ...extra }),
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.env.mockReturnValue("true");
  mocks.verify.mockResolvedValue({ kind: "cashier", terminal });
  mocks.scope.mockResolvedValue({ ...operator, terminalId: terminal.id, storeId: "A", permissions: { can_process_refund: true } });
  mocks.approve.mockResolvedValue({ ok: true });
});

describe("scoped refund command", () => {
  it("requires an exclusive endpoint request and exact pilot configuration before checking identity", async () => {
    const env: Record<string, string> = {
      POS_GROUPED_FEED_PILOT_PROJECT_URL: "https://refund-pilot.test",
      POS_GROUPED_FEED_PILOT_TERMINAL_ID: terminal.id,
      POS_GROUPED_CASH_SETTINGS_PILOT_ENABLED: "true",
    };
    mocks.env.mockImplementation(name => env[name]);
    expect((await route({ ops: [] })).status).toBe(400);
    expect((await route()).status).toBe(503);
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.rest).not.toHaveBeenCalled();
    env.POS_GROUPED_REFUND_UPLOAD_PILOT_ENABLED = "true";
    mocks.rest.mockResolvedValueOnce(Response.json(receipt));
    expect(await (await route()).json()).toEqual(receipt);
  });

  it("keeps the pilot disabled by default, and rejects cross-branch and permission failures", async () => {
    mocks.env.mockReturnValueOnce(undefined);
    expect((await apply()).status).toBe(503);
    expect(mocks.verify).not.toHaveBeenCalled();
    mocks.verify.mockResolvedValueOnce({ kind: "cashier", terminal: { ...terminal, branchId: "B" } });
    expect((await apply()).status).toBe(403);
    mocks.scope.mockResolvedValueOnce({ ...operator, terminalId: terminal.id, storeId: "A", permissions: {} });
    expect((await apply()).status).toBe(403);
    expect(mocks.rest).not.toHaveBeenCalled();
  });

  it("rejects client-provided effects, approval basis, and duplicate line requests", () => {
    expect(groupedRefundUploadSchema.safeParse(command).success).toBe(true);
    for (const change of [{ stock: receipt.stock }, { basis }, { author: operator.appUserId }, { lines: [...command.lines, ...command.lines] }]) {
      expect(groupedRefundUploadSchema.safeParse({ ...command, ...change }).success).toBe(false);
    }
  });

  it("only mutates using the exact database basis after the existing bill approval check", async () => {
    mocks.rest.mockResolvedValueOnce(Response.json(preflight)).mockResolvedValueOnce(Response.json(receipt));
    const result = await apply();
    expect(await result.json()).toEqual(receipt);
    expect(mocks.verify).toHaveBeenCalledWith(proof, { strictAvailability: true, rejectUnboundCashier: true });
    expect(mocks.approve).toHaveBeenCalledWith(
      { appUserId: operator.appUserId, id: operator.staffUserId, role: operator.roleSlug },
      {
        actionKey: "refund", storeId: "A", requestedAmount: 12.3, grantToken: "bound-grant",
        payload: { sale_id: command.saleId, receipt_no: "A-123", total: 12.3 },
      },
    );
    const bodies = mocks.rest.mock.calls.map(([path, init]) => {
      expect(path).toBe("rpc/pos_sync_refund_v1");
      return JSON.parse(init.body);
    });
    expect(bodies[0]).toMatchObject({
      p_author: operator.appUserId, p_terminal: terminal.id, p_branch: "A", p_approval_basis: null,
    });
    expect(bodies[1]).toEqual({ ...bodies[0], p_approval_basis: basis });
  });

  it("leaves the command unmodified when approval fails and returns exact receipts without rechecking a grant", async () => {
    mocks.rest.mockResolvedValueOnce(Response.json(preflight));
    mocks.approve.mockResolvedValueOnce({ ok: false });
    expect(await (await apply()).json()).toEqual({ ok: false, code: "REFUND_APPROVAL_REQUIRED" });
    expect(mocks.rest).toHaveBeenCalledTimes(1);
    mocks.rest.mockResolvedValueOnce(Response.json(receipt));
    expect(await (await apply()).json()).toEqual(receipt);
    expect(mocks.approve).toHaveBeenCalledTimes(1);
    expect(mocks.rest).toHaveBeenCalledTimes(2);
  });

  it("returns an explicit review hold and refuses an inconsistent effect receipt without fallback", async () => {
    const held = { ...context, status: "REVIEW_REQUIRED", code: "LEGACY_REFUND_MOVEMENT" };
    mocks.rest.mockResolvedValueOnce(Response.json(held)).mockResolvedValueOnce(Response.json({
      ...receipt, effects: [{ ...receipt.effects[0], delta: 3 }],
    }));
    expect(await (await apply()).json()).toEqual(held);
    expect(await (await apply()).json()).toEqual({ ok: false, code: "REFUND_UPLOAD_PROTOCOL" });
    expect(mocks.approve).not.toHaveBeenCalled();
    expect(mocks.rest).toHaveBeenCalledTimes(2);
  });
});
