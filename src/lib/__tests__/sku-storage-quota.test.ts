import { beforeEach, describe, expect, it, vi } from "vitest";

const reserveSkuLease = vi.hoisted(() => vi.fn());

vi.mock("../sku.functions", () => ({ reserveSkuLease }));
vi.mock("../pos-caller-auth", () => ({ getPosCallerAuth: vi.fn(async () => ({})) }));
vi.mock("../external-supabase-config", () => ({
  supabaseConfig: vi.fn(() => ({
    url: "https://example.supabase.co",
    publishableKey: "test",
  })),
}));

describe("SKU allocation when browser storage is full", () => {
  beforeEach(() => {
    vi.resetModules();
    reserveSkuLease.mockReset();
    reserveSkuLease.mockResolvedValue({
      ok: true,
      lease: {
        lease_id: "11111111-1111-4111-a111-111111111111",
        start_value: 1,
        end_value: 250,
        prefix: "SKU-",
        padding: 6,
      },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: vi.fn(() => null),
          setItem: vi.fn(() => {
            throw new DOMException("quota", "QuotaExceededError");
          }),
        },
      },
    });
  });

  it("keeps using one reserved range in memory and still returns unique SKUs", async () => {
    const { nextSku } = await import("../sku");

    const first = await nextSku([], { storeId: "branch-1", terminalId: "terminal-1" });
    const second = await nextSku([first], { storeId: "branch-1", terminalId: "terminal-1" });

    expect(first).toBe("SKU-000001");
    expect(second).toBe("SKU-000002");
    expect(reserveSkuLease).toHaveBeenCalledTimes(1);
  });
});
