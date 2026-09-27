/**
 * Top-level navigation only.
 *
 * The sidebar lists the pinned shortcuts and the seven sections — nothing is
 * nested inside it. Every option that used to hang off a section is a card on
 * that section's own page, so the same screens are reachable in one more
 * predictable click instead of a fold-out tree.
 */
import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Search, Settings as SettingsIcon, X } from "lucide-react";
import { useMemo, useState, useEffect } from "react";
import { navGroups, navItemKey, type NavItem } from "./nav-config";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/lib/pos-auth";
import { useNavPins } from "@/lib/nav-pins";
import { SETTINGS_CARDS } from "@/lib/settings-catalog";
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
  const link = (
    <Link
      to={entry.to}
      hash={entry.hash}
      search={entry.search ?? {}}
      onClick={onNavigate}
      aria-label={entry.label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex touch-manipulation select-none items-center gap-2 rounded-md text-sm transition-[background-color,color] duration-[var(--motion-fast)] ease-[var(--motion-ease-standard)] motion-reduce:transition-none",
        collapsed ? "justify-center py-2.5" : "px-2 py-2",
        active
          ? "bg-sidebar-accent font-medium text-primary"
          : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
      )}
    >
      <entry.icon className={collapsed ? "size-5" : "size-4 shrink-0"} />
      {!collapsed && <span className="min-w-0 truncate">{entry.label}</span>}
      {entry.badge && inbound > 0 && !collapsed && (
        <Badge className="ml-auto h-5 min-w-5 shrink-0 justify-center px-1 text-[10px]">
          {inbound}
        </Badge>
      )}
    </Link>
  );

  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{entry.label}</TooltipContent>
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
  const [query, setQuery] = useState("");
  const { authUserId, isAdmin, isSupervisor, can } = useAuth();
  const { state } = usePos();
  const { pins } = useNavPins(authUserId ?? null);

  const settingsAllowed = isSupervisor || can("can_access_pos_settings");

  /** The seven top-level destinations. */
  const sections: Entry[] = useMemo(() => {
    const list = orderWorkspaceGroups(
      navGroups,
      state.settings.integrations.terminalPurpose,
      isAdmin || isSupervisor,
    )
      .map((g) => ({ ...g, items: g.items.filter(canSee) }))
      .filter((g) => g.items.length > 0)
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

  /**
   * Pins are rebuilt from the shared lists, so a pin cannot show a screen the
   * person is not allowed to see.
   */
  const pinnedEntries: Entry[] = useMemo(() => {
    const navByKey = new Map(
      navGroups.flatMap((g) => g.items).map((i) => [navItemKey(i), i] as const),
    );
    const out: Entry[] = [];
    for (const pin of pins) {
      if (pin.kind === "nav") {
        const item = navByKey.get(pin.key);
        if (!item || !canSee(item)) continue;
        out.push({
          key: `nav:${pin.key}`,
          label: item.label,
          icon: item.icon,
          to: item.to,
          ...(item.hash ? { hash: item.hash } : {}),
          ...(item.section ? { search: { section: item.section } } : {}),
        });
      } else {
        if (!settingsAllowed) continue;
        const card = SETTINGS_CARDS.find((c) => c.id === pin.key);
        if (!card) continue;
        const [to, qs] = card.to.split("?");
        if (!canSee({ to: to as string, label: card.label, icon: card.icon })) continue;
        out.push({
          key: `settings:${pin.key}`,
          label: card.label,
          icon: card.icon,
          to: to as string,
          ...(qs ? { search: Object.fromEntries(new URLSearchParams(qs).entries()) } : {}),
        });
      }
    }
    return out;
  }, [pins, canSee, settingsAllowed]);

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

  const q = query.trim().toLowerCase();
  const match = (e: Entry) => !q || e.label.toLowerCase().includes(q);
  const visiblePinned = pinnedEntries.filter(match);
  const visibleSections = sections.filter(match);

  const isActive = (e: Entry) => {
    if (e.to === "/") return pathname === "/";
    if (!e.prefix) return pathname === e.to;
    return pathname === e.to || pathname.startsWith(`${e.to}/`);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}

      {!collapsed && (
        <div className="relative px-2 pb-2">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search menu…"
            className="h-8 pl-7 pr-7 text-xs"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery("")}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      )}

      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-2">
        {registerEntry && match(registerEntry) && (
          <SidebarRow
            entry={registerEntry}
            collapsed={collapsed}
            active={isActive(registerEntry)}
            inbound={inbound}
            onNavigate={onNavigate}
          />
        )}

        {visiblePinned.length > 0 && (
          <>
            {!collapsed && (
              <p className="px-2 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Pinned
              </p>
            )}
            {visiblePinned.map((e) => (
              <SidebarRow
                key={e.key}
                entry={e}
                collapsed={collapsed}
                active={isActive(e)}
                inbound={inbound}
                onNavigate={onNavigate}
              />
            ))}
            <div className="my-1 border-t border-border" />
          </>
        )}

        {visibleSections.map((e) => (
          <SidebarRow
            key={e.key}
            entry={e}
            collapsed={collapsed}
            active={isActive(e)}
            inbound={inbound}
            onNavigate={onNavigate}
          />
        ))}

        {visibleSections.length === 0 &&
          visiblePinned.length === 0 &&
          !(registerEntry && match(registerEntry)) && (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">No matches</p>
          )}
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
            {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
            {!collapsed && <span>Collapse</span>}
          </Button>
        </div>
      )}
    </div>
  );
}
