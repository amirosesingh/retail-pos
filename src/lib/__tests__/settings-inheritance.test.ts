/**
 * Settings inheritance follows the section's organizational family, and a
 * globally locked section cannot be overridden by anyone.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

import {
  emptyBranchSettings,
  resolveScopedSettings,
  type BranchSettingsState,
} from "../branch-settings";
import { SETTINGS_SECTIONS, sectionOfPath } from "../settings-sections";

type Bag = Record<string, unknown>;
const merge = (target: Bag, patch: unknown) => ({ ...target, ...(patch as Bag) });

const scope = (over: Partial<BranchSettingsState>): BranchSettingsState => ({
  ...emptyBranchSettings,
  ...over,
  overrides: { ...emptyBranchSettings.overrides, ...(over.overrides ?? {}) },
  locks: { ...(over.locks ?? {}) },
});

describe("resolveScopedSettings", () => {
  it("returns the base record untouched when no scope overrides anything", () => {
    const base = { taxRate: 5 };
    const out = resolveScopedSettings(base, emptyBranchSettings, merge);
    expect(out.touched).toBe(false);
    expect(out.settings).toBe(base);
  });

  it("lets a cluster override the global record", () => {
    const out = resolveScopedSettings(
      { taxRate: 5 },
      scope({ overrides: { CLUSTER: { tax: { taxRate: 7 } }, BRANCH: {}, TERMINAL: {} } }),
      merge,
    );
    expect(out.settings.taxRate).toBe(7);
    expect(out.touched).toBe(true);
  });

  it("lets a branch beat its cluster", () => {
    const out = resolveScopedSettings(
      { taxRate: 5 },
      scope({
        overrides: {
          CLUSTER: { tax: { taxRate: 7 } },
          BRANCH: { tax: { taxRate: 9 } },
          TERMINAL: {},
        },
      }),
      merge,
    );
    expect(out.settings.taxRate).toBe(9);
  });

  it("ignores terminal overrides for business settings", () => {
    const out = resolveScopedSettings(
      { taxRate: 5 },
      scope({
        overrides: {
          CLUSTER: { tax: { taxRate: 7 } },
          BRANCH: { tax: { taxRate: 9 } },
          TERMINAL: { tax: { taxRate: 11 } },
        },
      }),
      merge,
    );
    expect(out.settings.taxRate).toBe(9);
  });

  it("ignores every tier for a locked section", () => {
    const out = resolveScopedSettings(
      { taxRate: 5 },
      scope({
        overrides: {
          CLUSTER: { tax: { taxRate: 7 } },
          BRANCH: { tax: { taxRate: 9 } },
          TERMINAL: {},
        },
        locks: { tax: true } as never,
      }),
      merge,
    );
    expect(out.settings.taxRate).toBe(5);
    expect(out.touched).toBe(false);
  });

  it("keeps unlocked sections working while another one is locked", () => {
    const out = resolveScopedSettings(
      { taxRate: 5, receiptFooter: "" },
      scope({
        overrides: {
          CLUSTER: {},
          BRANCH: { tax: { taxRate: 9 }, receiptIdentity: { receiptFooter: "Thanks" } },
          TERMINAL: {},
        },
        locks: { tax: true } as never,
      }),
      merge,
    );
    expect(out.settings.taxRate).toBe(5);
    expect(out.settings.receiptFooter).toBe("Thanks");
  });
});

it("resolves terminal settings above clusters and ignores branch settings", () => {
  const base = { printer: "global" };
  const shared = scope({
    overrides: {
      ...emptyBranchSettings.overrides,
      CLUSTER: { printer: { printer: "cluster" } },
      BRANCH: { printer: { printer: "branch" } },
    },
  });
  const terminal = scope({
    overrides: {
      ...shared.overrides,
      TERMINAL: { printer: { printer: "terminal" } },
    },
  });
  expect(resolveScopedSettings(base, terminal, merge).settings.printer).toBe("terminal");
  expect(resolveScopedSettings(base, shared, merge).settings.printer).toBe("cluster");
  expect(base.printer).toBe("global");
});

describe("settings section ownership", () => {
  it.each([
    ["receipt.companyName", "receiptIdentity"],
    ["receipt.logo", "receiptIdentity"],
    ["receipt.customLines", "receiptIdentity"],
    ["receipt.paper", "receiptLayout"],
    ["receipt.logoLayout", "receiptLayout"],
    ["receipt.fonts.header", "receiptLayout"],
    ["integrations.bookingRules", "booking"],
    ["integrations.paymentAccounts", "paymentAccounts"],
    ["integrations.billNumbering", "numbering"],
    ["integrations.stockNumbering", "stockNumbering"],
    ["integrations.country", "region"],
    ["integrations.rounding", "rounding"],
  ])("routes %s to only the %s block", (path, section) => {
    expect(sectionOfPath(path)?.id).toBe(section);
  });

  it("does not let a terminal receipt layout snapshot capture branch identity", () => {
    const layout = SETTINGS_SECTIONS.find((section) => section.id === "receiptLayout");
    expect(layout?.paths).not.toContain("receipt");
    expect(layout?.paths).not.toContain("receipt.companyName");
    expect(sectionOfPath("receipt.companyName")?.scopeFamily).toBe("business");
    expect(sectionOfPath("receipt.logo")?.scopeFamily).toBe("business");
    expect(sectionOfPath("receipt.paper")?.scopeFamily).toBe("terminal");
  });

  it("ignores a logo image left inside a legacy terminal layout override", () => {
    const out = resolveScopedSettings(
      { receipt: { logo: "business-logo", showLogo: true } },
      scope({
        overrides: {
          ...emptyBranchSettings.overrides,
          TERMINAL: {
            receiptLayout: { receipt: { logo: "legacy-terminal-logo", showLogo: false } },
          },
        },
      }),
      (target, patch) => ({
        ...target,
        receipt: {
          ...target.receipt,
          ...((patch as { receipt?: object }).receipt ?? {}),
        },
      }),
    );
    expect(out.settings.receipt.logo).toBe("business-logo");
    expect(out.settings.receipt.showLogo).toBe(false);
  });
});

describe("central settings ownership UI", () => {
  const read = (path: string) => readFileSync(path, "utf8");

  it("keeps every ownership selector on the inheritance page", () => {
    const inheritance = read(
      "src/platforms/web/components/pos/settings/panels/InheritancePanel.tsx",
    );
    const frame = read("src/platforms/web/components/pos/settings/SettingsFrame.tsx");
    const rules = read("src/routes/settings.rules.tsx");
    const system = read("src/platforms/web/components/pos/settings/panels/SystemStatusPanel.tsx");
    const settingsRoutes = readdirSync("src/routes")
      .filter((file) => file.startsWith("settings.") && file.endsWith(".tsx"))
      .map((file) => read(`src/routes/${file}`));

    expect(inheritance.match(/<ScopePanel/g)).toHaveLength(2);
    expect(frame).not.toContain("scopeSections");
    expect(rules).not.toContain("<ScopePanel");
    expect(system).not.toContain("<ScopePanel");
    expect(settingsRoutes.some((source) => source.includes("scopeSections"))).toBe(false);
    expect(settingsRoutes.some((source) => source.includes("<ScopePanel"))).toBe(false);
  });

  it("keeps a centrally selected terminal active while its value page opens", () => {
    const controls = read("src/platforms/web/components/pos/settings/ScopeControls.tsx");
    expect(controls).not.toContain('setSettingsTerminalId("");');
    expect(controls).toContain("sectionRoutes?.[id]");
    expect(controls).toContain(">Edit values</Link>");
  });
});
