/** Subscribe before reading; a slow initial response cannot overwrite a newer event. */
export function observeLiveSnapshot<T>(read: () => Promise<T>, subscribe: ((update: (value: T) => void) => () => void) | undefined, update: (value: T) => void): () => void {
  let active = true;
  let revision = 0;
  const off = subscribe?.(value => { revision++; if (active) update(value); });
  const initialRevision = revision;
  void read().then(value => {
    if (active && revision === initialRevision) update(value);
  }, () => { /* Keep the latest event while the next health check retries. */ });
  return () => { active = false; off?.(); };
}
