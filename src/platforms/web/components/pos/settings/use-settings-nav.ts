/**
 * One navigation model for the whole settings area.
 *
 * Desktop rail, mobile list and the search box all read from here. Device type
 * never limits access; role permissions and visibility decide what appears.
 */
import { useMemo } from "react";
import { useVisibility } from "@/lib/ui-visibility";
import { useAuth } from "@/lib/pos-auth";
import { routePermissionForPath } from "@/platforms/web/components/pos/nav-config";
import {
  SETTINGS_CARDS,
  SETTINGS_CATEGORIES,
  type SettingsCard,
  type SettingsCategory,
} from "@/lib/settings-catalog";

/** `/settings/system?tab=logic-health` → `/settings/system`. */
export function routeOf(card: SettingsCard): string {
  return card.to.split("?")[0] as string;
}

/** The search params a card's link needs, if any. */
export function searchOf(card: SettingsCard): Record<string, string> {
  const query = card.to.split("?")[1];
  if (!query) return {};
  return Object.fromEntries(new URLSearchParams(query).entries());
}

export type SettingsNav = {
  cards: SettingsCard[];
  categories: SettingsCategory[];
};

export function useSettingsNav(): SettingsNav {
  const { visibleRoute } = useVisibility();
  const { isAdmin, can } = useAuth();
  const cards = useMemo(
    () =>
      SETTINGS_CARDS.filter(
        (c) =>
          visibleRoute(routeOf(c)) &&
          (isAdmin ||
            ((routeOf(c) === "/settings/terminals" || routeOf(c) === "/settings/mobile-terminals")
              ? can("can_manage_terminals")
              : can(routePermissionForPath(routeOf(c)) ?? "can_access_pos_settings"))),
      ),
    [visibleRoute, isAdmin, can],
  );

  const categories = useMemo(
    () => SETTINGS_CATEGORIES.filter((g) => cards.some((c) => c.category === g.id)),
    [cards],
  );

  return { cards, categories };
}

/** The card a settings URL is showing, matching the `?tab=` variants too. */
export function cardForLocation(
  cards: SettingsCard[],
  pathname: string,
  tab?: string,
): SettingsCard | null {
  const onRoute = cards.filter((c) => routeOf(c) === pathname);
  if (!onRoute.length) return null;
  if (tab) {
    const exact = onRoute.find((c) => searchOf(c)["tab"] === tab);
    if (exact) return exact;
  }
  return onRoute.find((c) => !Object.keys(searchOf(c)).length) ?? (onRoute[0] as SettingsCard);
}

export function matchSettings(cards: SettingsCard[], term: string): SettingsCard[] {
  const q = term.trim().toLowerCase();
  if (!q) return [];
  return cards.filter((c) =>
    `${c.label} ${c.blurb} ${c.keywords ?? ""}`.toLowerCase().includes(q),
  );
}
