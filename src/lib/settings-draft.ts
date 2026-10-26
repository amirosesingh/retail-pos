import type { AppSettings } from "@/core/types/pos-types";
import { getPath, patchPaths, setPath } from "./settings-sections";

/** Only fields edited in this form may replace the latest saved settings. */
export function settingsDraftPatch(base: AppSettings, draft: AppSettings): Partial<AppSettings> {
  let patch: Record<string, unknown> = {};
  for (const path of patchPaths(draft as unknown as Record<string, unknown>)) {
    const next = getPath(draft, path);
    if (JSON.stringify(next) !== JSON.stringify(getPath(base, path))) patch = setPath(patch, path, next);
  }
  return patch as Partial<AppSettings>;
}
