import { describe, expect, it } from "vitest";
import { readCataloguePages } from "../catalogue-read";

describe("count-free product catalogue", () => {
  it.each([0, 1, 6, 7, 9])("loads %i rows completely, including an exact ceiling", async count => {
    const all = Array.from({ length: count }, (_, i) => ({ id: String(i + 1).padStart(4, "0") }));
    const limits: number[] = [];
    const result = await readCataloguePages(async (after, limit) => {
      limits.push(limit);
      return { data: all.filter(row => row.id > after).slice(0, limit), error: null };
    }, () => {}, { pageSize: 3, maxRows: 9 });
    expect(result).toEqual({ data: all, error: null, total: count, capped: false });
    if (count === 9) expect(limits).toEqual([3, 3, 3, 1]);
  });

  it("detects extra rows without exposing an incomplete catalogue as complete", async () => {
    const all = Array.from({ length: 10 }, (_, i) => ({ id: String(i + 1).padStart(4, "0") }));
    const result = await readCataloguePages(async (after, limit) => ({
      data: all.filter(row => row.id > after).slice(0, limit), error: null,
    }), () => {}, { pageSize: 3, maxRows: 9 });
    expect(result.capped).toBe(true);
    expect(result.data).toHaveLength(9);
    expect(result.total).toBeNull();
  });

  it("fails closed if a later page or ceiling probe fails", async () => {
    let calls = 0;
    const result = await readCataloguePages(async () => ++calls === 1
      ? { data: [{ id: "a" }], error: null }
      : { data: null, error: { message: "session ended" } }, () => {}, { pageSize: 1, maxRows: 1 });
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe("session ended");
  });

  it("rejects a non-advancing cursor instead of looping", async () => {
    const result = await readCataloguePages(async () => ({ data: [{ id: "a" }], error: null }), () => {}, { pageSize: 1, maxRows: 5 });
    expect(result.data).toBeNull();
    expect(result.error?.message).toContain("cursor");
  });
});
