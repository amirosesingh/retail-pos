import { pageForRoute, PERMISSION_PAGES } from "./permission-pages";
import { VISIBILITY_ELEMENTS } from "./ui-visibility";
import { TABLE_CATALOG } from "./table-catalog";
import { SETTINGS_CARDS } from "./settings-catalog";

export function elementPermissionPage(item: (typeof VISIBILITY_ELEMENTS)[number]) {
  if (item.route) return pageForRoute(item.route)?.id ?? "settings";
  if (item.key.startsWith("inventory.")) return "inventory";
  if (item.key.startsWith("dashboard.")) return "dashboard";
  if (item.key.startsWith("shiftclose.")) return "shifts";
  return "register";
}
export function tablePermissionPage(id: string): string {
  if (id.startsWith("routes/")) {
    const path = id.slice(7).split("#")[0]!.replace(/\.native$/, "").replace(/\.(index|\$id)$/, "").replaceAll(".", "/");
    const page = pageForRoute(`/${path}`);
    if (page) return page.id;
  }
  const component = id.split("/").at(-1) ?? "";
  if (/MemberHistory/.test(component)) return "members";
  if (/StaffManager/.test(component)) return "staff";
  if (/LocalDatabase/.test(component)) return "database";
  if (/TerminalTokens/.test(component)) return "terminals";
  if (/Transfer/.test(component)) return "transfers";
  if (/Receiving/.test(component)) return "receiving";
  if (/BulkImport|StockCount|ProductPicker/.test(component)) return "inventory";
  if (/CampaignVouchers|Coupon/.test(component)) return "coupons";
  if (/Report|Telemetry/.test(component)) return id.includes("/settings/") ? "settings" : "reports";
  return "settings";
}
export function displayElementGroup(item: (typeof VISIBILITY_ELEMENTS)[number]) {
  return item.route ? SETTINGS_CARDS.find(card => card.to === item.route)?.category ?? "Other settings" : item.group;
}
export function permissionDisplayMatches(id: string, query: string) {
  const text = query.trim().toLowerCase();
  return VISIBILITY_ELEMENTS.some(item => elementPermissionPage(item) === id && `${item.label} ${item.blurb} ${item.group}`.toLowerCase().includes(text)) ||
    TABLE_CATALOG.some(table => tablePermissionPage(table.id) === id && `${table.title} ${table.columns.join(" ")}`.toLowerCase().includes(text));
}
export const displayElementsForPage = (id?: string) => VISIBILITY_ELEMENTS.filter(item =>
  !PERMISSION_PAGES.some(page => page.routes.includes(item.route ?? "")) && (!id || elementPermissionPage(item) === id));
