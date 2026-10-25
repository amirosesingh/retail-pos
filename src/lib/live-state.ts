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

/** Apply a scoped refresh without comparing or replacing unrelated records. */
export function applyLiveRowChanges<T extends { id: string }>(
  previous: T[], changedIds: ReadonlySet<string>, incoming: readonly T[],
  key: (row: T) => string = row => row.id,
  prependNew = false,
): T[] {
  const remaining = new Map(incoming.filter(row => changedIds.has(key(row))).map(row => [key(row), row]));
  let changed = false;
  const next: T[] = [];
  for (const old of previous) {
    const id = key(old);
    if (!changedIds.has(id)) { next.push(old); continue; }
    const row = remaining.get(id);
    remaining.delete(id);
    if (!row) { changed = true; continue; }
    if (old === row || JSON.stringify(old) === JSON.stringify(row)) next.push(old);
    else { next.push(row); changed = true; }
  }
  if (remaining.size) {
    const added = [...remaining.values()];
    return prependNew ? [...added, ...next] : [...next, ...added];
  }
  return changed ? next : previous;
}
