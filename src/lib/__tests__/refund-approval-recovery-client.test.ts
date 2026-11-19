import { beforeEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ bridge: null as Record<string, unknown> | null, route: vi.fn(), status: vi.fn(),
  authorize: vi.fn(), attach: vi.fn(), proof: vi.fn(), epoch: 1, terminal: undefined as (() => void) | undefined,
  client: undefined as (() => void) | undefined, offTerminal: vi.fn(), offClient: vi.fn() }));
vi.mock("@/core/local-db/local-db", () => ({ localDb: () => f.bridge }));
vi.mock("@/core/local-db/write-route", () => ({ resolveLocalWriteRoute: f.route }));
vi.mock("@/core/activation/terminal-tokens", () => ({ subscribeTerminalConfig: (cb: () => void) => { f.terminal = cb; return f.offTerminal; } }));
vi.mock("@/integrations/supabase/external-client", () => ({ subscribeExternalClientReset: (cb: () => void) => { f.client = cb; return f.offClient; } }));
vi.mock("@/core/local-db/local-staff", () => ({ authorizeNativeRefund: f.authorize,
  isNativeRefundGrant: (value: unknown) => value === "native-refund-v1:" + "a".repeat(43) }));
vi.mock("../pos-caller-auth", () => ({ getPosCallerAuth: f.proof }));
vi.mock("../session-epoch", () => ({ sessionEpoch: () => f.epoch }));
import { pendingRefundApproval, recoverRefundApproval, refundApprovalAmount } from "../refund-approval-recovery-client";
import type { PendingRefundApproval } from "@/core/local-db/local-db";

const pending: PendingRefundApproval = { saleId: "11111111-1111-4111-8111-111111111111", branchId: "A",
  operationId: "22222222-2222-4222-8222-222222222222", refundId: "refund:original", amountMinor: "1230",
  expectedSaleVersion: "1", route: "grouped", requiresApproval: true };
const nativeGrant = "native-refund-v1:" + "a".repeat(43);
beforeEach(() => {
  vi.resetAllMocks(); f.epoch = 1; f.route.mockResolvedValue("local");
  f.status.mockResolvedValue({ ok: true, pending: true, ...pending });
  f.authorize.mockResolvedValue({ ok: true, grantToken: nativeGrant });
  f.attach.mockResolvedValue({ ok: true, operationId: pending.operationId });
  f.proof.mockResolvedValue({ sessionToken: "person-proof" });
  f.bridge = { getRefundApprovalStatus: f.status, recoverRefundApproval: f.attach };
});

