/** Keep a new person's login behind the previous person's complete teardown. */
export function createSessionTransition() {
  let pending: Promise<void> | null = null;
  return {
    wait: () => pending ?? Promise.resolve(),
    end(run: () => Promise<void>): Promise<void> {
      if (pending) return pending;
      const task = Promise.resolve().then(run);
      pending = task;
      const clear = () => { if (pending === task) pending = null; };
      void task.then(clear, clear);
      return task;
    },
  };
}
