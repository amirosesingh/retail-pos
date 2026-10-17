import { describe, expect, it } from "vitest";
import { roleStartingPermissions } from "../role-defaults";
import { NO_PERMISSIONS, rolePermissions } from "../permissions";

describe("saved role defaults for new assignments", () => {
 it("uses saved built-in defaults including page visibility instead of the shipped preset", () => {
  const saved = {...NO_PERMISSIONS,can_process_sale:true,"page:inventory":false,"page:future":false};
  const result = roleStartingPermissions([{slug:"cashier",permissions:saved}],"cashier");
  expect(result).toEqual(saved);
  expect(result.can_manage_staff).toBe(false);
 });
 it("returns an independent copy without changing existing users or the saved template", () => {
  const saved = {...NO_PERMISSIONS,can_process_sale:true};
  const result = roleStartingPermissions([{slug:"cashier",permissions:saved}],"cashier");
  result.can_process_sale=false;
  expect(saved.can_process_sale).toBe(true);
 });
 it("retains the shipped preset fallback when the built-in role is absent", () => {
  expect(roleStartingPermissions([],"warehouse")).toEqual(rolePermissions("warehouse"));
 });
});
