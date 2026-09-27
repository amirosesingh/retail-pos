/**
 * Scoped settings overrides and global locks.
 *
 * A scope only stores the blocks it actually overrides; everything else
 * resolves down the chain and finally to the shipped defaults. Resolution
 * Business sections resolve Branch > Cluster > Global. Terminal sections
 * resolve Terminal > Cluster > Global. Locks are
 * global and stop any scope from overriding a block at all.
 */
import { dbRouter } from "@/core/api/db-router";
import { sectionAllowsTier, type SettingsSectionId } from "./settings-sections";

export type SectionPatch = Record<string, unknown>;

/** Override tiers, weakest first. Global is the base record, not a tier. */
export const SETTING_TIERS = ["CLUSTER", "BRANCH", "TERMINAL"] as const;
export type SettingTier = (typeof SETTING_TIERS)[number];
export type SettingSource = "GLOBAL" | SettingTier;

export const TIER_LABELS: Record<SettingSource, string> = {
  GLOBAL: "Global",
  CLUSTER: "Cluster",
  BRANCH: "Branch",
  TERMINAL: "Terminal",
};

export type ScopeIds = { CLUSTER: string; BRANCH: string; TERMINAL: string };

export const emptyScopeIds: ScopeIds = { CLUSTER: "", BRANCH: "", TERMINAL: "" };

export type TierOverrides = Partial<Record<SettingsSectionId, SectionPatch>>;

export type BranchSettingsState = {
  /** tier -> section id -> the patch that tier applies */
  overrides: Record<SettingTier, TierOverrides>;
  /** section id -> locked globally */
  locks: Partial<Record<SettingsSectionId, boolean>>;
};

export const emptyBranchSettings: BranchSettingsState = {
  overrides: { CLUSTER: {}, BRANCH: {}, TERMINAL: {} },
  locks: {},
};

type OverrideRow = { section: string; patch: unknown };
type LockRow = { section: string; locked: boolean };

/** Overrides for every tier this terminal belongs to, plus the lock table. */
export async function loadBranchSettings(
  ids: ScopeIds,
  strict = false,
): Promise<BranchSettingsState> {
  const state: BranchSettingsState = {
    overrides: { CLUSTER: {}, BRANCH: {}, TERMINAL: {} },
    locks: {},
  };
  try {
    const reads = await Promise.all([
      ...SETTING_TIERS.map(async (tier) => {
        const scopeId = ids[tier];
        if (!scopeId) return { tier, rows: [] as OverrideRow[] };
        const rows = await dbRouter.query("settings_overrides", {
          columns: "section,patch",
          match: { scope: tier, scope_id: scopeId },
          orderBy: { column: "section", ascending: true },
          limit: 200,
        });
        return { tier, rows: rows as unknown as OverrideRow[] };
      }),
    ]);
    for (const { tier, rows } of reads) {
      for (const row of rows) {
        if (row.patch && typeof row.patch === "object") {
          state.overrides[tier][row.section as SettingsSectionId] = row.patch as SectionPatch;
        }
      }
    }
    const locks = await dbRouter.query("settings_locks", {
      columns: "section,locked",
      orderBy: { column: "section", ascending: true },
      limit: 200,
    });
    for (const row of locks as unknown as LockRow[]) {
      state.locks[row.section as SettingsSectionId] = !!row.locked;
    }
  } catch (error) {
    if (strict) throw error;
    /* offline or not granted yet — the global record still applies */
  }
  return state;
}

export async function saveSectionOverride(
  tier: SettingTier,
  scopeId: string,
  section: SettingsSectionId,
  patch: SectionPatch,
  updatedBy: string,
): Promise<void> {
  if (!scopeId)
    throw new Error(`No ${TIER_LABELS[tier].toLowerCase()} is selected for this terminal`);
  await dbRouter.upsert(
    "settings_overrides",
    {
      scope: tier,
      scope_id: scopeId,
      section,
      patch: patch as never,
      updated_by: updatedBy,
    },
    "scope,scope_id,section",
    "Saving a settings override",
  );
}

export async function clearSectionOverride(
  tier: SettingTier,
  scopeId: string,
  section: SettingsSectionId,
): Promise<void> {
  if (!scopeId) return;
  await dbRouter.write("Clearing a settings override", [
    {
      kind: "delete",
      table: "settings_overrides",
      match: { scope: tier, scope_id: scopeId, section },
    },
  ]);
}

export async function setSectionLock(
  section: SettingsSectionId,
  locked: boolean,
  updatedBy: string,
): Promise<void> {
  await dbRouter.upsert(
    "settings_locks",
    { section, locked, updated_by: updatedBy },
    "section",
    "Locking a settings section",
  );
}

/**
 * Resolve a settings record through the override chain.
 *
 * Weakest tier first, so a stronger tier always wins on the same path, and a
 * globally locked section is skipped entirely: nobody can override it.
 * Kept pure so the precedence rules can be tested on their own.
 */
export function resolveScopedSettings<T>(
  base: T,
  scope: BranchSettingsState,
  merge: (target: T, patch: unknown) => T,
): { settings: T; touched: boolean } {
  let settings = base;
  let touched = false;
  for (const tier of SETTING_TIERS) {
    for (const key of Object.keys(scope.overrides[tier] ?? {}) as SettingsSectionId[]) {
      if (scope.locks[key] || !sectionAllowsTier(key, tier)) continue;
      let patch = scope.overrides[tier][key];
      if (key === "receiptLayout") {
        // Logo ownership moved to the business identity block. Ignore only
        // the legacy terminal copy while retaining every real layout field.
        const receipt = patch?.receipt;
        if (receipt && typeof receipt === "object" && !Array.isArray(receipt)) {
          const cleanReceipt = { ...(receipt as Record<string, unknown>) };
          delete cleanReceipt.logo;
          patch = { ...patch, receipt: cleanReceipt };
        }
      }
      settings = merge(settings, patch);
      touched = true;
    }
  }
  return { settings, touched };
}
