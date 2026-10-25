import type { SyncOp } from "./sync-outbox";

/** A frame opportunity before preparing a large foreground write. Bounded even
 * when a phone pauses requestAnimationFrame while returning from another app. */
export async function yieldToUi(): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  await new Promise<void>((resolve) => {
    let frame: number | undefined;
    const finish = () => {
      clearTimeout(timer);
      if (frame !== undefined && typeof cancelAnimationFrame === "function")
        cancelAnimationFrame(frame);
      resolve();
    };
    const timer = setTimeout(finish, 32);
    if (typeof requestAnimationFrame === "function")
      frame = requestAnimationFrame(() => setTimeout(finish, 0));
  });
}
export function operationRowCount(op: SyncOp): number | null {
  if (op.kind === "insert" || op.kind === "upsert") return op.rows.length;
  if ((op.kind === "update" || op.kind === "delete") && typeof op.match.id === "string") return 1;
  return null;
}
export function commitRowCount(ops: SyncOp[]): number | null {
  let total = 0;
  for (const op of ops) {
    const count = operationRowCount(op);
    if (count === null) return null;
    total += count;
  }
  return total;
}
/** Preserve dependency order and stop on the first failure. Only acknowledged
 * writes advance the count; unknown RPC/filter counts stay indeterminate. */
export async function runProgressBatch(
  ops: SyncOp[],
  write: (op: SyncOp) => Promise<void>,
  report: (completed: number, total: number | null) => void = () => {},
) {
  const total = commitRowCount(ops);
  let completed = 0;
  for (let index = 0; index < ops.length; index++) {
    await write(ops[index]);
    completed += operationRowCount(ops[index]) ?? 0;
    report(completed, total);
    if ((index + 1) % 25 === 0) await yieldToUi();
  }
}
