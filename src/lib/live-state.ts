/** Preserve stable field references when a background snapshot has no new values. */
export function retainUnchangedFields<T extends object>(previous: T, incoming: T): T {
  const next = { ...incoming };
  let changed = false;
  for (const key of Object.keys(incoming) as (keyof T)[]) {
    const oldValue = previous[key];
    const newValue = incoming[key];
    if (oldValue === newValue || JSON.stringify(oldValue) === JSON.stringify(newValue)) {
      next[key] = oldValue;
    } else changed = true;
  }
  return changed ? next : previous;
}
