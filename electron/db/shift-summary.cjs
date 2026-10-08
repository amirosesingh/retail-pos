/** Build a summary only from database aggregates, never the paged renderer sale cache. */
function shiftSummaryRow({ id, shift, totals, branchId, branchName, terminalName, actor, closedAt, countedCash }) {
  const number = (value) => Number(value ?? 0) || 0;
  const total = number(totals.total_sales);
  const transactions = number(totals.transactions);
  const breakdown = {
    cash: number(totals.expected_cash) - number(shift.opening_float),
    card: number(totals.expected_card), digital: number(totals.expected_digital),
  };
  return {
    id, shift_id: shift.id, store_id: branchId, store_name: branchName,
    terminal_name: terminalName, closed_by: actor, opened_at: shift.opened_at,
    closed_at: closedAt, total_sales: total, transactions,
    discounts: number(totals.discounts), refunds: number(totals.refunds),
    expected_cash: number(totals.expected_cash), counted_cash: countedCash,
    payment_breakdown: breakdown,
    summary: `Shift closed — ${branchName}\nClosed by ${actor}\nTotal sales: ${total.toFixed(2)} over ${transactions} bill(s)\nCash expected ${number(totals.expected_cash).toFixed(2)} / counted ${number(countedCash).toFixed(2)}`,
    channels: ["in_app"], created_at: closedAt,
  };
}
module.exports = { shiftSummaryRow };
