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

  it("does not duplicate inherited values when an empty child scope is selected", () => {
    const base = { tax: { rate: 5 } };
    const out = resolveScopedSettings(
      base,
      scope({ overrides: { CLUSTER: {}, BRANCH: { tax: {} }, TERMINAL: {} } }),
      (target, patch) => ({
        ...target,
        tax: { ...target.tax, ...((patch as { tax?: object }).tax ?? {}) },
      }),
    );
    expect(out.settings.tax.rate).toBe(5);
    expect(
      scope({ overrides: { CLUSTER: {}, BRANCH: { tax: {} }, TERMINAL: {} } }).overrides.BRANCH.tax,
    ).toEqual({});
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
    ["integrations.terminalPurpose", "workspace"],
    ["integrations.sellingLayout", "workspace"],
  ])("routes %s to only the %s block", (path, section) => {
    expect(sectionOfPath(path)?.id).toBe(section);
  });

  it("keeps workspace choices in the terminal settings family", () => {
    expect(sectionOfPath("integrations.terminalPurpose")?.scopeFamily).toBe("terminal");
    expect(sectionOfPath("integrations.sellingLayout")?.scopeFamily).toBe("terminal");
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

  it("keeps a saved ownership patch and starts a new owner empty", () => {
    const store = read("src/lib/pos-store.tsx");
    expect(store).toContain("Re-selecting a tier must keep its saved values");
    expect(store).toContain("scopeRef.current.overrides[tier][section] ?? {}");
    expect(store).not.toContain("pickSection(");
  });

  it("uses resolved settings when generating scoped stock references", () => {
    const store = read("src/lib/pos-store.tsx");
    const transfer = store.slice(
      store.indexOf("const createTransfer = useCallback"),
      store.indexOf("createTransferRef.current = createTransfer"),
    );
    expect(transfer).toContain("resolveScopedSettings(");
    expect(transfer).toContain("scopeRef.current");
    expect(transfer).not.toContain("stateRef.current.settings.integrations");
  });

  it("writes zero-stock lifecycle configuration only to the global record", () => {
    const catalog = read("src/routes/settings.catalog.tsx");
    expect(catalog).toContain("configuredGlobalSettings.integrations.autoArchiveZeroStock");
    expect(catalog).toContain("updateGlobalSettings({");
    expect(catalog).not.toContain("patchProducts(");
  });

  it("uses Store consistently in the inheritance interface while retaining BRANCH storage", () => {
    const controls = read("src/platforms/web/components/pos/settings/ScopeControls.tsx");
    const resolver = read("src/lib/branch-settings.ts");

    expect(controls).toContain('`Store: ${currentStore.name}`');
    expect(controls).not.toContain('`Branch: ${currentStore.name}`');
    expect(resolver).toContain('BRANCH: "Store"');
    expect(resolver).toContain('match: { scope: tier, scope_id: scopeId }');
  });
});

it("retires only a removed terminal's own overrides in the database", () => {
  const migration = readFileSync(
    "supabase/migrations/20261007152914_cleanup_revoked_terminal_settings.sql", "utf8",
  );
  expect(migration).toContain("BEFORE UPDATE OF status, revoked_at ON public.terminal_tokens");
  expect(migration).toContain("BEFORE DELETE ON public.terminal_tokens");
  for (const table of ["settings_overrides", "settings_scoped"]) {
    expect(migration).toContain(`DELETE FROM public.${table}`);
  }
  expect(migration.match(/lower\(scope\) = 'terminal' AND scope_id = OLD\.id::text/g))
    .toHaveLength(2);
  expect(migration).not.toMatch(/DELETE FROM public\.settings_locks/);
});

it("aligns base and scoped settings writes with the settings permission", () => {
  const migration = readFileSync(
    "supabase/migrations/20261008133000_align_scoped_settings_permissions.sql", "utf8",
  );
  expect(migration).toContain("WHEN 'global' THEN public.has_perm('can_access_pos_settings')");
  expect(migration).toContain("AND public.settings_scope_visible(p_scope,p_scope_id)");
  expect(migration.match(/has_perm\('can_access_pos_settings'\)/g)?.length).toBeGreaterThanOrEqual(6);
  expect(migration).toContain('DROP POLICY IF EXISTS "Staff can update" ON public.pos_settings');
  expect(migration).toContain('CREATE POLICY "Settings managers can update"');
  expect(migration).not.toContain("public.is_supervisor_now() AND public.settings_scope_visible");
});
