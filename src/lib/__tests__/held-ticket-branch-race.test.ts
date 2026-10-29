import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ refs: [] as { current: unknown }[], cursor: 0, load: vi.fn(), status: vi.fn(), update: vi.fn(), draft: null as null | ((action: string) => Promise<unknown>) }));
vi.mock("react", () => ({
  useRef: (initial: unknown) => { const index = h.cursor++; return h.refs[index] ??= { current: initial }; },
  useCallback: (fn: unknown) => fn,
  useEffect: (fn: () => unknown) => { fn(); },
}));
vi.mock("@/core/api/pos-db", () => ({ db: { setHeldOrderStatus: h.status } }));
vi.mock("@/lib/held-orders", () => ({ useHeldOrders: () => [], loadHeldOrder: h.load, updateHeldOrder: h.update, addHeldOrder: vi.fn() }));
vi.mock("@/lib/session-draft", () => ({ draftTicketId: () => "draft", registerSessionDraft: (fn: typeof h.draft) => { h.draft = fn; return () => {}; } }));
vi.mock("@/lib/approval-centre", () => ({ claimApproval: vi.fn(), loadApprovalCentre: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notifyError: vi.fn() }));
vi.mock("@/lib/ticket-audit", () => ({ TICKET_ACTIONS: {}, logTicketEvent: vi.fn() }));
vi.mock("@/lib/document-origin", () => ({ documentDevice: () => "web" }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() } }));
import { useRegisterHeldOrders } from "../register/use-held-orders";
const setters = () => ({ setLines: vi.fn(), setCartDiscount: vi.fn(), setCartDiscountType: vi.fn(), setExchangeRef: vi.fn(), setMemberId: vi.fn(), setCoupon: vi.fn(), setBillNo: vi.fn(), resetCart: vi.fn() });
function render(branch: string, updates: ReturnType<typeof setters>) {
  h.cursor = 0;
  // eslint-disable-next-line react-hooks/rules-of-hooks -- deterministic hook dispatcher exercises async branch changes.
  return useRegisterHeldOrders({ storeId: branch, shiftId: "shift", lines: [], total: 0, cartDiscount: 0, cartDiscountType: "amount", exchangeRef: null, memberId: null, memberName: null, coupon: null, billNo: null, cashier: "Cashier", ensureBillNumber: async () => "BILL", ...updates });
}
beforeEach(() => { h.refs = []; h.cursor = 0; h.load.mockReset(); h.status.mockReset(); h.update.mockReset(); h.draft = null; });
it("does not inject an old-branch held ticket after a delayed load resolves", async () => {
  let finish!: (row: unknown) => void;
  h.load.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const old = setters(), next = setters();
  const opening = render("a", old).resumeHeld("held");
  render("b", next);
  finish({ id: "held", storeId: "a", lines: [{ productId: "p", qty: 1 }], billNo: "A-BILL", status: "held" });
  await opening;
  expect(old.setLines).not.toHaveBeenCalled(); expect(next.setLines).not.toHaveBeenCalled(); expect(h.status).not.toHaveBeenCalled();
});
it("blocks branch preservation while a held ticket is still opening", async () => {
  let finish!: (row: unknown) => void;
  h.load.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const opening = render("a", setters()).resumeHeld("held");
  await expect(h.draft!("hold")).rejects.toThrow("finish opening");
  finish(null); await opening;
});
