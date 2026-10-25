import { afterEach, describe, expect, it, vi } from "vitest";
import type { SyncOp } from "../sync-outbox";
import { commitRowCount, runProgressBatch, yieldToUi } from "../commit-progress";
import { dataProgress, withDataTask } from "../data-progress";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("foreground commit progress", () => {
  it("counts actual payload records and acknowledges each dependency in order", async () => {
    const ops: SyncOp[] = [
      { kind: "upsert", table: "purchase_orders", rows: [{ id: "invoice" }] },
      {
        kind: "upsert",
        table: "purchase_order_items",
        rows: Array.from({ length: 1500 }, (_, i) => ({ id: String(i) })),
      },
      { kind: "update", table: "products", match: { id: "product" }, values: { cost_price: 10 } },
    ];
    const report = vi.fn(),
      writes: string[] = [];
    await runProgressBatch(
      ops,
      async (op) => {
        writes.push(op.table);
      },
      report,
    );
    expect(writes).toEqual(["purchase_orders", "purchase_order_items", "products"]);
    expect(report.mock.calls).toEqual([
      [1, 1502],
      [1501, 1502],
      [1502, 1502],
    ]);
  });
  it("does not advance progress or write later rows after a failure", async () => {
    const ops: SyncOp[] = [1, 2, 3].map((id) => ({
      kind: "update",
      table: "products",
      match: { id: String(id) },
      values: { cost_price: id },
    }));
    const write = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("refused"));
    const report = vi.fn();
    await expect(runProgressBatch(ops, write, report)).rejects.toThrow("refused");
    expect(write).toHaveBeenCalledTimes(2);
    expect(report.mock.calls).toEqual([[1, 3]]);
  });
  it("does not fabricate a row count for an RPC or a broad deletion", () => {
    expect(commitRowCount([{ kind: "rpc", table: "sales", fn: "finalize", args: {} }])).toBeNull();
    expect(
      commitRowCount([{ kind: "delete", table: "sale_items", match: { sale_id: "bill" } }]),
    ).toBeNull();
  });
  it("exposes pending work and clears it after a failed foreground commit", async () => {
    let reject!: (error: Error) => void;
    const pending = withDataTask("Receiving", async (task) => {
      task?.report(0, 1500);
      await new Promise<void>((_, fail) => {
        reject = fail;
      });
    });
    expect(dataProgress().at(-1)).toMatchObject({ label: "Receiving", completed: 0, total: 1500 });
    reject(new Error("commit failed"));
    await expect(pending).rejects.toThrow("commit failed");
    expect(dataProgress()).toEqual([]);
  });
  it("yields without hanging when animation frames are suspended on a phone", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {});
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    let finished = false;
    const work = yieldToUi().then(() => {
      finished = true;
    });
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(32);
    await work;
    expect(finished).toBe(true);
  });
});
