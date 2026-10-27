import { Children, Fragment, isValidElement, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Carousel, CarouselContent, CarouselItem, type CarouselApi } from "@/components/ui/carousel";
import { cn } from "@/lib/utils";

function visibleCards(children: ReactNode, prefix = ""): { node: ReactElement; key: string }[] {
  return Children.toArray(children).flatMap((child, index) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return [];
    const key = `${prefix}${child.key ?? index}`;
    return child.type === Fragment
      ? visibleCards(child.props.children, `${key}/`)
      : [{ node: child, key }];
  });
}

type RailGeometry = { width: number; windowWidth: number; minCardWidth: number };
const GAP = 12;

/** Loop the same card nodes only when their ordinary row would overflow. */
export function SummaryCardRail({ label, children, className, desktopClassName, desktopItemClassName, desktopBehavior = "grid" }: {
  label: string;
  children: ReactNode;
  className?: string;
  desktopClassName?: string;
  desktopItemClassName?: string;
  desktopBehavior?: "grid" | "finite-carousel";
}) {
  const cards = visibleCards(children);
  const rootRef = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState<RailGeometry | null>(null);
  const [api, setApi] = useState<CarouselApi>();
  const desktopCarousel = desktopBehavior === "finite-carousel";
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => {
      // Measure the stable outer container, never the moving slide track.
      const next = {
        width: root.clientWidth,
        windowWidth: window.innerWidth,
        minCardWidth: (Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16) * 13,
      };
      setGeometry(current => current?.width === next.width && current.windowWidth === next.windowWidth && current.minCardWidth === next.minCardWidth ? current : next);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(root);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [cards.length]);
  const width = geometry?.width ?? 0;
  const windowWidth = geometry?.windowWidth ?? 0;
  const minWidth = geometry?.minCardWidth ?? 208;
  const capacity = desktopCarousel
    ? (windowWidth >= 1536 ? 3 : windowWidth >= 1024 ? 2 : 1)
    : Math.max(1, Math.floor((width + GAP) / (minWidth + GAP)));
  const loop = width > 0 && cards.length > Math.max(1, capacity);
  const finiteDesktop = desktopCarousel && windowWidth >= 1024 && !loop;
  const active = loop || (finiteDesktop && cards.length > 1);
  const preferredWidth = finiteDesktop || (desktopCarousel && windowWidth >= 1024)
    ? (width - GAP * (capacity - 1)) / capacity
    : windowWidth < 640 ? Math.min(width * 0.86, 320) : minWidth;
  // Embla excludes both edge gaps when deciding whether it can loop. Require
  // a full spare viewport without counting any gaps, plus rounding safety.
  const slideWidth = Math.max(preferredWidth, Math.ceil(width / Math.max(1, cards.length - 1)) + 1);
  const options = useMemo(() => ({
    align: "start" as const,
    containScroll: loop ? false as const : "trimSnaps" as const,
    active,
    loop,
    watchSlides: true,
    watchResize: true,
    breakpoints: {
      "(prefers-reduced-motion: reduce)": { duration: 0 },
    },
  }), [active, loop]);
  if (!cards.length) return null;
  return <Carousel
    ref={rootRef}
    opts={options}
    setApi={setApi}
    aria-label={label}
    aria-roledescription="card group"
    data-summary-card-rail="true"
    data-card-count={cards.length}
    data-card-loop={loop ? "true" : "false"}
    tabIndex={active ? 0 : undefined}
    className={cn("min-w-0 max-w-full", className)}
    onKeyDownCapture={event => {
      // Child menus, tooltips, links and inputs retain their own arrow keys.
      if (event.target !== event.currentTarget || !api || !active || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const jump = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (event.key === "ArrowLeft") api.scrollPrev(jump);
      else api.scrollNext(jump);
    }}
  >
    <CarouselContent className={cn("touch-pan-y", finiteDesktop ? "-ml-4" : "ml-0 grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-3", desktopClassName)}
      style={loop ? { display: "flex", flexWrap: "nowrap", marginLeft: 0, gap: GAP } : undefined}>
      {cards.map(card => <CarouselItem key={card.key}
        className={cn("[&>*]:h-full", finiteDesktop ? "basis-[48%] pl-4 2xl:basis-1/3" : "basis-auto pl-0", desktopItemClassName)}
        style={loop ? { flex: `0 0 ${slideWidth}px`, paddingLeft: 0 } : undefined}>
        {card.node}
      </CarouselItem>)}
    </CarouselContent>
  </Carousel>;
}
