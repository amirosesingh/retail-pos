import { useAnimatedNumber } from "@/hooks/use-animated-number";

export function AnimatedMetric({
  value,
  format = (current) => Math.round(current).toLocaleString(),
}: {
  value: number;
  format?: (value: number) => string;
}) {
  return <span className="numeric tabular-nums">{format(useAnimatedNumber(value))}</span>;
}
