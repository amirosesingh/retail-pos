import { Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/pos-auth";
import { useVisibility } from "@/lib/ui-visibility";
import { navGroups } from "./nav-config";

export function SellingShortcuts() {
  const { can, isAdmin } = useAuth();
  const { visibleRoute } = useVisibility();
  const items = (navGroups.find((group) => group.id === "register")?.items ?? []).filter(
    (item) =>
      item.to !== "/" &&
      visibleRoute(item.to) &&
      (!item.flag || can(item.flag)) &&
      (!item.adminOnly || !!item.flag || isAdmin),
  );
  if (!items.length) return null;
  return (
    <nav
      aria-label="Selling tools"
      className="flex shrink-0 flex-wrap gap-1 border-b border-border bg-background px-3 py-2"
    >
      {items.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <item.icon className="size-4" aria-hidden="true" />
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
