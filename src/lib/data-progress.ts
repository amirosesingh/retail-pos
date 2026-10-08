/** Shared foreground work ledger. Unknown totals stay indeterminate. */
export type DataTask = { id: number; label: string; completed: number; total: number | null };
let nextId = 0;
let snapshot: readonly DataTask[] = [];
const listeners = new Set<() => void>();
const publish = () => {
  for (const listener of listeners) listener();
};
export const dataProgress = () => snapshot;
export const subscribeDataProgress = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function beginDataTask(label: string) {
  const id = ++nextId;
  snapshot = [...snapshot, { id, label, completed: 0, total: null }];
  publish();
  return {
    report(completed: number, total: number | null = null) {
      snapshot = snapshot.map((task) =>
        task.id === id
          ? {
              ...task,
              completed: Math.max(0, Number.isFinite(completed) ? completed : 0),
              total: total !== null && Number.isFinite(total) && total >= 0 ? total : null,
            }
          : task,
      );
      publish();
    },
    finish() {
      snapshot = snapshot.filter((task) => task.id !== id);
      publish();
    },
  };
}
export async function withDataTask<T>(label: string, work: () => Promise<T>): Promise<T> {
  const task = beginDataTask(label);
  try {
    return await work();
  } finally {
    task.finish();
  }
}
