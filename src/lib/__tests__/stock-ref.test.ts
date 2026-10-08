import { beforeEach, describe, expect, it, vi } from "vitest";

const values = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key),
  clear: () => values.clear(),
});

vi.mock("@/core/local-db/local-db", () => ({
  readLocalSetting: vi.fn(async () => null),
  writeLocalSetting: vi.fn(async () => true),
}));

import { documentOrigin } from "@/lib/document-origin";
import { nextStockRef, previewStockRef } from "@/lib/stock-ref";

describe("stock reference compatibility", () => {
  beforeEach(() => values.clear());

  it("continues the legacy SO counter while displaying the new SC prefix", async () => {
    values.set("pos.stockref.seq", JSON.stringify({ "stock|SO|B1|202610": 42 }));
    const at = new Date("2026-10-01T00:00:00Z");

    expect(previewStockRef({}, "B1", "stock", at)).toBe(`SC-${documentOrigin("B1")}-202610-0042`);
    expect(await nextStockRef({}, "B1", "stock", at)).toBe(`SC-${documentOrigin("B1")}-202610-0042`);
    expect(previewStockRef({}, "B1", "stock", at)).toBe(`SC-${documentOrigin("B1")}-202610-0043`);
  });
});
