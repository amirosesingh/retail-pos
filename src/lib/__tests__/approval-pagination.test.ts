import { describe, expect, it, vi } from "vitest";
import { readApprovalPage } from "../approval-pagination";

describe("approval history pagination", () => {
  const readFrom = <T>(rows: T[]) => vi.fn(async (offset: number, limit: number) => rows.slice(offset, offset + limit));
  const visible = async <T>(rows: T[]) => rows;
  it("reaches requests beyond the old 100-row cap without repeating page boundaries", async () => {
    const rows = Array.from({ length: 327 }, (_, id) => ({ id }));
    const read = readFrom(rows);
    const fifth = await readApprovalPage(read, visible, 5, 25);
    expect(fifth.requests.map(row => row.id)).toEqual(rows.slice(100, 125).map(row => row.id));
    expect(fifth.pageInfo.hasMore).toBe(true);
    const last = await readApprovalPage(read, visible, 14, 25);
    expect(last.requests).toEqual(rows.slice(325));
    expect(last.pageInfo.hasMore).toBe(false);
  });
  it("applies visibility before counting or filling pages, even across multiple raw batches", async () => {
    const rows = Array.from({ length: 650 }, (_, id) => ({ id, allowed: id >= 590 }));
    const read = readFrom(rows);
    const page = await readApprovalPage(read, async batch => batch.filter(row => row.allowed), 2, 25);
    expect(page.requests.map(row => row.id)).toEqual(rows.slice(615, 640).map(row => row.id));
    expect(page.requests.every(row => row.allowed)).toBe(true);
    expect(page.pageInfo.hasMore).toBe(true);
    expect(read).toHaveBeenCalledTimes(3);
  });
  it("clamps a page after requests disappear and returns an empty first page safely", async () => {
    const rows = [1, 2, 3];
    expect(await readApprovalPage(readFrom(rows), visible, 4, 10)).toEqual({ requests: rows, pageInfo: { page: 1, pageSize: 10, hasMore: false } });
    expect(await readApprovalPage(readFrom([]), visible, 1, 10)).toEqual({ requests: [], pageInfo: { page: 1, pageSize: 10, hasMore: false } });
  });
  it("does not advertise another page for an exact final page", async () => {
    const result = await readApprovalPage(readFrom(Array.from({ length: 50 }, (_, id) => id)), visible, 2, 25);
    expect(result.requests).toHaveLength(25);
    expect(result.pageInfo.hasMore).toBe(false);
  });
  it("does not return a partial history when a later SQL read fails", async () => {
    const read = vi.fn().mockResolvedValueOnce(Array.from({ length: 300 }, (_, id) => id)).mockRejectedValueOnce(new Error("connection lost"));
    await expect(readApprovalPage(read, visible, 13, 25)).rejects.toThrow("connection lost");
  });
});
