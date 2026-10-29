import { PERMISSION_PAGES, pageEnabled, pageForRoute, setPageVisibility } from "./permission-pages";
import { PERMISSION_LABELS, type PermissionKey, type StaffPermissions } from "./permissions";
import { navGroups, routePermissionForPath } from "@/platforms/web/components/pos/nav-config";
import { SETTINGS_CARDS } from "./settings-catalog";

/** Presentation only. Persisted page IDs, action keys and execution gates stay unchanged. */
export const PERMISSION_SECTIONS = [
  { id: "selling", label: "Selling", pageIds: ["register", "holds", "shifts", "receipts", "display"] },
  { id: "business", label: "Business overview", pageIds: ["dashboard", "analytics", "all-shops", "locations", "audit"] },
  { id: "approvals", label: "Approvals", pageIds: ["approvals"] },
  { id: "inventory", label: "Inventory", pageIds: ["inventory", "stock", "purchasing", "receiving", "suppliers", "requests", "transfers", "sponsorship"] },
  { id: "membership", label: "Membership", pageIds: ["members", "verifications"] },
  { id: "bookings", label: "Booking & services", pageIds: ["bookings", "pos-general-booking", "pos-racket-service"] },
  { id: "marketing", label: "Marketing", pageIds: ["promotions", "coupons"] },
  { id: "reports", label: "Reports", pageIds: ["reports", "alerts"] },
  { id: "settings", label: "Settings", pageIds: ["settings", "staff", "admin", "terminals", "settings-mobile-terminals", "database"] },
];
export type PermissionSection = (typeof PERMISSION_SECTIONS)[number];
const destinations = [
  ...navGroups.flatMap(group => group.items.map(item => ({ label: item.label, path: item.to, hash: item.hash }))),
  ...SETTINGS_CARDS.map(card => ({ label: card.label, path: card.to, hash: undefined })),
];
export const permissionPageLabel = (page: (typeof PERMISSION_PAGES)[number]) =>
  destinations.find(item => !item.hash && page.routes.includes(item.path))?.label ?? page.label;

export function permissionSubpages(id: string) {
  const page = PERMISSION_PAGES.find(item => item.id === id);
  const seen = new Set<string>();
  return destinations.filter(item => {
    const route = `${item.path}${item.hash ? `#${item.hash}` : ""}`;
    if (!page || pageForRoute(item.path.split("?")[0])?.id !== id || (!item.hash && page.routes.includes(item.path)) || seen.has(route)) return false;
    seen.add(route);
    return true;
  });
}
// Controls reused by a page but owned by another existing permission page.
// This affects editor placement only; pageAllowsAction's ownership is untouched.
const RELATED_CONTROLS: Record<string, PermissionKey[]> = {
  audit: ["can_export_reports"],
  shifts: ["can_view_sales_reports"],
  staff: ["can_access_pos_settings"],
  register: ["can_access_pos_settings", "can_add_member", "can_add_new_product", "can_edit_product_details", "can_hold_cart", "can_link_product_barcode", "can_manage_bookings", "can_open_shift", "can_reopen_held_order", "can_reprint_bill", "can_view_member_history"],
  receipts: ["can_edit_tenders"],
  bookings: ["can_access_pos_settings"],
  inventory: ["can_adjust_stock", "can_view_sales_reports"],
  purchasing: ["can_add_new_product", "can_edit_product_price"],
  "all-shops": ["can_export_reports", "can_view_inventory", "can_view_sales_reports"],
  dashboard: ["can_view_sales_reports"],
  analytics: ["can_export_reports", "can_view_sales_reports"],
  reports: ["can_view_audit_trail"],
  alerts: ["can_view_audit_trail"],
};
export const permissionRelatedKeys = (id: string): PermissionKey[] => RELATED_CONTROLS[id] ?? [];
export const PERMISSION_EDITOR_IDS = [
  ...PERMISSION_SECTIONS.map(section => `section:${section.id}`),
  ...PERMISSION_PAGES.map(page => page.id),
];
export function sectionVisibility(matrix: StaffPermissions, section: PermissionSection): boolean | "indeterminate" {
  const count = section.pageIds.filter(id => pageEnabled(matrix, id)).length;
  return count === section.pageIds.length ? true : count ? "indeterminate" : false;
}
export function setSectionVisibility(matrix: StaffPermissions, section: PermissionSection, visible: boolean): StaffPermissions {
  return section.pageIds.reduce((next, id) => setPageVisibility(next, id, visible), matrix);
}
export function permissionPageMatches(id: string, query: string): boolean {
  const page = PERMISSION_PAGES.find(item => item.id === id);
  return !!page && `${page.label} ${permissionPageLabel(page)} ${page.routes.join(" ")} ${permissionSubpages(id).map(item => item.label).join(" ")} ${[...page.keys, ...permissionRelatedKeys(id)].map(key => PERMISSION_LABELS[key]).join(" ")}`.toLowerCase().includes(query.trim().toLowerCase());
}

/** One editable home per persisted key; this does not alter backend ownership. */
export function permissionControlOwner(key: PermissionKey) {
  return PERMISSION_PAGES.find(page => page.keys.includes(key))!;
}
export function permissionEditableKeys(id: string): PermissionKey[] {
  return (PERMISSION_PAGES.find(page => page.id === id)?.keys ?? [])
    .filter(key => permissionControlOwner(key)?.id === id);
}
export function permissionReferenceKeys(id: string): PermissionKey[] {
  // Transfer actions share backend ownership with this queue, but do not grant
  // authority to decide its requests. Show approval rules instead.
  if (id === "approvals") return [];
  const page = PERMISSION_PAGES.find(page => page.id === id);
  return [...new Set([...(page?.keys ?? []), ...permissionRelatedKeys(id)])]
    .filter(key => permissionControlOwner(key)?.id !== id);
}
export function setEditablePageFeatures(matrix: StaffPermissions, id: string, enabled: boolean): StaffPermissions {
  return { ...matrix, ...Object.fromEntries(permissionEditableKeys(id).filter(key => !["can_use_management_pc", "can_use_management_mobile"].includes(key)).map(key => [key, enabled])) };
}

/** Entry requirements use the same registry as the route guard. Approval decisions
 * remain request/rule scoped; opening that queue grants no approval authority. */
export function permissionPageEntryKeys(id: string): PermissionKey[] {
  const page = PERMISSION_PAGES.find(page => page.id === id);
  if (!page || id === "approvals" || id === "register" || id === "display") return [];
  if (id === "reports") return ["can_view_sales_reports"];
  return [...new Set(page.routes.map(routePermissionForPath).filter(Boolean))] as PermissionKey[];
}

export function grantPageEntry(matrix: StaffPermissions, id: string): StaffPermissions {
  return { ...setPageVisibility(matrix, id, true),
    ...Object.fromEntries(permissionPageEntryKeys(id).map(key => [key, true])) };
}
