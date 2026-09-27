import { Link } from "@tanstack/react-router";
import { useEmbeddedSettings } from "@/platforms/web/components/pos/settings/embed";
import {
  cardForLocation,
  routeOf,
  searchOf,
  useSettingsNav,
} from "@/platforms/web/components/pos/settings/use-settings-nav";

const BASE =
  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap";
const ACTIVE = "bg-primary text-primary-foreground";
const IDLE = "text-muted-foreground hover:bg-muted hover:text-foreground";

/**
 * Sub-tab strip for a unified settings area. Rendered at the top of every page
 * that belongs to a group, so all of one domain's options read as a single
 * screen instead of scattered menu entries.
 *
 * System diagnostics switch in place: those tabs report back through `onTab`
 * and the hub swaps the panel below without leaving the window.
 */
export function SettingsTabs({
  current,
  activeTab,
  onTab,
  placement = "page",
}: {
  current: string;
  activeTab?: string;
  onTab?: (tab: string) => void;
  /** SettingsShell owns the one visible toolbar; legacy page calls stay inert. */
  placement?: "shell" | "page";
}) {
  const { cards, categories } = useSettingsNav();
  const active = cardForLocation(cards, current, activeTab);
  const category = categories.find((item) => item.id === active?.category);
  const tabs = active ? cards.filter((card) => card.category === active.category) : [];
  const embedded = useEmbeddedSettings();
  if (placement !== "shell" || !active || !category || embedded || !tabs.length) return null;

  return (
    <nav aria-label={`${category.label} sections`} className="w-full min-w-0 space-y-1.5">
      <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {category.label}
      </p>
      <div className="no-scrollbar flex w-full max-w-full gap-1 overflow-x-auto rounded-lg border border-border bg-card p-1">
        {tabs.map((tab) => {
          const tabSearch = searchOf(tab);
          const tabId = tabSearch["tab"];
          if (tabId && onTab) {
            const selected = tab.id === active.id;
            return (
              <button
                key={tab.id}
                type="button"
                title={tab.blurb}
                aria-current={selected ? "page" : undefined}
                onClick={() => onTab(tabId)}
                className={`${BASE} shrink-0 ${selected ? ACTIVE : IDLE}`}
              >
                {tab.label}
              </button>
            );
          }
          const selected = tab.id === active.id;
          return (
            <Link
              key={tab.id}
              to={routeOf(tab) as never}
              search={tabSearch as never}
              title={tab.blurb}
              aria-current={selected ? "page" : undefined}
              className={`${BASE} shrink-0 ${selected ? ACTIVE : IDLE}`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
