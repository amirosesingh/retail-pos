import { describe, expect, it } from "vitest";
import { PERMISSION_KEYS, NO_PERMISSIONS, hasPermission, normalizePermissions } from "../permissions";
import { PERMISSION_PAGES, pageForRoute, pageEnabled, setPageFeatures, setPageVisibility, effectivePagePermissions } from "../permission-pages";
import { beginUpdateOperation, setUpdateTicketBusy, updateRestartSafe } from "../update-safety";

describe("page visibility and execution permissions", () => {
  it("assigns every existing action to a page without adding new grants", () => {
    expect(new Set(PERMISSION_PAGES.map(page => page.id)).size).toBe(PERMISSION_PAGES.length);
    const keys = new Set(PERMISSION_PAGES.flatMap(page => page.keys));
    expect([...keys].sort()).toEqual([...PERMISSION_KEYS].sort());
    expect(hasPermission({...NO_PERMISSIONS, 'page:register':true}, 'can_process_sale')).toBe(false);
  });
  it("preserves explicit page choices through normalization and denies action execution", () => {
    const permissions = normalizePermissions({can_process_sale:true,'page:register':false},'cashier');
    expect(permissions['page:register']).toBe(false);
    expect(hasPermission({permissions}, 'can_process_sale')).toBe(false);
    expect(effectivePagePermissions(permissions).can_process_sale).toBe(false);
  });
  it("matches direct and nested URLs using the most specific page", () => {
    expect(pageForRoute('/inventory/item/123')?.id).toBe('inventory');
    expect(pageForRoute('/settings/database/')?.id).toBe('database');
    expect(pageEnabled({'page:database':false},pageForRoute('/settings/database/')!.id)).toBe(false);
    expect(pageForRoute('/inventory-other')).toBeUndefined();
  });
  it("select all and deselect all affect only the chosen visible section", () => {
    const all = setPageFeatures({...NO_PERMISSIONS}, 'register', true);
    const hidden = setPageVisibility(all, "register", false);
    expect(hidden.can_process_sale).toBe(false);
    expect(setPageVisibility(hidden, "register", true).can_process_sale).toBe(false);
    expect(all.can_process_sale).toBe(true);expect(all.can_manage_staff).toBe(false);
    expect(setPageFeatures(all,'register',false).can_process_sale).toBe(false);
    expect(setPageFeatures({...NO_PERMISSIONS,'page:register':false},'register',true).can_process_sale).toBe(false);
  });
});
describe("update safety", () => {
  it("waits for the cart and every critical operation, with idempotent completion", () => {
    setUpdateTicketBusy(true);const first=beginUpdateOperation();const second=beginUpdateOperation();
    expect(updateRestartSafe()).toBe(false);setUpdateTicketBusy(false);first();first();expect(updateRestartSafe()).toBe(false);second();expect(updateRestartSafe()).toBe(true);
  });
});
