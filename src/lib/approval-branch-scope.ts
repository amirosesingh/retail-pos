export type ApprovalScopeKey = `approval_scope:${string}`;
export const approvalScopeConfigured = (permissions: Record<string, unknown>) =>
  permissions["approval_scope:configured"] === true;

/** Explicit approval scope never widens an assigned account or fixed till. */
export function approvalBranchAllowed(
  who: {
    permissions: Record<string, unknown>;
    storeId: string;
    isAdmin: boolean;
    branchRestricted?: boolean;
  },
  branch: string,
): boolean {
  if (!branch) return false;
  if (who.storeId && who.storeId.toLowerCase() !== branch.toLowerCase()) return false;
  if (who.branchRestricted && !who.storeId) return false;
  if (!approvalScopeConfigured(who.permissions)) return !!who.storeId || who.isAdmin;
  return (
    who.permissions["approval_scope:all"] === true ||
    Object.entries(who.permissions).some(([key,allowed]) => allowed === true && key.toLowerCase() === `approval_scope:branch:${branch}`.toLowerCase())
  );
}
export function approvalAllBranchesAllowed(who: Parameters<typeof approvalBranchAllowed>[0]) {
  return (
    !who.storeId &&
    !who.branchRestricted &&
    (approvalScopeConfigured(who.permissions)
      ? who.permissions["approval_scope:all"] === true
      : who.isAdmin)
  );
}
export function approvalSelectedBranch(permissions: Record<string, unknown>): string {
  return (
    Object.keys(permissions)
      .find((key) => key.startsWith("approval_scope:branch:") && permissions[key] === true)
      ?.slice("approval_scope:branch:".length) ?? ""
  );
}
/** Extra saved restriction; callers retain their existing legacy branch gates. */
export function approvalPersonBranchAllowed(person: {
  permissions?: Record<string,unknown> | null; store_id?: string | null; storeId?: string;
  role?: string | null; role_slug?: string | null;
}, branch: string) {
  const permissions=person.permissions ?? {};
  return !approvalScopeConfigured(permissions) || approvalBranchAllowed({permissions,storeId:person.store_id ?? person.storeId ?? "",isAdmin:person.role === "admin" || person.role_slug === "admin"},branch);
}
export function withApprovalScope<T extends Record<string, boolean>>(
  permissions: T,
  mode: "assigned" | "all" | "selected",
  branch = "",
): T {
  const next = Object.fromEntries(
    Object.entries(permissions).filter(([key]) => !key.startsWith("approval_scope:")),
  );
  if (mode !== "assigned") {
    next["approval_scope:configured"] = true;
    if (mode === "all") next["approval_scope:all"] = true;
    else if (branch) next[`approval_scope:branch:${branch}`] = true;
  }
  return next as T;
}
