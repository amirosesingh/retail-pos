import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const database = vi.hoisted(() => ({
  commitHeldOrder: vi.fn(),
  removeHeldOrder: vi.fn(),
  listHeldOrders: vi.fn(),
}));
const secrets = vi.hoisted(() => new Map<string, unknown>());

vi.mock("@/core/api/pos-db", () => ({ db: database }));
vi.mock("@/lib/business-storage", () => ({
  readBusinessValue: vi.fn(() => null),
  writeBusinessValue: vi.fn(),
}));
vi.mock("@/lib/device-secrets", () => ({
  getDeviceSecret: vi.fn(async (name: string) => {
    await Promise.resolve();
    return structuredClone(secrets.get(name));
  }),
  setDeviceSecret: vi.fn(async (name: string, value: unknown) => {
    await Promise.resolve();
    secrets.set(name, structuredClone(value));
  }),
  clearDeviceSecret: vi.fn((name: string) => secrets.delete(name)),
}));

import {
  addHeldOrder,
  readHeldOrders,
  removeHeldOrder,
  rememberPendingCorrectionHold,
  loadPendingCorrectionHold,
  rowToHeldOrder,
  setHeldOrders,
  updateHeldOrder,
  markHeldReady,
  holdCancelledBill,
  loadHeldOrder,
  saleCorrectionContext,
  type HeldOrder,
} from "@/lib/held-orders";

const order: HeldOrder = {
  id: "held-1",
  label: "10:30 · 1 item",
  total: 12,
  lines: [{ productId: "product-1", name: "Tea", qty: 1, price: 12, taxRate: 0, discount: 0 }],
  heldAt: "2026-10-08T10:30:00.000Z",
  storeId: "branch-1",
};

describe("held order durability", () => {
  beforeEach(() => {
    database.commitHeldOrder.mockReset();
    database.removeHeldOrder.mockReset();
    database.listHeldOrders.mockReset();
    secrets.clear();
    vi.stubGlobal(
      "CustomEvent",
      class {
        constructor(public type: string) {}
      },
    );
    vi.stubGlobal("window", {
      pos: {},
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    setHeldOrders(() => []);
  });

  it("loads a correction deep link before the shared cache is ready", async () => {
    setHeldOrders(() => []);
    database.listHeldOrders.mockResolvedValue([{id:"correction",store_id:"branch-1",lines:order.lines,status:"held",total:12}]);
    expect(await loadHeldOrder("correction")).toMatchObject({id:"correction",storeId:"branch-1"});
    database.listHeldOrders.mockResolvedValue([{id:"completed",status:"completed"}]);
    expect(await loadHeldOrder("completed")).toBeUndefined();
  });

  it("preserves correction discounts, member and coupon without counting coupon money twice", async () => {
    const sale = {discount:25,memberId:"member",couponCode:"SAVE",couponPromoId:"promo",couponScope:"bill",couponDiscount:5,createdAt:order.heldAt,lines:[{...order.lines[0],price:100,discount:10,discountType:"percent"}]} as import("@/core/types/pos-types").Sale;
    const context = saleCorrectionContext(sale);
    expect(context.cartDiscount).toBe(10);
    const prepared = await holdCancelledBill({id:"correction-context",receiptNo:"R1",lines:sale.lines,storeId:"branch-1",total:75,...context});
    expect(prepared).toMatchObject({cartDiscount:10,cartDiscountType:"amount",memberId:"member",coupon:{code:"SAVE",discount:5},lines:sale.lines});
    expect(database.commitHeldOrder).toHaveBeenCalledWith(expect.objectContaining({cartDiscount:10,memberId:"member",coupon:context.coupon}));
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

  it("approval polling changes a waiting ticket once and never reopens a completed bill", async () => {
    database.commitHeldOrder.mockResolvedValue("local");
    await addHeldOrder({...order,status:"waiting"});
    database.commitHeldOrder.mockClear();
    await markHeldReady(order.id);
    await markHeldReady(order.id);
    expect(database.commitHeldOrder).toHaveBeenCalledOnce();
    setHeldOrders(()=>[{...order,status:"completed"}]);
    database.commitHeldOrder.mockClear();
    await markHeldReady(order.id);
    expect(database.commitHeldOrder).not.toHaveBeenCalled();
    expect(readHeldOrders()[0].status).toBe("completed");
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

  it("updates a durable ticket before the Electron renderer cache hydrates", async () => {
    database.listHeldOrders.mockResolvedValue([
      {
        id: order.id,
        label: order.label,
        total: order.total,
        lines: JSON.stringify(order.lines),
        held_at: order.heldAt,
        store_id: order.storeId,
        status: "waiting",
      },
    ]);
    database.commitHeldOrder.mockResolvedValue("local");

    await updateHeldOrder(order.id, { status: "ready" });

    expect(database.commitHeldOrder).toHaveBeenCalledWith(
      expect.objectContaining({ id: order.id, status: "ready", storeId: order.storeId }),
    );
    expect(readHeldOrders()).toEqual([expect.objectContaining({ id: order.id, status: "ready" })]);
  });

  it("serializes overlapping correction retries without dropping either sale", async () => {
    const first = {
      receiptNo: "R-1",
      total: 10,
      lines: order.lines,
      storeId: "branch-1",
      saleId: "sale-1",
    };
    const second = { ...first, receiptNo: "R-2", saleId: "sale-2" };

    await Promise.all([
      rememberPendingCorrectionHold(first),
      rememberPendingCorrectionHold(second),
    ]);

    expect(await loadPendingCorrectionHold("sale-1")).toEqual(first);
    expect(await loadPendingCorrectionHold("sale-2")).toEqual(second);
  });

  it("keeps branch, approval and cart races behind durable boundaries", () => {
    const store = readFileSync("src/lib/held-orders.ts", "utf8");
    const register = readFileSync("src/lib/register/use-held-orders.ts", "utf8");
    const approval = readFileSync("src/lib/approval-centre.ts", "utf8");
    const receipts = readFileSync("src/routes/receipts.tsx", "utf8");

    expect(store).toContain("requestSequence === electronReadSequence");
    expect(store).toContain("const rows = await db.listHeldOrders()");
    expect(store).toContain("const current = loaded ?? readHeldOrders()");
    expect(store).toContain("order.storeId === storeId");
    expect(register).toContain("ticketSignature({ ...latestDeps.current, billNo: deps.billNo }) !== originalSignature");
    expect(register.indexOf('await db.setHeldOrderStatus(id, "draft")')).toBeGreaterThan(
      register.indexOf("const claimed = await claimApproval"),
    );
    expect(register).toContain("The ticket stayed in Holds and needs approval again");
    expect(register).toContain('await db.setHeldOrderStatus(parked.id, "draft")');
    expect(register).toContain("deps.setLines(parked.lines)");
    expect(register).toContain("Your open ticket is safely available in Holds");
    expect(register).toContain('status: "waiting" as const');
    expect(register).toContain("pendingRequestId: pending.requestId");
    expect(approval).toContain("await Promise.all(readiness)");
    expect(receipts).toContain("Retry preparing correction");
  });
});
