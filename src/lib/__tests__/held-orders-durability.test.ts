import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

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

  it("keeps branch, approval and cart races behind durable boundaries", () => {
    const store = readFileSync("src/lib/held-orders.ts", "utf8");
    const register = readFileSync("src/lib/register/use-held-orders.ts", "utf8");
    const approval = readFileSync("src/lib/approval-centre.ts", "utf8");
    const receipts = readFileSync("src/routes/receipts.tsx", "utf8");

    expect(store).toContain("requestSequence !== electronReadSequence");
    expect(store).toContain("order.storeId === storeId");
    expect(register).toContain("ticketSignature(latestDeps.current) !== originalSignature");
    expect(register.indexOf("await removeHeldOrder(id)")).toBeLessThan(
      register.indexOf("const claimed = await claimApproval"),
    );
    expect(register).toContain('status: "waiting" as const');
    expect(register).toContain("pendingRequestId: pending.requestId");
    expect(approval).toContain("await Promise.all(readiness)");
    expect(receipts).toContain("Retry preparing correction");
  });
});
