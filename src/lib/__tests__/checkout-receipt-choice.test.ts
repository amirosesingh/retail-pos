import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  record: vi.fn(),
  print: vi.fn(),
  drawer: vi.fn(),
  reset: vi.fn(),
  canDrawer: true,
}));
vi.mock("@/lib/pos-store", () => ({
  usePos: () => ({
    state: {
      products: [],
      members: [],
      settings: {
        tax: { enabled: false },
        whatsapp: { enabled: false },
        integrations: {},
        payment: {},
      },
    },
    recordSale: mocks.record,
    createBooking: vi.fn(),
  }),
  money: (v: number) => v.toFixed(2),
  cartTotals: vi.fn(),
}));
vi.mock("@/lib/session-draft", () => ({ flushTicketDrafts: async () => "BILL-1" }));
vi.mock("@/lib/receipt-printer", () => ({ canOpenDrawer: () => mocks.canDrawer }));
vi.mock("@/lib/pos-print", () => ({
  printSaleReceipt: mocks.print,
  openCashDrawer: mocks.drawer,
  printBookingSlip: vi.fn(),
  printJobTag: vi.fn(),
}));
vi.mock("@/lib/whatsapp", () => ({
  buildBookingMessage: vi.fn(),
  buildSaleMessage: vi.fn(),
  sendBillOnWhatsApp: vi.fn(),
}));
vi.mock("@/lib/audit-log", () => ({ logger: { log: vi.fn() } }));
vi.mock("@/lib/coupons", () => ({ redeemVoucher: vi.fn() }));
vi.mock("@/lib/customer-display", () => ({ publishDisplay: vi.fn(), displayRounding: () => ({}) }));
vi.mock("@/platforms/web/components/pos/TenderSplit", () => ({ rememberBanks: vi.fn() }));
vi.mock("@/core/api/pos-db", () => ({ db: { saleAttemptExists: async () => "no" } }));
vi.mock("@/core/local-db/local-db", () => ({ localDb: () => null }));
vi.mock("@/lib/notify", () => ({ notifyError: vi.fn(), describeError: () => "failure" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
import { useCheckout, type CheckoutDeps } from "../register/use-checkout";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.canDrawer = true;
  mocks.record.mockImplementation(async (value) => ({ ...value, id: "sale", receiptNo: "BILL-1" }));
});
function checkout(print: boolean, method = "cash") {
  const deps = {
    getActiveShift: () => ({ id: "shift", state: "ACTIVE" }),
    getCurrentStore: () => ({ id: "branch" }),
    getActiveCashier: () => "Cashier",
    requirePermission: async () => true,
    getLines: () => [
      { productId: "p", name: "Product", qty: 1, price: 10, taxRate: 0, discount: 0 },
    ],
    getTotals: () => ({ subtotal: 10, discount: 0, tax: 0, total: 10 }),
    getMember: () => null,
    getMemberId: () => null,
    getCoupon: () => null,
    getVoucherToken: () => null,
    getExchangeRef: () => null,
    getPointsEarned: () => 0,
    getBillNo: () => "BILL-1",
    getPrintReceipt: () => print,
    resetCart: mocks.reset,
    setLines: vi.fn(),
    setMemberId: vi.fn(),
    setVoucherToken: vi.fn(),
    getMethod: () => method,
    getTendered: () => "10",
    getTransferRef: () => "",
    getTenderRef: () => "",
    getTenderRefNote: () => "",
    getBankName: () => "Bank",
    getTenders: () => [],
    getActiveMethodName: () => method,
    getNeedsTenderRef: () => false,
    resetTender: vi.fn(),
    bookingIntake: {},
    getWaNumber: () => "",
    setWaNumber: vi.fn(),
    setWaSending: vi.fn(),
    cartSnapshot: () => ({}),
    getDisplayBase: () => ({}),
  } as unknown as CheckoutDeps;
  let hook!: ReturnType<typeof useCheckout>;
  function Harness() {
    hook = useCheckout(deps);
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
  return hook;
}
describe("per-bill receipt choice", () => {
  it("skips printing while preserving the committed cash sale and drawer pulse", async () => {
    await checkout(false).completeSale();
    expect(mocks.record).toHaveBeenCalledOnce();
    expect(mocks.drawer).toHaveBeenCalledOnce();
    expect(mocks.print).not.toHaveBeenCalled();
    expect(mocks.reset).toHaveBeenCalledOnce();
  });
  it("keeps ordinary printing and cash drawer behaviour for the next printed bill", async () => {
    await checkout(true).completeSale();
    expect(mocks.record).toHaveBeenCalledOnce();
    expect(mocks.print).toHaveBeenCalledOnce();
    expect(mocks.drawer).toHaveBeenCalledOnce();
  });
  it("does not add a drawer pulse for a card-only bill", async () => {
    await checkout(false, "card").completeSale();
    expect(mocks.record).toHaveBeenCalledOnce();
    expect(mocks.drawer).not.toHaveBeenCalled();
    expect(mocks.print).not.toHaveBeenCalled();
  });
  it("does not print or pulse the drawer when the payment failed", async () => {
    mocks.record.mockRejectedValue(new Error("Not saved"));
    await checkout(false).completeSale();
    expect(mocks.drawer).not.toHaveBeenCalled();
    expect(mocks.print).not.toHaveBeenCalled();
    expect(mocks.reset).not.toHaveBeenCalled();
  });
});
