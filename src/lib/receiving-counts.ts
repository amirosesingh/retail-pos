/** Refreshing the same delivery must not erase a counter's unfinished count. */
export function reconcileReceivingCounts(previous: Record<string, string>, sameDelivery: boolean, productIds: string[]) {
  const next = Object.fromEntries(productIds.map(id => [id, sameDelivery ? previous[id] ?? "" : ""]));
  return Object.keys(previous).length === Object.keys(next).length && Object.entries(next).every(([id, value]) => previous[id] === value)
    ? previous : next;
}
