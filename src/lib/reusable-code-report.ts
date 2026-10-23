/** Sale headers carry the whole coupon saving for both bill and item scope.
 * Do not add line discounts again or include unrelated manual discounts.
 */
export function reusableCodeTotals(rows: Record<string, unknown>[], codeId: string) {
  const unique = new Map(rows.map(row => [String(row.id), row]));
  const matching = [...unique.values()].filter(row => row.coupon_promo_id === codeId && !row.is_refunded);
  return {
    count: matching.length,
    revenue: matching.reduce((sum, row) => sum + Number(row.total_amount ?? 0), 0),
    discount: matching.reduce((sum, row) => sum + Number(row.coupon_discount ?? 0), 0),
  };
}
