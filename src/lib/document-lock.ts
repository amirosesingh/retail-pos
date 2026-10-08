/** Browser tabs share a device counter; native single-renderer calls queue here. */
const tails = new Map<string, Promise<unknown>>();
export function reserveDocument<T>(name: string, work: () => Promise<T>): Promise<T> {
  const run = (tails.get(name) ?? Promise.resolve()).then(async () => {
    if (typeof navigator !== "undefined" && navigator.locks)
      return navigator.locks.request(name, work);
    return work();
  });
  tails.set(
    name,
    run.catch(() => undefined),
  );
  return run;
}
