import { afterEach, beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ refs: [] as { current: unknown }[], cursor: 0, load: vi.fn(), status: vi.fn(), update: vi.fn(), add: vi.fn(), draft: null as null | ((action: string) => Promise<unknown>) }));
vi.mock("react", () => ({
  useRef: (initial: unknown) => { const index = h.cursor++; return h.refs[index] ??= { current: initial }; },
  useCallback: (fn: unknown) => fn,
  useEffect: (fn: () => unknown) => { fn(); },
}));
vi.mock("@/core/api/pos-db", () => ({ db: { setHeldOrderStatus: h.status } }));
vi.mock("@/lib/held-orders", () => ({ useHeldOrders: () => [], loadHeldOrder: h.load, updateHeldOrder: h.update, addHeldOrder: h.add }));
vi.mock("@/lib/session-draft", () => ({ draftTicketId: () => "draft", registerSessionDraft: (fn: typeof h.draft) => { h.draft = fn; return () => {}; } }));
vi.mock("@/lib/approval-centre", () => ({ claimApproval: vi.fn(), loadApprovalCentre: vi.fn() }));
vi.mock("@/lib/notify", () => ({ notifyError: vi.fn() }));
vi.mock("@/lib/ticket-audit", () => ({ TICKET_ACTIONS: {}, logTicketEvent: vi.fn() }));
vi.mock("@/lib/document-origin", () => ({ documentDevice: () => "web" }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() } }));
import { useRegisterHeldOrders } from "../register/use-held-orders";
import { __resetSessionEpoch, bumpSessionEpoch } from "../session-epoch";
import { toast } from "sonner";
const setters = () => ({ setLines: vi.fn(), setCartDiscount: vi.fn(), setCartDiscountType: vi.fn(), setExchangeRef: vi.fn(), setMemberId: vi.fn(), setCoupon: vi.fn(), setBillNo: vi.fn(), resetCart: vi.fn() });
function render(branch: string, updates: ReturnType<typeof setters>, overrides: Partial<Parameters<typeof useRegisterHeldOrders>[0]> = {}) {
  h.cursor = 0;
  // eslint-disable-next-line react-hooks/rules-of-hooks -- deterministic hook dispatcher exercises async branch changes.
  return useRegisterHeldOrders({ storeId: branch, shiftId: "shift", lines: [], total: 0, cartDiscount: 0, cartDiscountType: "amount", exchangeRef: null, memberId: null, memberName: null, coupon: null, billNo: null, cashier: "Cashier", ensureBillNumber: async () => "BILL", ...updates, ...overrides });
}
beforeEach(() => { h.refs = []; h.cursor = 0; h.load.mockReset(); h.status.mockReset(); h.update.mockReset(); h.add.mockReset(); h.draft = null; vi.mocked(toast.error).mockClear(); __resetSessionEpoch(); });
afterEach(() => { vi.useRealTimers(); });
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

const cart = (qty: number, shiftId = "shift") => ({
  billNo: "BILL",
  shiftId,
  total: qty,
  lines: [{ productId: "p", name: "Product", price: 1, qty, taxRate: 0, discount: 0 }],
});
const closedShift = Object.assign(new Error("This shift is closing or closed. The draft cannot be changed."), { code: "P0001" });

it("reports a rejected draft once and preserves the cart for an explicit retry", async () => {
  vi.useFakeTimers();
  const updates = setters();
  h.add.mockRejectedValueOnce(closedShift);
  render("a", updates, cart(1));
  await vi.advanceTimersByTimeAsync(1000);
  render("a", updates, cart(2));
  await vi.advanceTimersByTimeAsync(1000);
  expect(h.add).toHaveBeenCalledOnce();
  expect(toast.error).toHaveBeenCalledOnce();
  expect(updates.resetCart).not.toHaveBeenCalled();

  h.add.mockRejectedValueOnce(closedShift);
  await expect(h.draft!("save")).rejects.toBe(closedShift);
  await expect(h.draft!("save")).resolves.toBe("BILL");
  render("a", updates, cart(3));
  await vi.advanceTimersByTimeAsync(1000);
  expect(h.add).toHaveBeenCalledTimes(4);
  expect(h.add).toHaveBeenLastCalledWith(expect.objectContaining({
    id: "draft", status: "draft", billNo: "BILL", lines: [expect.objectContaining({ qty: 3 })],
  }));
});

it.each([
  new Error("Network request failed"),
  Object.assign(new Error(closedShift.message), { code: "ESQLSERVER_WRITE", sqlNumber: 51020 }),
])("keeps autosave eligible in a different context after $message", async failure => {
  vi.useFakeTimers();
  const updates = setters();
  h.add.mockRejectedValueOnce(closedShift).mockRejectedValueOnce(failure);
  render("a", updates, cart(1));
  await vi.advanceTimersByTimeAsync(1000);
  render("a", updates, cart(2, "other-shift"));
  await vi.advanceTimersByTimeAsync(1000);
  render("a", updates, cart(3, "other-shift"));
  await vi.advanceTimersByTimeAsync(1000);
  expect(h.add).toHaveBeenCalledTimes(3);
  expect(h.add).toHaveBeenLastCalledWith(expect.objectContaining({ shiftId: "other-shift" }));
});

it.each(["branch", "shift", "ticket", "session"])("ignores an old autosave rejection after a %s change", async changed => {
  vi.useFakeTimers();
  const updates = setters();
  let rejectSave!: (error: Error) => void;
  h.add.mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectSave = reject; }));
  render("a", updates, cart(1));
  await vi.advanceTimersByTimeAsync(1000);
  expect(h.add).toHaveBeenCalledOnce();

  if (changed === "session") bumpSessionEpoch();
  else render(changed === "branch" ? "b" : "a", updates, {
    ...cart(2, changed === "shift" ? "other-shift" : "shift"),
    billNo: changed === "ticket" ? "OTHER-BILL" : "BILL",
  });
  rejectSave(closedShift);
  await vi.advanceTimersByTimeAsync(0);
  expect(toast.error).not.toHaveBeenCalled();

  render("a", updates, cart(3));
  await vi.advanceTimersByTimeAsync(1000);
  expect(h.add).toHaveBeenCalledTimes(2);
  expect(updates.resetCart).not.toHaveBeenCalled();
});

it("keeps an explicit save rejection visible to its caller after a scope change", async () => {
  vi.useFakeTimers();
  const updates = setters();
  let rejectSave!: (error: Error) => void;
  h.add.mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectSave = reject; }));
  render("a", updates, cart(1));
  const save = expect(h.draft!("save")).rejects.toBe(closedShift);
  await vi.advanceTimersByTimeAsync(0);
  render("b", updates, cart(2));
  rejectSave(closedShift);
  await save;
  expect(toast.error).not.toHaveBeenCalled();
  expect(updates.resetCart).not.toHaveBeenCalled();
});