describe("saved refund approval client", () => {
  it("reads an existing local operation and returns its exact identity", async () => {
    await expect(pendingRefundApproval(pending.saleId, "A")).resolves.toEqual({ ok: true, pending: true, ...pending });
    expect(f.status).toHaveBeenCalledExactlyOnceWith({ saleId: pending.saleId, branchId: "A" });
    expect(f.attach).not.toHaveBeenCalled(); expect(f.authorize).not.toHaveBeenCalled();
    expect(f.offTerminal).toHaveBeenCalledOnce(); expect(f.offClient).toHaveBeenCalledOnce();
  });
  it("does not expose recovery on old shells, the web or a verified central route", async () => {
    f.bridge = null; await expect(pendingRefundApproval(pending.saleId, "A")).resolves.toBeNull();
    f.bridge = {}; await expect(pendingRefundApproval(pending.saleId, "A")).resolves.toBeNull();
    f.bridge = { getRefundApprovalStatus: f.status }; f.route.mockResolvedValue("cloud");
    await expect(pendingRefundApproval(pending.saleId, "A")).resolves.toBeNull();
    expect(f.status).not.toHaveBeenCalled();
  });
  it("distinguishes accepted work from unavailable local state", async () => {
    f.status.mockResolvedValueOnce({ ok: true, pending: false });
    await expect(pendingRefundApproval(pending.saleId, "A")).resolves.toBeNull();
    f.route.mockRejectedValueOnce(Object.assign(Error("unreadable"), { code: "ELOCAL_STATE_UNVERIFIED" }));
    await expect(pendingRefundApproval(pending.saleId, "A")).rejects.toMatchObject({ code: "ELOCAL_STATE_UNVERIFIED" });
    expect(f.status).toHaveBeenCalledTimes(1);
    f.status.mockResolvedValueOnce({ ok: false, code: "EREVIEW", error: "Review retained operation" });
    await expect(pendingRefundApproval(pending.saleId, "A")).rejects.toMatchObject({ code: "EREVIEW" });
  });
  it.each([{ branchId: "B" }, { saleId: "different-sale" }, { operationId: "bad" }, { amountMinor: "12.30" },
    { amountMinor: "9007199254740992" }, { expectedSaleVersion: "0" }, { route: "guessed" }, { requiresApproval: "yes" }])(
    "rejects an unverified returned operation %j", async patch => {
      f.status.mockResolvedValue({ ok: true, pending: true, ...pending, ...patch });
      await expect(pendingRefundApproval(pending.saleId, "A")).rejects.toMatchObject({ code: "EREFUND_RECOVERY_UNVERIFIED" });
    });
  it("requests fresh admission for the original operation, then attaches only its approval", async () => {
    await recoverRefundApproval(pending, "existing-approval");
    expect(f.authorize).toHaveBeenCalledExactlyOnceWith({ saleId: pending.saleId, branchId: "A", requestedAmount: 12.3,
      recoveryOperationId: pending.operationId, grantToken: "existing-approval", proof: { sessionToken: "person-proof" } });
    expect(f.attach).toHaveBeenCalledExactlyOnceWith({ saleId: pending.saleId, branchId: "A", operationId: pending.operationId, grantToken: nativeGrant });
  });
  it("honors direct authority without inventing an extra manager grant", async () => {
    await recoverRefundApproval({ ...pending, route: "financial" }, null);
    expect(f.authorize.mock.calls[0][0].grantToken).toBeNull();
    expect(f.attach).toHaveBeenCalledOnce();
  });
  it.each(["cloud", "unavailable", "denied", "bad-grant", "wrong-operation"])("holds the original operation after %s", async mode => {
    if (mode === "cloud") f.route.mockResolvedValue("cloud");
    if (mode === "unavailable") f.route.mockRejectedValue(Error("local SQL not ready"));
    if (mode === "denied") f.authorize.mockResolvedValue({ ok: false, code: "EAPPROVAL_DENIED" });
    if (mode === "bad-grant") f.authorize.mockResolvedValue({ ok: true, grantToken: "raw-hosted-grant" });
    if (mode === "wrong-operation") f.attach.mockResolvedValue({ ok: true, operationId: "another" });
    await expect(recoverRefundApproval(pending, null)).rejects.toThrow();
    if (mode !== "wrong-operation") expect(f.attach).not.toHaveBeenCalled();
  });
  it.each(["person", "terminal", "connection"])("refuses late admission after the %s changes", async mode => {
    f.authorize.mockImplementation(async () => {
      if (mode === "person") f.epoch++;
      if (mode === "terminal") f.terminal!();
      if (mode === "connection") f.client!();
      return { ok: true, grantToken: nativeGrant };
    });
    await expect(recoverRefundApproval(pending, null)).rejects.toMatchObject({ code: "EREFUND_RECOVERY_CONTEXT" });
    expect(f.attach).not.toHaveBeenCalled();
    expect(f.offTerminal).toHaveBeenCalledOnce(); expect(f.offClient).toHaveBeenCalledOnce();
  });
  it("does not show stale status from a previous device configuration", async () => {
    f.status.mockImplementation(async () => { f.terminal!(); return { ok: true, pending: true, ...pending }; });
    await expect(pendingRefundApproval(pending.saleId, "A")).rejects.toMatchObject({ code: "EREFUND_RECOVERY_CONTEXT" });
  });
  it("uses canonical minor units for approval display", () => {
    expect(refundApprovalAmount(pending)).toBe(12.3);
    expect(() => refundApprovalAmount({ ...pending, amountMinor: "01230" })).toThrow();
  });
});
