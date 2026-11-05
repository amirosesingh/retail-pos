import { describe, expect, it } from "vitest";
import { hasPermission, NO_PERMISSIONS, type StaffPermissions } from "../permissions";
import { userRouteVisible } from "../ui-visibility";
import { permittedSettingsCards } from "@/platforms/web/components/pos/settings/use-settings-nav";

function cardsFor(permissions: StaffPermissions) {
  const subject = { role: "cashier", roleSlug: "supervisor", permissions };
  return permittedSettingsCards(false, flag => hasPermission(subject, flag), path => userRouteVisible({}, path, "supervisor", permissions));
}
const appearanceOnly = () => ({ ...NO_PERMISSIONS, "page:settings": true, can_customize_display: true, can_access_pos_settings: false }) as StaffPermissions;

describe("settings hub with independent personal permissions", () => {
  it("exposes Appearance for an all-branch supervisor without granting business configuration", () => {
    const permissions = appearanceOnly();
    expect(cardsFor(permissions).map(card => card.id)).toEqual(["display"]);
    expect(hasPermission({ role: "cashier", permissions }, "can_access_pos_settings")).toBe(false);
    expect(permissions.can_access_pos_settings).toBe(false);
  });
  it("does not bypass a hidden Settings page or explicitly hidden Appearance screen", () => {
    expect(cardsFor({ ...appearanceOnly(), "page:settings": false })).toEqual([]);
    expect(cardsFor({ ...appearanceOnly(), "display:route:/settings/display": false }).some(card => card.id === "display")).toBe(false);
  });
  it("does not interpret page visibility as action authority", () => {
    expect(cardsFor({ ...appearanceOnly(), can_customize_display: false })).toEqual([]);
  });
  it("exposes authorized terminal tools without exposing business or notification routing settings", () => {
    const cards = cardsFor({ ...appearanceOnly(), can_customize_display: false, can_manage_terminals: true });
    expect(cards.some(card => card.to === "/settings/terminals")).toBe(true);
    expect(cards.some(card => ["identity", "tax", "notifications", "database"].includes(card.id))).toBe(false);
  });
});
