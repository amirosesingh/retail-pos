import { Children, type ReactNode } from "react";
import { Carousel, CarouselContent, CarouselItem } from "@/components/ui/carousel";

/** A bounded card strip shared by pointer, touch and keyboard users. */
export function AnalyticsCardRail({ title, children }: { title: string; children: ReactNode }) {
  return <Carousel opts={{ align: "start", containScroll: "trimSnaps" }} aria-label={title}
    onKeyDownCapture={() => undefined} className="min-w-0">
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold">{title}</h2>
    </div>
    <CarouselContent className="touch-pan-y">
      {Children.toArray(children).map(child => <CarouselItem key={(child as { key?: string }).key}
        className={"basis-[92%] sm:basis-3/4 lg:basis-[48%] 2xl:basis-1/3 [&>*]:h-full"}>
        {child}
      </CarouselItem>)}
    </CarouselContent>
  </Carousel>;
}
