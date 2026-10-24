import { hasPermission, type PermissionKey } from "./permissions";

/** Rule eligibility and action authority are independent requirements. */
export const APPROVAL_ACTION_PERMISSIONS: Record<string, PermissionKey> = {
  sponsorship: "can_approve_sponsorship",
  refund: "can_process_refund", void_cart: "can_void_cart", void_line: "can_delete_line",
  reduce_qty: "can_reduce_qty", manual_discount: "can_give_discount", discount_over_limit: "can_give_discount",
  price_override: "can_override_price", below_cost_sale: "can_process_sale", tax_exemption: "can_process_sale",
  edit_tenders: "can_edit_tenders", no_sale_drawer: "can_no_sale_open", shift_close: "can_close_shift",
  shift_close_variance: "can_shift_variance_approve", stock_adjustment: "can_adjust_stock",
  stock_transfer: "can_create_transfer", delete_product: "can_archive_product", edit_posted_stock: "can_adjust_stock",
  edit_posted_purchase: "can_receive_purchase_order", discard_draft: "can_discard_held_order",
  terminal_unpair: "can_manage_terminals", member_points_adjust: "can_edit_member_points",
};
export function approverActionAllowed(action: string, person: {
  role?: string | null; roleSlug?: string | null; permissions?: Record<string, unknown> | null;
}) {
  const permission = APPROVAL_ACTION_PERMISSIONS[action];
  return !!permission && hasPermission(person, permission);
}
