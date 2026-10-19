import { Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/pos-auth";
import { useVisibility } from "@/lib/ui-visibility";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
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
      className="min-w-0 shrink-0 border-b border-border bg-background px-3 py-2"
    >
      <Carousel opts={{ align: "start", containScroll: "trimSnaps" }} className="flex min-w-0 items-center gap-1">
        <CarouselPrevious className="static size-7 shrink-0 translate-y-0" aria-label="Previous selling tools" />
        <div className="min-w-0 flex-1">
        <CarouselContent className="ml-0 touch-pan-y">
      {items.map((item) => (
        <CarouselItem key={item.to} className="basis-auto pl-0">
        <Link
          key={item.to}
          to={item.to}
          className="inline-flex whitespace-nowrap items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <item.icon className="size-4" aria-hidden="true" />
          {item.label}
        </Link>
        </CarouselItem>
      ))}
        </CarouselContent>
        </div>
        <CarouselNext className="static size-7 shrink-0 translate-y-0" aria-label="Next selling tools" />
      </Carousel>
    </nav>
  );
}
