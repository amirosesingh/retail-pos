import { describe, expect, it } from "vitest";
import { readAllPages } from "@/lib/paged-read";

type Row = { id: number };

/** A fake table of `total` rows that answers row windows. */
const table = (total: number, opts: { withCount?: boolean; failAt?: number } = {}) => {
  const calls: Array<[number, number]> = [];
  const rows = Array.from({ length: total }, (_, i) => ({ id: i }));
  const build = async (from: number, to: number) => {
    calls.push([from, to]);
    if (opts.failAt !== undefined && from === opts.failAt) {
      return { data: null, error: { message: "line dropped" }, count: null };
    }
    return {
      data: rows.slice(from, to + 1),
      error: null,
      count: opts.withCount === false ? null : total,
    };
  };
  return { build, calls };
};

describe("readAllPages", () => {
  it("returns everything past the first window", async () => {
    const t = table(2500);
    const res = await readAllPages<Row>(t.build, { pageSize: 1000 });
    expect(res.error).toBeNull();
    expect(res.data?.length).toBe(2500);
    expect(res.total).toBe(2500);
    expect(res.data?.[2499]?.id).toBe(2499);
  });

  it("requests an exact count only for the first window", async () => {
    const counted: boolean[] = [];
    const t = table(2500);
    await readAllPages<Row>((from, to, withCount) => {
      counted.push(withCount);
      return t.build(from, to);
    });
    expect(counted).toEqual([true, false, false]);
  });

  it("handles an exact multiple of the window size", async () => {
    const t = table(2000);
    const res = await readAllPages<Row>(t.build, { pageSize: 1000 });
    expect(res.data?.length).toBe(2000);
  });

  it("stops after one request for a short table", async () => {
    const t = table(12);
    const res = await readAllPages<Row>(t.build, { pageSize: 1000 });
    expect(res.data?.length).toBe(12);
    expect(t.calls.length).toBe(1);
  });

  it("handles an empty table", async () => {
    const t = table(0);
    const res = await readAllPages<Row>(t.build, { pageSize: 1000 });
    expect(res.data).toEqual([]);
    expect(res.total).toBe(0);
  });

  it("walks forward when the database gives no count", async () => {
    const t = table(2300, { withCount: false });
    const res = await readAllPages<Row>(t.build, { pageSize: 1000 });
    expect(res.data?.length).toBe(2300);
    expect(t.calls.length).toBe(3);
  });

  it("reports a mid-way failure instead of a partial list", async () => {
    const t = table(3000, { failAt: 1000 });
    const res = await readAllPages<Row>(t.build, { pageSize: 1000 });
    expect(res.data).toBeNull();
    expect(res.error?.message).toBe("line dropped");
  });

  it("stops at the hard ceiling", async () => {
    const t = table(5000, { withCount: false });
    const res = await readAllPages<Row>(t.build, { pageSize: 1000, maxRows: 2000 });
    expect(res.capped).toBe(true);
    expect(res.data?.length).toBe(2000);
  });

  it("loads a 100,000-item catalogue without truncating the 1,000-row API windows", async () => {
    const t = table(100_000);
    const res = await readAllPages<Row>(t.build);
    expect(res.error).toBeNull();
    expect(res.capped).toBe(false);
    expect(res.total).toBe(100_000);
    expect(res.data).toHaveLength(100_000);
    expect(res.data?.at(-1)?.id).toBe(99_999);
    expect(t.calls).toHaveLength(100);
  });
});
