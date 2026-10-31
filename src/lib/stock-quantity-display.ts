/** Typed value shown by available-stock summaries; filters share this precision. */
export function displayedStockQuantity(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(3)) : value;
}
