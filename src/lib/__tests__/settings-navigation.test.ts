/**
 * The settings map has to stay honest: every page belongs to exactly one live
 * category, every category to a heading, and the folded navigation has to
 * remember what was left open.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  SETTINGS_CARDS,
  SETTINGS_CATEGORIES,
  SETTINGS_GROUPS,
  settingsCatalogDuplicates,
  settingsCardForStaffAccess,
} from "@/lib/settings-catalog";
import {
  initialOpenCategories,
  readOpenCategories,
} from "@/platforms/web/components/pos/settings/SettingsNavTree";
import { settingsCoverage } from "@/lib/settings-groups";
import { matchSettings } from "@/platforms/web/components/pos/settings/use-settings-nav";

describe("settings categories", () => {
  it("preserves policy access without granting staff management", () => {
    const card = SETTINGS_CARDS.find(card => card.id === "rules")!;
    expect(settingsCardForStaffAccess(card, false).to).toBe("/settings/rules");
    expect(settingsCardForStaffAccess(card, true).to).toBe("/staff?tab=policies");
    const accounts = SETTINGS_CARDS.find(card => card.id === "staff")!;
    expect(settingsCardForStaffAccess(accounts, false)).toBe(accounts);
  });
  it("gives every page a live category", () => {
    const live = new Set(SETTINGS_CATEGORIES.map((c) => c.id));
    for (const card of SETTINGS_CARDS) {
      expect(live.has(card.category), `${card.id} → ${card.category}`).toBe(true);
    }
  });

  it("leaves no category empty and none under a missing heading", () => {
    const headings = new Set(SETTINGS_GROUPS.map((g) => g.id));
    for (const category of SETTINGS_CATEGORIES) {
      expect(headings.has(category.group), category.id).toBe(true);
      expect(
        SETTINGS_CARDS.some((c) => c.category === category.id),
        `${category.id} has no pages`,
      ).toBe(true);
    }
  });

  it("keeps every page reachable exactly once", () => {
    expect(settingsCatalogDuplicates()).toEqual([]);
    expect(new Set(SETTINGS_CARDS.map((c) => c.id)).size).toBe(SETTINGS_CARDS.length);
  });

  it("still finds every page by its own name", () => {
    for (const card of SETTINGS_CARDS) {
      const hits = matchSettings(SETTINGS_CARDS, card.label);
      expect(hits.map((h) => h.id)).toContain(card.id);
    }
  });

  it("has no missing live pages or broken catalogue destinations", () => {
    expect(settingsCoverage()).toEqual({ uncovered: [], dangling: [] });
  });

  it("places transaction policies together and keeps retired routes out of search", () => {
    for (const id of ["tax", "numbering", "stock-numbering", "sku"]) {
      expect(SETTINGS_CARDS.find(card => card.id === id)?.category).toBe("pos-rules");
    }
    expect(SETTINGS_CARDS.find(card => card.id === "rules")).toMatchObject({ category: "people", to: "/staff?tab=policies" });
    expect(matchSettings(SETTINGS_CARDS, "access").some(card => card.to === "/staff")).toBe(true);
    expect(SETTINGS_CARDS.some(card => card.to === "/settings/workspace")).toBe(false);
  });

  it("keeps security with health and delivery preferences separate", () => {
    for (const id of ["logic-health", "security-alerts"]) expect(SETTINGS_CARDS.find(card => card.id === id)?.category).toBe("health");
    expect(SETTINGS_CARDS.find(card => card.id === "notifications")?.category).toBe("notifications");
    expect(SETTINGS_CARDS.some(card => card.id === "shift-alerts")).toBe(false);
  });

  it("does not report compatibility redirects as missing workspace pages", () => {
    const coverage = settingsCoverage();
    expect(coverage.uncovered).not.toContain("/settings/database-explorer");
    expect(coverage.uncovered).not.toContain("/settings/sync");
  });
});

describe("folded navigation", () => {
  beforeEach(() => globalThis.localStorage?.clear());

  it("opens the category holding the current page on a fresh device", () => {
    expect(initialOpenCategories(null, "payments")).toEqual({ payments: true });
  });

  it("remembers what was left open and still opens the current one", () => {
    const stored = { business: true, payments: false };
    expect(initialOpenCategories(stored, "payments")).toEqual({
      business: true,
      payments: true,
    });
  });

  it("survives a device with nothing stored", () => {
    expect(readOpenCategories()).toBeNull();
    expect(initialOpenCategories(readOpenCategories())).toEqual({});
  });
});
