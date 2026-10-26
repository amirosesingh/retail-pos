/** Reading an old bill does not grant authority to refund or edit it. */
export function canRetrieveHistoricalReceipt(scope: {
  role?: string | null; roleSlug?: string | null; permissions: Record<string, unknown>;
}): boolean {
  return scope.role === "admin" || scope.roleSlug === "admin" ||
    scope.permissions.can_reprint_bill === true || scope.permissions.can_process_refund === true;
}
