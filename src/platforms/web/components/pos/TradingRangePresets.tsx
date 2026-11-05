import { chartRangePreset } from "@/lib/shop-comparison";
import { Button } from "@/components/ui/button";

/** Changes the existing shared date window, never a second report request. */
export function TradingRangePresets({ today, from, to, onChange }: {
  today: string; from: string; to: string; onChange: (range: { from: string; to: string }) => void;
}) {
  return <div className="flex flex-wrap gap-1" aria-label="Trading date presets">
    {([['today', 'Today'], ['7', '7 days'], ['15', '15 days'], ['20', '20 days'], ['30', '30 days'], ['month', 'This month']] as const).map(([preset, label]) => {
      const range = chartRangePreset(today, preset), active = from === range.from && to === range.to;
      return <Button key={preset} size="sm" variant={active ? "default" : "outline"} aria-pressed={active} onClick={() => onChange(range)}>{label}</Button>;
    })}
  </div>;
}
