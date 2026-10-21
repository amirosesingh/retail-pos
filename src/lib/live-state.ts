/** Preserve stable field references when a background snapshot has no new values. */
export function retainUnchangedFields<T extends object>(previous: T, incoming: T): T {
  const next = { ...incoming };
  let changed = Object.keys(previous).length !== Object.keys(incoming).length;
  for (const key of Object.keys(incoming) as (keyof T)[]) {
    const oldValue = previous[key];
    const newValue = incoming[key];
    if (oldValue === newValue || JSON.stringify(oldValue) === JSON.stringify(newValue)) {
      next[key] = oldValue;
    } else changed = true;
  }
  return changed ? next : previous;
}

/** Keep unchanged row identities and DOM keys during background reconciliation. */
export function reconcileLiveRows<T extends { id: string }>(previous: T[], incoming: T[]): T[] {
  const byId = new Map(previous.map(row => [row.id, row]));
  const next = incoming.map(row => {
    const old = byId.get(row.id);
    return old && JSON.stringify(old) === JSON.stringify(row) ? old : row;
  });
  return next.length === previous.length && next.every((row, index) => row === previous[index]) ? previous : next;
}
