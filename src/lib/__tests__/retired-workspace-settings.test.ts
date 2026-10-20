import { expect, it } from "vitest";
import { withoutWorkspacePurpose } from "../retired-workspace-settings";
import { navGroups, routePermissionForPath } from "@/platforms/web/components/pos/nav-config";

it("drops only retired preferences and leaves the original settings untouched", () => {
  const input = { terminalPurpose: "management", terminalPurposeOverride: "warehouse", sellingLayout: "standard", receiptPrinter: "counter" };
  expect(withoutWorkspacePurpose(input)).toEqual({ sellingLayout: "standard", receiptPrinter: "counter" });
  expect(input.terminalPurpose).toBe("management");
});

it("moves links without changing their route permissions", () => {
  const home = navGroups.find(group => group.id === "company")!;
  expect(home.items.map(item => item.to)).toEqual(expect.arrayContaining(["/dashboard", "/analytics", "/all-shops", "/stores"]));
  expect(home.items.some(item => item.to === "/audit")).toBe(false);
  expect(navGroups.find(group => group.id === "reports")!.items.some(item => item.to === "/audit")).toBe(true);
  expect(routePermissionForPath("/audit")).toBe("can_view_audit_trail");
  expect(routePermissionForPath("/dashboard")).toBe("can_view_dashboard");
  expect(routePermissionForPath("/stores")).toBe("can_manage_locations");
});
