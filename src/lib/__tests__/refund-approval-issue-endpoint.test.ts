import { beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({ verify: vi.fn(), scope: vi.fn(), check: vi.fn(), basis: vi.fn(), issue: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => ({
  validator: (parse: (v: unknown) => unknown) => ({
    handler: (fn: (v: { data: unknown }) => unknown) => (v: { data: unknown }) => fn({ data: parse(v.data) }),
  }),
}) }));
vi.mock("@/core/api/pos-relay.server", () => ({ verifyRelayCaller: f.verify }));
vi.mock("@/core/api/relay-policy.server", () => ({ resolveRelayScope: f.scope }));
vi.mock("../business-authorization.server", () => ({ checkBusinessAuthorization: f.check }));
vi.mock("../refund-approval-receipt.server", () => ({ issueRefundApprovalReceipt: f.issue, verifyRefundApprovalIssueBasis: f.basis }));

import { verifyBusinessAuthorization } from "../authorization.functions";

const original = { actionKey: "refund", storeId: "A", sessionToken: "fixture-session-token", requestedAmount: 12.3,
  grantToken: "short-lived-verified-grant", payload: { sale_id: "fixture-sale", receipt_no: "A-123", total: 12.3 } };
const optIn = { refundApprovalBasis: { exact: "basis" }, refundApprovalWitness: { authorId: "fixture-author", subject: "cashier" } };
const call = (extra: Record<string, unknown> = {}) => verifyBusinessAuthorization({ data: { ...original, ...extra } });

beforeEach(() => {
  vi.clearAllMocks(); f.verify.mockResolvedValue({ kind: "cashier", authUserId: "cashier" });
  f.scope.mockResolvedValue({ staffUserId: "cashier", role: "staff", roleSlug: "staff", storeId: "A", permissions: {} });
  f.check.mockResolvedValue({ ok: true, required: true, grant: { exact: "verified-approval" } });
  f.basis.mockResolvedValue({ normalized: "canonical-basis" }); f.issue.mockResolvedValue("exact-operation-non-bearer-receipt");
});

describe("optional durable refund approval on existing verify_mutation endpoint", () => {
  it.each(["refund", "stock_transfer"])("leaves ordinary %s verification unchanged", async actionKey => {
    const result = await call({ actionKey });
    expect(result).toEqual({ ok: true, required: true, grant: { exact: "verified-approval" } });
    expect(f.basis).not.toHaveBeenCalled(); expect(f.issue).not.toHaveBeenCalled();
    expect(f.check).toHaveBeenCalledWith(expect.objectContaining({ id: "cashier", storeId: "A" }), expect.objectContaining({ ...original, actionKey }));
  });
  it("issues only after ordinary approval and canonical basis checks, using the verified current caller", async () => {
    const result = await call(optIn);
    expect(result).toMatchObject({ ok: true, refundApprovalReceipt: "exact-operation-non-bearer-receipt" });
    expect(f.basis).toHaveBeenCalledWith(optIn.refundApprovalBasis, expect.objectContaining(original));
    expect(f.issue).toHaveBeenCalledWith({ basis: { normalized: "canonical-basis" }, witness: optIn.refundApprovalWitness,
      proof: expect.objectContaining({ sessionToken: original.sessionToken }), authorization: { ok: true, required: true, grant: { exact: "verified-approval" } } });
    expect(f.check.mock.invocationCallOrder[0]).toBeLessThan(f.basis.mock.invocationCallOrder[0]);
    expect(f.basis.mock.invocationCallOrder[0]).toBeLessThan(f.issue.mock.invocationCallOrder[0]);
  });
  it.each([
    { ...optIn, actionKey: "stock_transfer" },
    { refundApprovalBasis: optIn.refundApprovalBasis },
    { refundApprovalWitness: optIn.refundApprovalWitness },
  ])("rejects incomplete or non-refund opt-in without issuing broader authority", async extra => {
    expect(await call(extra)).toMatchObject({ ok: false }); expect(f.check).not.toHaveBeenCalled();
    expect(f.basis).not.toHaveBeenCalled(); expect(f.issue).not.toHaveBeenCalled();
  });
  it("keeps an ordinary grant denial and canonical sale mismatch from issuing evidence", async () => {
    f.check.mockResolvedValueOnce({ ok: false, error: "A valid authorization grant is required" });
    expect(await call(optIn)).toEqual({ ok: false, error: "A valid authorization grant is required" });
    expect(f.basis).not.toHaveBeenCalled(); expect(f.issue).not.toHaveBeenCalled();
    f.basis.mockRejectedValueOnce(Error("The exact saved refund authorization could not be verified."));
    expect(await call(optIn)).toMatchObject({ ok: false }); expect(f.issue).not.toHaveBeenCalled();
  });
  it("keeps the existing caller branch restriction before issuing evidence", async () => {
    expect(await call({ ...optIn, storeId: "B" })).toMatchObject({ ok: false, error: "Cross-branch access is not allowed" });
    expect(f.check).not.toHaveBeenCalled(); expect(f.issue).not.toHaveBeenCalled();
  });
});
