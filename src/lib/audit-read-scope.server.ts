import { requireCallerScope, type CallerProof } from "./privileged-caller.server";

/** Null means company-wide access and is reserved for an administrator. */
export async function auditReadBranch(
  proof: CallerProof,
  entityType?: string,
): Promise<string | null> {
  const scope = await requireCallerScope(proof);
  const statusPermissions: Record<string, string[]> = {
    booking: ["can_manage_bookings", "can_create_booking", "can_collect_booking"],
    job_card: ["can_manage_bookings"],
    sale: ["can_process_sale", "can_reprint_bill"],
    shift: ["can_open_shift", "can_close_shift", "can_shift_closing_history_view"],
    stock_transfer: ["can_create_transfer", "can_receive_transfer", "can_approve_transfer"],
    stock_request: ["can_create_transfer", "can_approve_transfer"],
    purchase_order: ["can_receive_purchase_order"],
    stock_count: ["can_adjust_stock"],
    member: ["can_add_member", "can_view_member_history"],
    product: ["can_add_new_product", "can_edit_product_details"],
  };
  const moduleAllowed =
    !!entityType &&
    (statusPermissions[entityType] ?? []).some((key) => scope.permissions[key] === true);
  if (
    scope.kind === "terminal" ||
    (!scope.isSupervisor && scope.permissions.can_view_audit_trail !== true && !moduleAllowed)
  )
    throw new Error("Audit-trail permission is required");
  if (scope.role === "admin" || scope.roleSlug === "admin") return null;
  if (!scope.storeId) throw new Error("A branch scope is required");
  return scope.storeId;
}
