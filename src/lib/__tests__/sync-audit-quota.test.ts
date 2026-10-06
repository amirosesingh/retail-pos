import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
}));

vi.mock("../business-storage", () => ({
  readBusinessValue: storage.read,
  writeBusinessValue: storage.write,
}));

import { recordSync } from "../sync-audit";

describe("sync audit storage bounds", () => {
  beforeEach(() => {
    storage.read.mockReset();
    storage.write.mockReset();
    (globalThis as unknown as { window: Record<string, unknown> }).window = {};
  });

  it("compacts a full browser ledger without rejecting synchronization", () => {
    storage.read.mockReturnValue(
      JSON.stringify(
        Array.from({ length: 300 }, (_, index) => ({
          id: String(index),
          at: new Date(0).toISOString(),
          direction: "pull",
          entity: "products",
          records: 0,
          status: "failed",
          error: "x".repeat(20_000),
        })),
      ),
    );
    storage.write
      .mockImplementationOnce(() => {
        throw new DOMException("quota", "QuotaExceededError");
      })
      .mockImplementationOnce(() => {
        throw new DOMException("quota", "QuotaExceededError");
      })
      .mockImplementation(() => undefined);

    expect(() =>
      recordSync({
        direction: "pull",
        entity: "products",
        status: "failed",
        error: "x".repeat(50_000),
      }),
    ).not.toThrow();
    expect(storage.write).toHaveBeenCalledTimes(3);
    const saved = String(storage.write.mock.calls.at(-1)?.[1] ?? "");
    expect(saved.length).toBeLessThanOrEqual(256_000);
  });
});
