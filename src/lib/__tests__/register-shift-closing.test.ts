import { readFileSync } from "node:fs";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Shift, ShiftState } from "@/core/types/pos-types";

const mocks = vi.hoisted(() => ({
  refs: [] as Array<{ current: unknown }>,
  cursor: 0,
  add: vi.fn(),
  register: vi.fn(),
  activeShift: null as Shift | null,
}));

vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useRef: (value: unknown) => mocks.refs[mocks.cursor++] ??= { current: value },
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => unknown) => { effect(); },
  useState: (value: unknown) => [value, vi.fn()],
}));
vi.mock("@/core/api/pos-db", () => ({ db: {}, commitLabel: vi.fn() }));
vi.mock("@/lib/held-orders", () => ({
  useHeldOrders: () => [], addHeldOrder: mocks.add, loadHeldOrder: vi.fn(), updateHeldOrder: vi.fn(),
}));
vi.mock("@/lib/session-draft", () => ({ draftTicketId: () => "draft", registerSessionDraft: mocks.register }));
vi.mock("@/lib/document-origin", () => ({ documentDevice: () => "web" }));
vi.mock("@/lib/approval-centre", () => ({ claimApproval: vi.fn(), loadApprovalCentre: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notifyError: vi.fn() }));
vi.mock("@/lib/ticket-audit", () => ({ TICKET_ACTIONS: {}, logTicketEvent: vi.fn() }));
vi.mock("@/lib/pos-store", () => ({ usePos: () => ({ activeShift: mocks.activeShift }) }));
vi.mock("@/lib/pos-auth", () => ({ useAuth: () => ({ can: () => false }) }));
vi.mock("@/platforms/web/components/pos/ShiftCloseDialog", () => ({ ShiftCloseDialog: () => null }));

import { shiftIsClosing, shiftIsOpenForBranch } from "../branch-shift-state";
import { useRegisterHeldOrders } from "../register/use-held-orders";
import { ShiftGuard } from "@/platforms/web/components/pos/ShiftGuard";
import { ShiftCloseDialog } from "@/platforms/web/components/pos/ShiftCloseDialog";

const shift = (state?: ShiftState): Shift => ({
  id: "shift", storeId: "branch", openedAt: "2026-11-28T00:00:00Z", closedAt: null,
  cashier: "Cashier", openingFloat: 10, countedCash: null, note: "", status: "OPEN", state,
});
const resetCart = vi.fn();
const cart = (state: ShiftState | undefined, qty: number) => {
  const active = shift(state);
  mocks.cursor = 0;
  // eslint-disable-next-line react-hooks/rules-of-hooks -- deterministic hook dispatcher.
  return useRegisterHeldOrders({
    shiftId: active.id, shiftClosing: shiftIsClosing(active), storeId: active.storeId, billNo: "BILL",
    cashier: active.cashier, lines: [{ productId: "item", name: "Item", qty, price: 1, taxRate: 0, discount: 0 }],
    total: qty, cartDiscount: 0, cartDiscountType: "amount", exchangeRef: null, memberId: null, memberName: null,
    coupon: null, ensureBillNumber: async () => "BILL", setLines: vi.fn(), setCartDiscount: vi.fn(),
    setCartDiscountType: vi.fn(), setExchangeRef: vi.fn(), setMemberId: vi.fn(), setCoupon: vi.fn(),
    setBillNo: vi.fn(), resetCart,
  });
};

beforeEach(() => {
  mocks.refs = [];
  mocks.cursor = 0;
  mocks.add.mockReset();
  mocks.register.mockClear();
  resetCart.mockClear();
});
afterEach(() => { vi.useRealTimers(); });

it.each(["CLOSING_STARTED", "CASH_COUNT_REQUIRED"] as const)("keeps the bill mounted and inert during %s", state => {
  const ticket = "Unfinished bill";
  type GuardView = ReactElement<{ children: [unknown, ReactElement<{ children: ReactNode; inert: boolean }>, ReactElement] }>;
  mocks.activeShift = shift("ACTIVE");
  const active = ShiftGuard({ children: ticket }) as GuardView;
  mocks.activeShift = shift(state);
  const closing = ShiftGuard({ children: ticket }) as GuardView;
  expect(shiftIsOpenForBranch(mocks.activeShift, "branch")).toBe(true);
  expect(closing.type).toBe(active.type);
  expect(closing.props.children[1].type).toBe(active.props.children[1].type);
  expect(closing.props.children[1].key).toBe(active.props.children[1].key);
  expect(active.props.children[1].props).toMatchObject({ children: ticket, inert: false });
  expect(closing.props.children[1].props).toMatchObject({ children: ticket, inert: true });
  expect(closing.props.children[2].type).toBe(ShiftCloseDialog);
});

it.each(["ACTIVE", undefined] as const)("saves the draft when the lifecycle is %s", async state => {
  vi.useFakeTimers();
  cart(state, 1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(mocks.add).toHaveBeenCalledOnce();
});

it("leaves the draft untouched if the close begins before a scheduled save", async () => {
  vi.useFakeTimers();
  cart("ACTIVE", 1);
  cart("CASH_COUNT_REQUIRED", 1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(mocks.add).not.toHaveBeenCalled();
  expect(resetCart).not.toHaveBeenCalled();
});

it("still saves the explicit draft flush before closing", async () => {
  vi.useFakeTimers();
  cart("ACTIVE", 1);
  const flushDraft = mocks.register.mock.lastCall?.[0] as (action: string) => Promise<string>;
  await expect(flushDraft("save")).resolves.toBe("BILL");
  cart("CASH_COUNT_REQUIRED", 1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(mocks.add).toHaveBeenCalledOnce();
});

it("preserves an in-flight save and skips a second background write queued before closing", async () => {
  vi.useFakeTimers();
  let finishSave!: () => void;
  mocks.add.mockImplementationOnce(() => new Promise<void>(resolve => { finishSave = resolve; }));
  cart("ACTIVE", 1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(mocks.add).toHaveBeenCalledOnce();
  cart("ACTIVE", 2);
  await vi.advanceTimersByTimeAsync(1000);
  cart("CASH_COUNT_REQUIRED", 2);
  finishSave();
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.add).toHaveBeenCalledOnce();
  expect(resetCart).not.toHaveBeenCalled();
});

it("uses the closing state in the register status and new shift dialog", () => {
  const source = readFileSync(new URL("../../routes/index.tsx", import.meta.url), "utf8");
  expect(source).toContain("const shiftClosing = shiftIsClosing(activeShift)");
  expect(source).toContain('shiftClosing ? "Closing" : activeShift ? "Shift open"');
  expect(source).toContain("open={openShiftOpen && !shiftClosing}");
  expect(source).toContain("open={Boolean(activeShift && !shiftClosing && closeShiftDialogId === activeShift.id)}");
});
