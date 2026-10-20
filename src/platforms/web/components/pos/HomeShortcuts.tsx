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
  return <nav aria-label="Home pages" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
    {items.map(item => <Link key={item.to} to={item.to}
      className="flex min-h-11 items-center gap-2 rounded-xl border border-border bg-card px-3 py-3 text-sm font-medium transition-[background-color,border-color,box-shadow] duration-[var(--motion-normal)] ease-[var(--motion-ease-standard)] hover:border-primary/40 hover:bg-accent hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none">
      <item.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span>{item.label}</span>
    </Link>)}
  </nav>;
}
