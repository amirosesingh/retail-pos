import { describe, expect, it } from "vitest";
import { navGroups, routePermissionForPath } from "@/platforms/web/components/pos/nav-config";
import { SETTINGS_CARDS } from "../settings-catalog";

describe("navigation grouping", () => {
  it("keeps Selling at the existing register route", () => {
    expect(navGroups.flatMap(group => group.items).find(item => item.to === "/")?.label).toBe("Selling");
  });
  it("separates membership from staff and inventory", () => {
    expect(navGroups.find(group => group.id === "people")?.label).toBe("Membership");
    expect(navGroups.find(group => group.id === "people")?.items.map(item => item.to)).toEqual(["/members", "/verifications"]);
    expect(navGroups.flatMap(group => group.items).some(item => item.to === "/staff")).toBe(false);
    expect(SETTINGS_CARDS.find(card => card.id === "staff")?.category).toBe("people");
    expect(routePermissionForPath("/staff")).toBe("can_manage_staff");
  });
  it("keeps locations in Settings without weakening its permission", () => {
    expect(navGroups.find(group => group.id === "company")?.items.some(item => item.to === "/stores")).toBe(false);
    expect(SETTINGS_CARDS.find(card => card.to === "/stores")?.category).toBe("business");
    expect(routePermissionForPath("/stores")).toBe("can_manage_locations");
  });
  it("gives approvals and marketing their own destinations", () => {
    expect(navGroups.find(group => group.id === "inventory")?.items.some(item => ["/approvals", "/verifications"].includes(item.to))).toBe(false);
    expect(navGroups.find(group => group.id === "marketing")?.items.every(item => item.flag === "can_manage_promotions")).toBe(true);
    expect(navGroups.find(group => group.id === "approvals")?.hubTo).toBe("/approvals");
  });
});
