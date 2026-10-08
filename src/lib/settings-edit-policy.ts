import { sectionAllowsTier, type SettingsSectionId } from "./settings-sections";
import type { SettingSource } from "./branch-settings";

export function canEditSettingsScope(
  source: SettingSource,
  isAdmin: boolean,
  permitted: boolean,
  locked: boolean,
): boolean {
  if (isAdmin) return source === "GLOBAL" || !locked;
  return permitted && !locked && source === "BRANCH";
}

/** Staff edits create a branch override; inherited values never become global writes. */
export function staffSettingsTarget(
  section: SettingsSectionId | null,
  permitted: boolean,
  branchId: string,
  locked: boolean,
): "BRANCH" {
  if (!permitted) throw new Error("Branch settings permission is required.");
  if (!branchId) throw new Error("Select a branch before editing its settings.");
  if (!section || !sectionAllowsTier(section, "BRANCH"))
    throw new Error("This setting is controlled by an administrator.");
  if (locked) throw new Error("This setting is locked by an administrator.");
  return "BRANCH";
}
