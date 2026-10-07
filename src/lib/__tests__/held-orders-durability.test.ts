import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  commitHeldOrder: vi.fn(),
  removeHeldOrder: vi.fn(),
  listHeldOrders: vi.fn(),
}));

vi.mock("@/core/api/pos-db", () => ({ db: database }));
vi.mock("@/lib/business-storage", () => ({
  readBusinessValue: vi.fn(() => null),
  writeBusinessValue: vi.fn(),
}));

import {
  addHeldOrder,
  readHeldOrders,
  removeHeldOrder,
  rowToHeldOrder,
  setHeldOrders,
  type HeldOrder,
} from "@/lib/held-orders";

const order: HeldOrder = {
  id: "held-1",
  label: "10:30 · 1 item",
  total: 12,
  lines: [
    { productId: "product-1", name: "Tea", qty: 1, price: 12, taxRate: 0, discount: 0 },
  ],
  heldAt: "2026-10-08T10:30:00.000Z",
  storeId: "branch-1",
};

describe("held order durability", () => {
  beforeEach(() => {
    database.commitHeldOrder.mockReset();
    database.removeHeldOrder.mockReset();
    database.listHeldOrders.mockReset();
    vi.stubGlobal("CustomEvent", class {
      constructor(public type: string) {}
    });
    vi.stubGlobal("window", {
      pos: {},
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    setHeldOrders(() => []);
  });

  it("does not show a ticket until the database confirms the hold", async () => {
    let confirm!: () => void;
    database.commitHeldOrder.mockReturnValue(
      new Promise<void>((resolve) => {
        confirm = resolve;
      }),
    );

    const saving = addHeldOrder(order);
    expect(readHeldOrders()).toEqual([]);

    confirm();
    await saving;
    expect(readHeldOrders()).toEqual([order]);
  });

  it("keeps a ticket visible when its database removal fails", async () => {
    database.commitHeldOrder.mockResolvedValue("local");
    database.removeHeldOrder.mockRejectedValue(new Error("SQL unavailable"));
    await addHeldOrder(order);

    await expect(removeHeldOrder(order.id)).rejects.toThrow("SQL unavailable");
    expect(readHeldOrders()).toEqual([order]);
  });

  it("decodes SQL JSON fields without crashing on a damaged optional value", () => {
    const decoded = rowToHeldOrder({
      id: "held-2",
      label: "Draft",
      total: "5.50",
      lines: JSON.stringify(order.lines),
      coupon: "not-json",
      held_at: order.heldAt,
      store_id: "branch-1",
    });

    expect(decoded.lines).toEqual(order.lines);
    expect(decoded.coupon).toBeNull();
    expect(decoded.total).toBe(5.5);
  });
});
