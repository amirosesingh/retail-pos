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

  it("reads another tab's advanced shared cursor instead of reusing its cached number", async () => {
    const values = new Map<string, string>();
    window.localStorage.getItem = vi.fn(key => values.get(key) ?? null);
    window.localStorage.setItem = vi.fn((key, value) => { values.set(key, value); });
    const tabA = await import("../sku");
    expect(await tabA.nextSku([], { storeId: "cluster-a" })).toBe("SKU-000001");
    vi.resetModules();
    const tabB = await import("../sku");
    expect(await tabB.nextSku([], { storeId: "cluster-b" })).toBe("SKU-000002");
    expect(await tabA.nextSku([], { storeId: "cluster-a" })).toBe("SKU-000003");
    expect(reserveSkuLease).toHaveBeenCalledTimes(1);
  });

  it("does not resurrect a cached cursor after another tab exhausts the shared range", async () => {
    const values = new Map<string, string>();
    window.localStorage.getItem = vi.fn(key => values.get(key) ?? null);
    window.localStorage.setItem = vi.fn((key, value) => { values.set(key, value); });
    const tabA = await import("../sku");
    expect(await tabA.nextSku([])).toBe("SKU-000001");
    const key = "pos.sku.global-lease.v1";
    const exhausted = JSON.parse(values.get(key)!);
    values.set(key, JSON.stringify({ ...exhausted, next: exhausted.end + 1 }));
    reserveSkuLease.mockResolvedValueOnce({ ok: true, lease: { lease_id: "22222222-2222-4222-a222-222222222222", start_value: 251, end_value: 500, prefix: "SKU-", padding: 6 } });
    expect(await tabA.nextSku([])).toBe("SKU-000251");
  });
});
