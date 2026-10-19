/**
 * Top-level navigation only.
 *
 * The sidebar lists the pinned shortcuts and the seven sections — nothing is
 * nested inside it. Every option that used to hang off a section is a card on
 * that section's own page, so the same screens are reachable in one more
 * predictable click instead of a fold-out tree.
 */
import { Link, useRouterState } from "@tanstack/react-router";
import {
  PanelLeftClose,
  PanelLeftOpen,
  SlidersHorizontal as SettingsIcon,
  PanelsTopLeft,
  PackageSearch,
  UsersRound,
  CalendarClock,
  ChartNoAxesCombined,
  BriefcaseBusiness,
} from "lucide-react";
import { useMemo, useState, useEffect } from "react";
import { navGroups, type NavItem } from "./nav-config";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/lib/pos-auth";
import { cn } from "@/lib/utils";
import { usePos } from "@/lib/pos-store";
import { orderWorkspaceGroups } from "@/lib/terminal-workspace";

const COLLAPSE_KEY = "pos.nav.collapsed";

export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
  }, []);
  const update = (v: boolean) => {
    setCollapsed(v);
    localStorage.setItem(COLLAPSE_KEY, v ? "1" : "0");
  };
  return [collapsed, update] as const;
}

type Props = {
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  onNavigate?: () => void;
  canSee: (item: NavItem) => boolean;
  inbound?: number;
  header?: React.ReactNode;
  footer?: React.ReactNode;
};

type Entry = {
  key: string;
  label: string;
  icon: NavItem["icon"];
  to: string;
  hash?: string;
  search?: Record<string, string>;
  /** Section entries stay lit for every page underneath them. */
  prefix?: boolean;
  badge?: boolean;
};

type SidebarRowProps = {
  entry: Entry;
  collapsed: boolean;
  active: boolean;
  inbound: number;
  onNavigate?: () => void;
};

/**
 * Keep rows as a stable component type. Defining this inside SidebarNav made
 * React unmount and recreate every link whenever the shell refreshed, which
 * could drop a click and visibly reset the hover state mid-interaction.
 */
function SidebarRow({ entry, collapsed, active, inbound, onNavigate }: SidebarRowProps) {
  const iconTone = /inventory|stock|transfer|purchas/.test(entry.to)
    ? "text-category-2"
    : /customer|member|marketing/.test(entry.to)
      ? "text-category-4"
      : /booking|service|approval/.test(entry.to)
        ? "text-category-3"
        : "text-category-1";
  const NavIcon =
    entry.to === "/" || entry.to === "/sales"
      ? PanelsTopLeft
      : /inventory|stock|transfer|request|purchas/.test(entry.to)
        ? PackageSearch
        : /customer|member/.test(entry.to)
          ? UsersRound
          : /booking|service/.test(entry.to)
            ? CalendarClock
            : /report/.test(entry.to)
              ? ChartNoAxesCombined
              : /setting/.test(entry.to)
                ? SettingsIcon
                : /admin|staff/.test(entry.to)
                  ? BriefcaseBusiness
                  : entry.icon;
  const link = (
    <Link
      to={entry.to}
      hash={entry.hash}
      search={entry.search ?? {}}
      onClick={onNavigate}
      aria-label={entry.label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex touch-manipulation select-none items-center gap-2.5 rounded-xl text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-inset transition-[background-color,color] duration-[var(--motion-fast)] ease-[var(--motion-ease-standard)] motion-reduce:transition-none",
        collapsed ? "justify-center gap-0 py-2.5" : "px-3 py-2.5",
        active
          ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
          : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
      )}
    >
      <NavIcon
        strokeWidth={1.75}
        aria-hidden="true"
        className={cn(collapsed ? "size-5" : "size-4 shrink-0", active ? "text-primary" : iconTone)}
      />
      <span aria-hidden={collapsed || undefined} className={cn("min-w-0 overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-[var(--motion-normal)] motion-reduce:transition-none", collapsed ? "max-w-0 opacity-0" : "max-w-44 opacity-100")}>{entry.label}</span>
      {entry.badge && inbound > 0 && !collapsed && (
        <Badge className="ml-auto h-5 min-w-5 shrink-0 justify-center px-1 text-[10px]">
          {inbound}
        </Badge>
      )}
    </Link>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      {collapsed && <TooltipContent side="right">{entry.label}</TooltipContent>}
    </Tooltip>
  );
}

export function SidebarNav({
  collapsed = false,
  onToggleCollapse,
  onNavigate,
  canSee,
  inbound = 0,
  header,
  footer,
}: Props) {
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { isAdmin, isSupervisor, can } = useAuth();
  const { state } = usePos();

  const settingsAllowed = isSupervisor || can("can_access_pos_settings");

  /** The seven top-level destinations. */
  const sections: Entry[] = useMemo(() => {
    const list = orderWorkspaceGroups(
      navGroups,
      state.settings.integrations.terminalPurpose,
      isAdmin || isSupervisor,
    )
      .map((g) => ({ ...g, items: g.items.filter(canSee) }))
      .filter((g) => g.id !== "register" && g.items.length > 0)
      .map((g) => ({
        key: g.id,
        label: g.label,
        icon: g.icon,
        to: g.hubTo,
        prefix: true,
        badge: g.items.some((i) => i.to === "/transfers"),
      }));
    if (settingsAllowed) {
      list.push({
        key: "settings",
        label: "Settings",
        icon: SettingsIcon,
        to: "/settings",
        prefix: true,
        badge: false,
      });
    }
    return list;
  }, [canSee, isAdmin, isSupervisor, settingsAllowed, state.settings.integrations.terminalPurpose]);

  /** The till itself always stays one click away, above everything else. */
  const registerEntry: Entry | null = useMemo(() => {
    const item = navGroups.flatMap((g) => g.items).find((i) => i.to === "/");
    if (!item || !canSee(item)) return null;
    return {
      key: "register-pos",
      label: item.label,
      icon: item.icon,
      to: "/",
      search: item.search,
    };
  }, [canSee]);

  const isActive = (e: Entry) => {
    if (e.to === "/") return pathname === "/";
    if (!e.prefix) return pathname === e.to;
    return pathname === e.to || pathname.startsWith(`${e.to}/`);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}

      <nav className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2 pb-3">
        {registerEntry && (
          <SidebarRow
            entry={registerEntry}
            collapsed={collapsed}
            active={isActive(registerEntry)}
            inbound={inbound}
            onNavigate={onNavigate}
          />
        )}

        {sections.map((e) => (
          <SidebarRow
            key={e.key}
            entry={e}
            collapsed={collapsed}
            active={isActive(e)}
            inbound={inbound}
            onNavigate={onNavigate}
          />
        ))}
      </nav>

      {footer}

      {onToggleCollapse && (
        <div className="border-t border-border p-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleCollapse}
            className={cn(
              "h-8 w-full text-xs",
              collapsed ? "justify-center px-0" : "justify-start",
            )}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" />
            ) : (
              <PanelLeftClose className="size-4" />
            )}
            {!collapsed && <span>Collapse</span>}
          </Button>
        </div>
      )}
    </div>
  );
}
