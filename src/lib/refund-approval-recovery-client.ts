import { localDb, type PendingRefundApproval } from "@/core/local-db/local-db";
import { resolveLocalWriteRoute } from "@/core/local-db/write-route";
import { subscribeTerminalConfig } from "@/core/activation/terminal-tokens";
import { subscribeExternalClientReset } from "@/integrations/supabase/external-client";
import { authorizeNativeRefund, isNativeRefundGrant } from "@/core/local-db/local-staff";
import { getPosCallerAuth } from "./pos-caller-auth";
import { sessionEpoch } from "./session-epoch";
import { sameBranchId } from "./branch-id";
import { sameRecordId } from "./sale-identity";

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
function fail(message: string, code = "EREFUND_RECOVERY_UNVERIFIED"): never {
  throw Object.assign(new Error(message), { code });
}

async function inCurrentContext<T>(work: (assertCurrent: () => void) => Promise<T>): Promise<T> {
  const epoch = sessionEpoch();
  let changed = false;
  const retire = () => { changed = true; };
  const offTerminal = subscribeTerminalConfig(retire);
  const offClient = subscribeExternalClientReset(retire);
  const assertCurrent = () => {
    if (changed || epoch !== sessionEpoch()) fail("The signed-in person or connection changed. Reopen the saved refund.", "EREFUND_RECOVERY_CONTEXT");
  };
  try { return await work(assertCurrent); }
  finally { offTerminal(); offClient(); }
}

/** Display/approval amount only; Main reads the immutable operation itself. */
export function refundApprovalAmount(pending: PendingRefundApproval): number {
  if (typeof pending.amountMinor !== "string" || !/^(?:0|[1-9]\d{0,15})$/.test(pending.amountMinor) ||
      BigInt(pending.amountMinor) > BigInt(Number.MAX_SAFE_INTEGER)) fail("The saved refund amount could not be verified.");
  return Number(pending.amountMinor) / 100;
}

export async function pendingRefundApproval(saleId: string, branchId: string): Promise<PendingRefundApproval | null> {
  const bridge = localDb();
  // Older shells and central-only devices retain their existing receipt UI.
  if (!bridge?.getRefundApprovalStatus) return null;
  return inCurrentContext(async assertCurrent => {
    if (await resolveLocalWriteRoute(bridge) === "cloud") return null;
    assertCurrent();
    const result = await bridge.getRefundApprovalStatus!({ saleId, branchId });
    assertCurrent();
    if (!result?.ok) fail(result?.error ?? "The saved refund upload status could not be checked.", result?.code);
    if (!result.pending) return null;
    if (!sameRecordId(result.saleId, saleId) || !sameBranchId(result.branchId, branchId) || !uuid.test(result.operationId) ||
        typeof result.requiresApproval !== "boolean" || !["grouped", "financial"].includes(result.route) ||
        typeof result.refundId !== "string" || !result.refundId || result.refundId.length > 128 ||
        typeof result.expectedSaleVersion !== "string" || !/^[1-9]\d{0,75}$/.test(result.expectedSaleVersion))
      fail("The saved refund upload identity could not be verified.");
    refundApprovalAmount(result);
    return result;
  });
}

/** Append approval evidence to the original operation. Never call refundSale. */
export async function recoverRefundApproval(pending: PendingRefundApproval, grantToken: string | null): Promise<void> {
  await inCurrentContext(async assertCurrent => {
    const bridge = localDb();
    if (!bridge?.recoverRefundApproval || await resolveLocalWriteRoute(bridge) !== "local")
      fail("Reconnect the saved local database to recover this refund's approval.");
    assertCurrent();
    const proof = await getPosCallerAuth();
    assertCurrent();
    const admitted = await authorizeNativeRefund({ saleId: pending.saleId, branchId: pending.branchId,
      requestedAmount: refundApprovalAmount(pending), recoveryOperationId: pending.operationId,
      grantToken, proof: { accessToken: proof.accessToken, cashierToken: proof.cashierToken, sessionToken: proof.sessionToken } });
    assertCurrent();
    if (!admitted.ok || !isNativeRefundGrant(admitted.grantToken))
      fail(admitted.error ?? "The saved refund approval could not be verified.", admitted.code);
    const saved = await bridge.recoverRefundApproval({ saleId: pending.saleId, branchId: pending.branchId,
      operationId: pending.operationId, grantToken: admitted.grantToken });
    assertCurrent();
    if (!saved?.ok || saved.operationId !== pending.operationId)
      fail(saved?.error ?? "The approval could not be attached to the original refund.", saved?.code);
  });
}
