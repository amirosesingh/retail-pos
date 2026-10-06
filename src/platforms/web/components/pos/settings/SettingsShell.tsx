/**
 * The settings window.
 *
 * Keeps one compact category toolbar above the current settings page. The main
 * application shell remains the only sidebar on every platform.
 */
import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { SettingsLink } from "@/platforms/web/components/pos/settings/SettingsNavTree";
import { SettingsTabs } from "@/platforms/web/components/pos/settings/SettingsTabs";
import {
  cardForLocation,
  useSettingsNav,
} from "@/platforms/web/components/pos/settings/use-settings-nav";

export { SettingsLink };

/**
 * Wraps a settings page. `home` drops the breadcrumb and category toolbar for
 * the settings landing page, which draws its own header.
 */
export function SettingsShell({ children, home = false }: { children: ReactNode; home?: boolean }) {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const search = useRouterState({ select: (r) => r.location.search as Record<string, unknown> });
  const { cards, categories } = useSettingsNav();
  const tab = typeof search["tab"] === "string" ? search["tab"] : undefined;
  const active = home ? null : cardForLocation(cards, pathname, tab);
  const category = categories.find((g) => g.id === active?.category);
  // The app shell owns the viewport; settings content owns its single scrollbar.
  useEffect(() => {
    const htmlOverflow = document.documentElement.style.overflow;
    const bodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = htmlOverflow;
      document.body.style.overflow = bodyOverflow;
    };
  }, []);

  return (
    <div className="flex h-full max-h-full min-h-0 w-full flex-col overflow-hidden">
      <div
        className={
          "z-20 shrink-0 border-b border-border bg-background/95 px-3 py-2 text-xs backdrop-blur " +
          (home ? "hidden" : "block")
        }
      >
        {!home && (
          <div className="mx-auto w-full max-w-7xl space-y-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <Link
                to="/settings"
                search={category ? ({ cat: category.id } as never) : ({} as never)}
                className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Back to settings"
              >
                <ChevronLeft className="size-4" /> Settings
              </Link>
              {category && (
                <>
                  <span className="text-muted-foreground">/</span>
                  <span className="truncate text-muted-foreground">{category.label}</span>
                </>
              )}
              {active && (
                <>
                  <span className="text-muted-foreground">/</span>
                  <span className="truncate font-medium">{active.label}</span>
                </>
              )}
            </div>
            <SettingsTabs current={pathname} activeTab={tab} placement="shell" />
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
