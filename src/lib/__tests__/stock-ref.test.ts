import { beforeEach, describe, expect, it, vi } from "vitest";

const values = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key),
  clear: () => values.clear(),
});

vi.mock("@/core/local-db/local-db", () => ({
  localDb: () => null,
  readLocalSetting: vi.fn(async () => null),
  writeLocalSetting: vi.fn(async () => true),
}));

const cloudCounters = vi.hoisted(() => new Map<string, number>());
vi.mock("@/lib/pos-caller-auth", () => ({ getPosCallerAuth: async () => ({}) }));
vi.mock("@/lib/stock-ref.functions", () => ({
  reserveCloudStockReference: vi.fn(
    async ({ data }: { data: { prefix: string; minimum: number } }) => {
      const sequence = Math.max(data.minimum, cloudCounters.get(data.prefix) ?? 1);
      cloudCounters.set(data.prefix, sequence + 1);
      return { ok: true, sequence };
    },
  ),
}));
import { billPrefix } from "@/lib/bill-number";
import { nextStockRef, previewStockRef, periodStamp } from "@/lib/stock-ref";

describe("stock reference compatibility", () => {
  beforeEach(() => {
    values.clear();
    cloudCounters.clear();
  });

  it("continues the legacy SO counter while displaying the new SC prefix", async () => {
    values.set("pos.stockref.seq", JSON.stringify({ "stock|SO|B1|202610": 42 }));
    const at = new Date("2026-10-01T00:00:00Z");

    expect(previewStockRef({ reset: "monthly" }, "B1", "stock", at)).toBe(`SC-${billPrefix("B1", at).replace(/-\d{8}$/, "")}-202610-0042`);
    expect(await nextStockRef({ reset: "monthly" }, "B1", "stock", at)).toBe(
      `SC-${billPrefix("B1", at).replace(/-\d{8}$/, "")}-202610-0042`,
    );
    expect(await nextStockRef({ reset: "monthly" }, "B1", "stock", at)).toBe(
      `SC-${billPrefix("B1", at).replace(/-\d{8}$/, "")}-202610-0043`,
    );
  });

  it("uses the bill till and full date for new default references in each series", async () => {
    const at = new Date(2026, 9, 23);
    for (const [series, prefix] of [["stock", "SC"], ["request", "SR"], ["transfer", "ST"], ["receiving", "GRN"]] as const) {
      const expected = `${prefix}-${billPrefix("B1", at)}-0001`;
      expect(previewStockRef({}, "B1", series, at)).toBe(expected);
      expect(await nextStockRef({}, "B1", series, at)).toBe(expected);
    }
  });

  it("preserves configured reset periods and starts a daily series on the next date", async () => {
    const at = new Date(2026, 9, 23);
    expect(periodStamp(at, "never")).toBe("");
    expect(periodStamp(at, "yearly")).toBe("2026");
    expect(periodStamp(at, "monthly")).toBe("202610");
    expect(periodStamp(at, "daily")).toBe("20261023");
    expect(await nextStockRef({}, "B1", "stock", at)).toMatch(/-20261023-0001$/);
    expect(await nextStockRef({}, "B1", "stock", at)).toMatch(/-20261023-0002$/);
    expect(await nextStockRef({}, "B1", "stock", new Date(2026, 9, 24))).toMatch(/-20261024-0001$/);
  });
});
