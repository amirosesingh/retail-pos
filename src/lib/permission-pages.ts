import definitions from "../../electron/permission-pages.json";
import type { PermissionKey, StaffPermissions } from "./permissions";
export type PagePermissionKey = `page:${string}`;
export const PERMISSION_PAGES = definitions as Array<{ id: string; label: string; routes: string[]; keys: PermissionKey[] }>;
export const pageKey = (id: string): PagePermissionKey => `page:${id}`;
/** Missing page flags preserve existing visibility; they never grant an action. */
export const pageEnabled = (matrix: Record<string, unknown>, id: string) => matrix[pageKey(id)] !== false;
export function pageForRoute(path: string) {
  const pathname = path.replace(/\/+$/, "") || "/";
  return PERMISSION_PAGES.flatMap(page => page.routes.map(route => ({ page, route })))
    .filter(({route}) => pathname === route || (route !== "/" && pathname.startsWith(route + "/")))
    .sort((a,b) => b.route.length - a.route.length)[0]?.page;
}
export function pageAllowsAction(matrix: Record<string, unknown>, key: string) {
  const owners = PERMISSION_PAGES.filter(page => page.keys.includes(key as PermissionKey));
  return !owners.length || owners.some(page => pageEnabled(matrix, page.id));
}
export function setPageFeatures(matrix: StaffPermissions, id: string, enabled: boolean): StaffPermissions {
  const page = PERMISSION_PAGES.find(item => item.id === id);
  if (!page || !pageEnabled(matrix, id)) return matrix;
  return { ...matrix, ...Object.fromEntries(page.keys.map(key => [key, enabled])) };
}
export function effectivePagePermissions(matrix: Record<string, boolean>): Record<string, boolean> {
  return Object.fromEntries(Object.entries(matrix).map(([key, value]) => [key, value === true && pageAllowsAction(matrix, key)]));
}

export function setPageVisibility(matrix: StaffPermissions, id: string, visible: boolean): StaffPermissions {
  const page = PERMISSION_PAGES.find(item => item.id === id);
  if (!page) return matrix;
  return { ...matrix, ...(!visible ? Object.fromEntries(page.keys.map(key => [key, false])) : {}), [pageKey(id)]: visible };
}
