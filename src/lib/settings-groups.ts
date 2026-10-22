/**
 * Unified settings groups.
 *
 * Settings used to be described twice — once by the card workspace and once by
 * the sub-tab strips — and the two drifted: a page could be a tab with no card,
 * unreachable from the workspace and invisible to search. Groups now hold only
 * ordering: which areas belong together and in what order. Every label and
 * blurb is resolved from `SETTINGS_CARDS`, so a tab and its card can no longer
 * disagree.
 *
 * The tabs are still real routes, so deep links, settings search and the
 * browser back button all keep working.
 */
import { SETTINGS_CARDS, settingsCard } from "./settings-catalog";

export type SettingsTab = {
  to: string;
  label: string;
  blurb: string;
  /** Intentionally reachable from two parents — not a duplicate. */
  shared?: boolean;
  /**
   * System diagnostics render inside `/settings/system?tab=<id>` instead of
   * their own page, so the whole area reads as one window.
   */
  tab?: SystemTabId;
};

export type SettingsGroup = {
  id: string;
  label: string;
  blurb: string;
  tabs: SettingsTab[];
};

/** A member of a group, named by the catalogue id it takes its wording from. */
type GroupMember = { card: string; shared?: boolean };

type GroupSpec = {
  id: string;
  label: string;
  blurb: string;
  members: GroupMember[];
};

const GROUP_SPECS: GroupSpec[] = [
  {
    id: "pos-rules",
    label: "POS rules",
    blurb: "Every transaction, register, tax and cashier policy in one place.",
    members: [
      { card: "rules" },
      { card: "tax" },
      { card: "numbering" },
      { card: "stock-numbering" },
      { card: "sku" },
    ],
  },
  {
    id: "receipts",
    label: "Receipts & printing",
    blurb: "The printer itself and everything that prints on a slip.",
    members: [
      { card: "printer" },
      { card: "elements" },
      { card: "type" },
      { card: "lines" },
      { card: "qr" },
      { card: "receipt-designer" },
      { card: "booking-slip", shared: true },
    ],
  },
  {
    id: "booking-rules",
    label: "Booking rules",
    blurb: "Scheduling, deposits, turnaround and cancellation in one place.",
    members: [
      { card: "booking-rules" },
      { card: "services" },
      { card: "booking-slip", shared: true },
    ],
  },
  {
    id: "system",
    label: "System & general",
    blurb: "Online connection, security and code health.",
    members: [
      { card: "system" },
      { card: "logic-health", shared: true },
      { card: "security-alerts", shared: true },
      { card: "database", shared: true },
      { card: "inheritance", shared: true },
    ],
  },
];

/** Tabs of the System & general hub, rendered in place rather than as routes. */
export const SYSTEM_TAB_IDS = ["system", "logic-health", "security-alerts", "inheritance"] as const;

export type SystemTabId = (typeof SYSTEM_TAB_IDS)[number];

/** Split `/settings/system?tab=logic-health` into its route and its tab. */
function splitTarget(to: string): { to: string; tab?: SystemTabId } {
  const [path, query] = to.split("?");
  const tab = query ? new URLSearchParams(query).get("tab") : null;
  return tab && (SYSTEM_TAB_IDS as readonly string[]).includes(tab)
    ? { to: path as string, tab: tab as SystemTabId }
    : { to: path as string };
}

function buildGroups(): SettingsGroup[] {
  return GROUP_SPECS.map((spec) => ({
    id: spec.id,
    label: spec.label,
    blurb: spec.blurb,
    tabs: spec.members.flatMap((member): SettingsTab[] => {
      const card = settingsCard(member.card);
      // A group can only name an area the catalogue describes, so a tab
      // pointing at a page nobody owns simply cannot be built.
      if (!card) return [];
      const target = splitTarget(card.to);
      return [
        {
          to: target.to,
          ...(target.tab ? { tab: target.tab } : {}),
          label: card.label,
          blurb: card.blurb,
          ...(member.shared ? { shared: true } : {}),
        },
      ];
    }),
  }));
}

