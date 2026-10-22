/**
 * Landing page for a sidebar group: every option in the group as a card, so a
 * section can be opened as its own page instead of only expanding a list.
 */
import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { AppShell } from "@/platforms/web/components/pos/AppShell";
import { navGroups, navItemKey, type NavItem } from "@/platforms/web/components/pos/nav-config";
import { useAuth } from "@/lib/pos-auth";
import { useVisibility } from "@/lib/ui-visibility";

export function SectionHub({ groupId }: { groupId: string }) {
  const { can, isAdmin } = useAuth();
  const { visibleRoute } = useVisibility();
  const group = navGroups.find((g) => g.id === groupId);
  if (!group) return null;

  const canSee = (item: NavItem) => {
    if (item.flag && !can(item.flag)) return false;
    if (item.adminOnly && !isAdmin && !item.flag) return false;
    return visibleRoute(item.to);
  };

  // The hub itself is never one of its own cards.
  const items = group.items.filter((i) => i.to !== group.hubTo).filter(canSee);

  return (
    <AppShell>
      <div className="pos-page-container">
        <header className="flex items-start gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">{group.label}</h1>
            {group.blurb && <p className="text-sm text-muted-foreground page-description">{group.blurb}</p>}
          </div>
        </header>

        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            You do not have access to anything in this section.
          </p>
        ) : (
          <div className="section-hub-grid grid grid-cols-2 gap-2 sm:gap-3">
            {items.map((item) => (
              <div
                key={navItemKey(item)}
                className="section-hub-card group flex min-w-0 items-start gap-1 rounded-2xl border border-border/80 bg-card p-3 shadow-xs transition-colors hover:border-primary/40 hover:bg-muted/25"
              >
                <Link
                  to={item.to}
                  hash={item.hash}
                  search={item.section ? { section: item.section } : {}}
                  className="section-hub-link flex min-w-0 flex-1 items-start gap-3 rounded-xl p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="shrink-0 rounded-xl bg-primary/10 p-2.5 text-primary">
                    <item.icon aria-hidden="true" className="size-5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{item.label}</span>
                    {item.blurb && (
                      <span className="block text-xs text-muted-foreground">{item.blurb}</span>
                    )}
                  </span>
                  <ArrowUpRight
                    aria-hidden="true"
                    className="ml-auto mt-1 size-4 shrink-0 text-muted-foreground group-hover:text-primary"
                  />
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
