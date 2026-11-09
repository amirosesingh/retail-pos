import {
  authorizationBinding, canBypassAuthorization, requiresAuthorizationAmount, resolveRules, type AuthPayload,
} from "./authorization";
import { getRequest, loadRuleRows } from "./authorization.server";

/** Verify the existing effective rule for an already authenticated operator. */
export async function checkBusinessAuthorization(
  who: { id: string; role: string },
  data: {
    actionKey: string;
    storeId: string;
    payload: AuthPayload;
    snapshotHash?: string;
    requestedAmount?: number | null;
    grantToken?: string | null;
  },
) {
  const rule = resolveRules(await loadRuleRows(data.storeId), data.storeId)[data.actionKey];
  if (!rule?.isEnabled || rule.mode === "none") return { ok: true as const, required: false };
  if (requiresAuthorizationAmount(data.actionKey) && data.requestedAmount == null)
    return { ok: false as const, error: "The value being authorized is required" };
  if (canBypassAuthorization(rule, { userId: who.id, role: who.role }, data.requestedAmount))
    return { ok: true as const, required: false, bypassedBy: who.id };

  const { verifyOverrideGrant } = await import("./pos-rules.server");
  const binding = authorizationBinding(data.payload, data.snapshotHash);
  const grant = verifyOverrideGrant(data.grantToken ?? undefined, data.actionKey, {
    storeId: data.storeId,
    binding,
  });
  if (!grant) return { ok: false as const, error: "A valid authorization grant is required" };
  if (data.requestedAmount != null && (grant.approvedAmount == null ||
      !Number.isFinite(grant.approvedAmount) || grant.approvedAmount < 0))
    return { ok: false as const, error: "An approval covering the requested value is required" };
  if (grant.approvedAmount != null &&
      (data.requestedAmount == null || data.requestedAmount > grant.approvedAmount))
    return { ok: false as const, error: "The requested value exceeds the approved amount" };

  // A queued approval can be invalidated after it was claimed.
  if (grant.requestId) {
    const request = await getRequest(grant.requestId);
    if (!request || request.status !== "approved" || !request.consumedAt ||
        request.requestedBy.toLowerCase() !== who.id.toLowerCase())
      return { ok: false as const, error: "That approval is no longer valid" };
  }
  return { ok: true as const, required: true, grant };
}
