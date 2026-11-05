import { canAuthorize, excludedAuthorizationUserIds, type AuthorizationRule } from "./authorization";
/** UI mirrors the saved cross-cluster list; the database remains authoritative. */
export function mayApproveTransferRelease(
  crossCluster: boolean,
  requester: string,
  actor: { ids: string[]; name: string; role: string },
  rule: AuthorizationRule | undefined,
): boolean {
  if (!crossCluster) return true;
  const ids = actor.ids.map(id => id.trim().toLowerCase()).filter(Boolean);
  const requesterId = requester.trim().toLowerCase();
  if (requesterId && [actor.name.trim().toLowerCase(), ...ids].includes(requesterId)) return false;
  // Editor defaults are not a saved tenant policy. Older tenants keep their
  // existing permission-based fallback until a global rule is configured.
  if (!rule || !rule.id || !rule.isEnabled) return true;
  if (excludedAuthorizationUserIds(rule.allowedUserIds).some(id => ids.includes(id.toLowerCase()))) return false;
  return ids.length ? ids.some(userId => canAuthorize(rule, { userId, role: actor.role })) : canAuthorize(rule, { role: actor.role });
}
