import { lazy, type ComponentType } from "react";
import { DownloadCloud } from "lucide-react";
import type { SettingsCard } from "@/lib/settings-catalog";
/** Included only by Android and Windows builds. */
export const UPDATE_SETTINGS_CARDS: SettingsCard[] = [{
  id: "updates", label: "Software updates",
  blurb: "App version, background updates and system health.",
  icon: DownloadCloud, category: "terminal", scope: "terminal", to: "/settings/updates",
  panel: lazy(async () => ({ default: (await import("@/routes/settings.updates")).Route.options.component as ComponentType })),
  keywords: "version upgrade rollback",
}];
export const UPDATE_SETTINGS_VISIBILITY = [
  ["/settings/updates", "Software updates", "App version and background updates.", "sensitive"],
];
