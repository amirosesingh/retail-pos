import type { SyncOp } from "./sync-outbox";

type Row = Record<string, unknown>;
export type StockDelta = { movementId: string; productId: string; storeId: string | null; delta: number };

/** Convert absolute product stock into idempotent relative movements for cloud writes. */
export function withRelativeStock(ops: SyncOp[]): { ops: SyncOp[]; deltas: StockDelta[] } {
  const movements = ops.flatMap((op) =>
    (op.kind === "insert" || op.kind === "upsert") && op.table === "item_activity_logs"
      ? (op.rows as Row[]) : [],
  );
  if (!movements.length) return { ops, deltas: [] };
  const deltas = movements
    .filter((row) => row["product_id"] && Number(row["quantity_delta"] ?? 0) !== 0)
    .map((row) => ({
      movementId: String(row["id"]), productId: String(row["product_id"]),
      storeId: (row["store_id"] as string | null) ?? null,
      delta: Number(row["quantity_delta"] ?? 0),
    }));
  if (!deltas.length) return { ops, deltas: [] };
  return {
    ops: ops.map((op) => {
      if (op.table !== "products" || (op.kind !== "upsert" && op.kind !== "insert")) return op;
      return { ...op, rows: (op.rows as Row[]).map(({ stock_quantity: _q, stock_by_store: _s, ...row }) => row) };
    }),
    deltas,
  };
}
