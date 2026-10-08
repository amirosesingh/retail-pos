import { describe, it, expect, vi } from "vitest";
import { readAllPages } from "../paged-read";
import { dataProgress } from "../data-progress";
import { queryReadsChangedTables, needsIdleCatchup } from "../live-query-tables";

describe("quiet live refresh", () => {
  it("skips idle ticks without delaying queued writes or safety reconciliation", () => {
    for (const elapsed of [1000, 2000, 5000, 20000, 60000, 299999])
      expect(needsIdleCatchup(0, 1000, 1000 + elapsed)).toBe(false);
    expect(needsIdleCatchup(1, 1000, 2000)).toBe(true);
    expect(needsIdleCatchup(0, 1000, 301000)).toBe(true);
  });
  it("does not show foreground progress for routine paged reads", async () => {
    let resolve!: (value: { data: number[]; error: null }) => void;
    const pending = readAllPages(
      () =>
        new Promise<{ data: number[]; error: null }>((done) => {
          resolve = done;
        }),
    );
    expect(dataProgress()).toEqual([]);
    resolve({ data: [1], error: null });
    expect((await pending).data).toEqual([1]);
    expect(dataProgress()).toEqual([]);
  });
  it("retains explicit foreground progress and clears it on failure", async () => {
    const build = vi.fn(async () => {
      throw new Error("read failed");
    });
    const pending = readAllPages(build, { showProgress: true });
    expect(dataProgress()).toHaveLength(1);
    await expect(pending).rejects.toThrow("read failed");
    expect(dataProgress()).toEqual([]);
  });
  it("only refreshes queries that read a changed table", () => {
    const changes = new Set(["purchase_orders"]);
    expect(
      queryReadsChangedTables({ tables: ["purchase_orders", "purchase_order_items"] }, changes),
    ).toBe(true);
    expect(queryReadsChangedTables({ tables: ["products"] }, changes)).toBe(false);
    expect(queryReadsChangedTables(undefined, changes)).toBe(false);
    expect(queryReadsChangedTables({ tables: "purchase_orders" }, changes)).toBe(false);
  });
});
