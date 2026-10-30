import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { posDayKey } from "@/lib/time-zone";
import { moveHistoryDateRange } from "@/lib/history-date-range";

/** Calendar-day navigation keeps explicit ranges and the store's date semantics. */
export function HistoryDateNavigation({ from, to, onChange }: {
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
}) {
  return (
    <div role="group" aria-label="History day navigation" className="flex items-center gap-1">
      <Button type="button" size="icon" variant="outline" className="size-9"
        aria-label="Previous day" title="Previous day"
        onClick={() => onChange(moveHistoryDateRange(from, to, -1))}>
        <ChevronLeft className="size-4" aria-hidden="true" />
      </Button>
      <Button type="button" size="sm" variant="outline" className="h-9" onClick={() => {
        const today = posDayKey();
        onChange({ from: today, to: today });
      }}>Today</Button>
      <Button type="button" size="icon" variant="outline" className="size-9"
        aria-label="Next day" title="Next day"
        onClick={() => onChange(moveHistoryDateRange(from, to, 1))}>
        <ChevronRight className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