export const SETTINGS_GROUPS: SettingsGroup[] = buildGroups();

/** Heading and blurb for the panel currently mounted in the hub. */
export function systemTab(id: SystemTabId): { label: string; blurb: string } {
  const group = SETTINGS_GROUPS.find((g) => g.id === "system");
  const tab = group?.tabs.find((t) => t.tab === id);
  return {
    label: tab?.label ?? "System & general",
    blurb: tab?.blurb ?? "Online connection, security and code health.",
  };
}

/** The group a settings route belongs to, if any. */
export function groupForRoute(route: string): SettingsGroup | null {
  return SETTINGS_GROUPS.find((g) => g.tabs.some((t) => t.to === route)) ?? null;
}

export type SettingsDuplicate = {
  route: string;
  groups: string[];
};

/**
 * Any settings page claimed by more than one parent without being marked as a
 * deliberate shortcut. Surfaced in the Logic health dashboard so a future page
 * cannot quietly re-introduce a second home for the same options.
 */
export function settingsDuplicates(): SettingsDuplicate[] {
  const seen = new Map<string, { groups: string[]; shared: boolean }>();
  for (const group of SETTINGS_GROUPS) {
    for (const tab of group.tabs) {
      const entry = seen.get(tab.to) ?? { groups: [], shared: false };
      entry.groups.push(group.label);
      entry.shared = entry.shared || !!tab.shared;
      seen.set(tab.to, entry);
    }
  }
  return [...seen.entries()]
    .filter(([, v]) => v.groups.length > 1 && !v.shared)
    .map(([route, v]) => ({ route, groups: v.groups }));
}

/**
 * Every `/settings/*` page that exists, discovered from the route files rather
 * than kept by hand.
 */
const ROUTE_FILES = Object.keys(import.meta.glob("/src/routes/*.tsx"));

/**
 * Pages that only forward somewhere else. They are old links kept alive, not
 * areas needing a card, so they are not expected to appear in the workspace.
 */
const LEGACY_REDIRECTS = new Set([
  "/settings/access",
  "/settings/admin-terminals",
  "/settings/workspace",
  "/settings/database-explorer",
  "/settings/data-sync",
  "/settings/diagnostics",
  "/settings/inheritance",
  "/settings/logic-health",
  "/settings/security-alerts",
  "/settings/sync",
  "/settings/visibility",
]);

export type SettingsCoverage = {
  /** A settings page with no card — unreachable from the workspace or search. */
  uncovered: string[];
  /** A card pointing at a page that no longer exists. */
  dangling: string[];
};

/**
 * The reverse of `settingsDuplicates`: pages nobody owns, and cards that lead
 * nowhere. Shown in Logic health so a new settings page cannot be added to one
 * registry only and quietly go missing.
 */
export function settingsCoverage(): SettingsCoverage {
  const pages = new Set<string>();
  for (const file of ROUTE_FILES.filter(file => file.includes("/settings."))) {
    const name = file.split("settings.")[1]?.replace(/\.tsx$/, "");
    if (!name || name === "index") continue;
    const route = `/settings/${name}`;
    if (LEGACY_REDIRECTS.has(route)) continue;
    // The platform catalogue intentionally excludes installers from web builds.
    if (route === "/settings/updates" && !SETTINGS_CARDS.some(card => card.to === route)) continue;
    pages.add(route);
  }

  const allRoutes = new Set(ROUTE_FILES.map(file => "/" + file.split("/").pop()!.replace(/\.tsx$/, "").replace(/\.index$/, "").replaceAll(".", "/")));
  const carded = new Set(SETTINGS_CARDS.map((c) => c.to.split("?")[0] as string));
  return {
    uncovered: [...pages].filter((p) => !carded.has(p)).sort(),
    dangling: [...carded].filter((p) => !allRoutes.has(p)).sort(),
  };
}
