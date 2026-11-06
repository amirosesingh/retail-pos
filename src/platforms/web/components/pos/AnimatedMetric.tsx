/** The card animates into view; its confirmed amount is never interpolated. */
export function AnimatedMetric({
  value,
  format = (current) => Math.round(current).toLocaleString(),
}: {
  value: number;
  format?: (value: number) => string;
}) {
  return <span className="numeric tabular-nums">{format(value)}</span>;
}
