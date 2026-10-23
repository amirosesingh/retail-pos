/**
 * The settings window.
 *
 * Keeps one compact category toolbar above the current settings page. The main
 * application shell remains the only sidebar on every platform.
 */
import { useRouterState } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { SettingsLink } from "@/platforms/web/components/pos/settings/SettingsNavTree";
import { SettingsTabs } from "@/platforms/web/components/pos/settings/SettingsTabs";


export { SettingsLink };

/**
 * Wraps a settings page. `home` drops the breadcrumb and category toolbar for
 * the settings landing page, which draws its own header.
 */
export function SettingsShell({ children, home = false }: { children: ReactNode; home?: boolean }) {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const search = useRouterState({ select: (r) => r.location.search as Record<string, unknown> });
  const tab = typeof search["tab"] === "string" ? search["tab"] : undefined;
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
    <div className="settings-workspace flex h-full max-h-full min-h-0 w-full flex-col overflow-hidden bg-muted/20">
      <div
        className={
          "z-20 shrink-0 border-b border-border bg-background/95 py-2 text-xs backdrop-blur " +
          (home ? "hidden" : "block")
        }
      >
        {!home && (
          <div className="pos-page-boundary pos-page-gutters space-y-2">
            <SettingsTabs current={pathname} activeTab={tab} placement="shell" />
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
    </div>
  );
}
