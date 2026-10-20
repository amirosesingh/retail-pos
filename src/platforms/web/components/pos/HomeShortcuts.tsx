import { Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/pos-auth";
import { useVisibility } from "@/lib/ui-visibility";
import { canSeeNavigationItem, navGroups } from "./nav-config";

export function HomeShortcuts() {
  const { can, isAdmin } = useAuth();
  const { visibleRoute } = useVisibility();
  const items = (navGroups.find(group => group.id === "company")?.items ?? [])
    .filter(item => item.to !== "/dashboard" && canSeeNavigationItem(item, can, isAdmin, visibleRoute));
  if (!items.length) return null;
  return <nav aria-label="Home pages" className="dashboard-swipe-row no-scrollbar flex min-w-0 max-w-full snap-x snap-mandatory items-center gap-2 overflow-x-auto overscroll-x-contain py-1 lg:ml-auto">
    {items.map(item => <Link key={item.to} to={item.to}
      className="flex min-h-11 shrink-0 snap-start items-center gap-2 rounded-xl border border-border bg-card px-3 py-3 text-sm font-medium transition-[background-color,border-color,box-shadow] duration-[var(--motion-normal)] ease-[var(--motion-ease-standard)] hover:border-primary/40 hover:bg-accent hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none">
      <item.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="whitespace-nowrap">{item.label}</span>
    </Link>)}
  </nav>;
}
