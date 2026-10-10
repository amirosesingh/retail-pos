import { db } from "@/core/api/pos-db";
import { draftTicketId, registerSessionDraft } from "@/lib/session-draft";
import { documentDevice } from "@/lib/document-origin";
/**
 * Parked tickets.
 *
 * Holding an order stores everything on it — lines, discounts, member, coupon
 * and the reserved bill number — so reopening is lossless. Resuming parks the
 * open ticket first, letting the cashier switch between drafts. Lifted out of
 * the register screen unchanged, including the audit trail.
 */
import { toast } from "sonner";
import { useCallback, useEffect, useRef } from "react";
import { notifyError } from "@/lib/notify";
import {
  addHeldOrder,
  loadHeldOrder,
  updateHeldOrder,
  useHeldOrders,
  type HeldOrder,
} from "@/lib/held-orders";
import { claimApproval, loadApprovalCentre } from "@/lib/approval-centre";
import type { TicketSnapshot } from "@/lib/ticket-snapshot";
import { ticketDiscounts, type AuthPayload } from "@/lib/authorization";
import { TICKET_ACTIONS, logTicketEvent } from "@/lib/ticket-audit";
import type { CartLine, DiscountType } from "@/core/types/pos-types";
import type { CartCoupon } from "@/lib/register/use-cart";

type HeldOrdersDeps = {
  /** The open ticket. */
  lines: CartLine[];
  total: number;
  cartDiscount: number;
  cartDiscountType: DiscountType;
  exchangeRef: string | null;
  memberId: string | null;
  memberName: string | null;
  coupon: CartCoupon | null;
  billNo: string | null;
  storeId: string;
  shiftId: string | null;
  ensureBillNumber: () => Promise<string>;
  cashier: string;
  /** Ticket setters, owned by the register screen. */
  setLines: (ls: CartLine[]) => void;
  setCartDiscount: (v: number) => void;
  setCartDiscountType: (t: DiscountType) => void;
  setExchangeRef: (ref: string | null) => void;
  setMemberId: (id: string | null) => void;
  setCoupon: (c: CartCoupon | null) => void;
  setBillNo: (no: string | null) => void;
  resetCart: (reason?: "completed" | "voided" | "cleared" | "held") => void;
  /**
   * A picture of the open ticket, used to prove to the server that a ticket
   * resumed after an approval is still the one the approver reviewed.
   */
  snapshot?: () => TicketSnapshot | null;
  /** Called with the single-use grant when a parked approval is claimed. */
  onApprovalClaimed?: (grant: {
    requestId: string;
    actionKey: string;
    approvedPayload: AuthPayload;
    grantToken: string;
    approvedAmount: number | null;
    requestedAmount: number | null;
    requesterDirectLimit: number | null;
    valueUnit: "percent" | "currency" | "quantity" | "number";
    approvedBy: string | null;
    approvedByName: string | null;
  }) => void;
  /** Clears approval UI/state before another parked ticket becomes active. */
  onApprovalCleared?: () => void;
  activeApproval?: Pick<ClaimedGrant, "actionKey" | "approvedPayload"> | null;
  /** Reprices a cleaned ticket with the register's tax/promotion rules. */
  calculateTotal?: (
    lines: CartLine[],
    cartDiscount: number,
    cartDiscountType: DiscountType,
  ) => number;
};

export function useRegisterHeldOrders(deps: HeldOrdersDeps) {
  const held = useHeldOrders(deps.storeId);
  const latestDeps = useRef(deps);
  latestDeps.current = deps;
  // Route effects can run twice in React development mode, and a fast double
  // click can do the same in production. Claiming is a one-time server write,
  // so collapse concurrent attempts for the same parked ticket.
  const resuming = useRef(new Set<string>());
  const holding = useRef(false);
  const activeId = useRef<string | null>(null);
  const released = useRef(new Set<string>());
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const savedDraft = useRef<string | null>(null);
  const enqueue = useCallback(<T,>(work: () => Promise<T>): Promise<T> => {
    const next = writes.current.then(work, work);
    writes.current = next.catch(() => undefined);
    return next;
  }, []);
  const saveDraft = useCallback(async () => {
    const current = latestDeps.current;
    if (!current.lines.length || !current.shiftId || (current.billNo && released.current.has(current.billNo))) return;
    if (!current.billNo) {
      const bill = await current.ensureBillNumber();
      current.billNo = bill;
      current.setBillNo(bill);
    }
    const id = activeId.current ?? draftTicketId(current.storeId, current.billNo);
    activeId.current = id;
    const cleaned = current.activeApproval ? removeApprovedDiscount(current, current.activeApproval) : current;
    const order: HeldOrder = {
      id, label: `Draft ${current.billNo}`, billNo: current.billNo,
      storeId: current.storeId, shiftId: current.shiftId, heldBy: current.cashier,
      lines: cleaned.lines, total: current.activeApproval ? current.calculateTotal?.(cleaned.lines, cleaned.cartDiscount, cleaned.cartDiscountType) ?? current.total : current.total,
      cartDiscount: cleaned.cartDiscount, cartDiscountType: cleaned.cartDiscountType,
      exchangeRef: current.exchangeRef, memberId: current.memberId, memberName: current.memberName,
      coupon: current.coupon, heldAt: new Date().toISOString(), status: "draft",
      note: `draft:${documentDevice()}`,
    };
    const signature = JSON.stringify({...order,heldAt:null});
    await enqueue(async () => {
      if (!released.current.has(order.billNo!) && savedDraft.current !== signature) {
        await addHeldOrder(order);
        savedDraft.current = signature;
      }
    });
  }, [enqueue]);

  /** Park the open ticket with everything on it, so reopening is lossless. */
  async function holdOrder(
    silent = false,
    requestedId?: string,
    pending?: { requestId: string; snapshotHash?: string },
    sessionDraft = false,
  ) {
    const { lines, total, storeId, memberId, memberName } = deps;
    if (!lines.length || holding.current) return null;
    holding.current = true;
    try {
      await writes.current;
      const bill = deps.billNo || await deps.ensureBillNumber();
      const originalSignature = ticketSignature(deps);
      const cleaned = deps.activeApproval
        ? removeApprovedDiscount(
            {
              lines,
              cartDiscount: deps.cartDiscount,
              cartDiscountType: deps.cartDiscountType,
            },
            deps.activeApproval,
          )
        : { lines, cartDiscount: deps.cartDiscount, cartDiscountType: deps.cartDiscountType };
      const snapshot = cleaned.lines;
      const heldTotal = deps.activeApproval
        ? (deps.calculateTotal?.(cleaned.lines, cleaned.cartDiscount, cleaned.cartDiscountType) ??
          total)
        : total;
      const id = activeId.current ?? requestedId ?? draftTicketId(storeId, bill);
      const order: HeldOrder = {
        id,
        label: `${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${snapshot.length} item(s)`,
        total: heldTotal,
        lines: snapshot,
        heldAt: new Date().toISOString(),
        storeId,
        shiftId: deps.shiftId,
        heldBy: deps.cashier,
        ...(sessionDraft ? { note: `session-draft:${documentDevice()}` } : {}),
        cartDiscount: cleaned.cartDiscount,
        billNo: bill,
        status: "held",
        cartDiscountType: deps.cartDiscountType,
        exchangeRef: deps.exchangeRef,
        memberId,
        memberName,
        coupon: deps.coupon,
        ...(pending
          ? {
              status: "waiting" as const,
              pendingRequestId: pending.requestId,
              approvalSnapshotHash: pending.snapshotHash ?? null,
            }
          : {}),
      };
      await enqueue(() => addHeldOrder(order));
      logTicketEvent(TICKET_ACTIONS.held, {
        holdRef: id,
        lines: snapshot.length,
        value: heldTotal,
        storeId,
        memberId,
        member: memberName,
        items: snapshot.map((l) => ({ name: l.name, qty: l.qty, price: l.price })),
      });
      if (ticketSignature({ ...latestDeps.current, billNo: deps.billNo }) !== originalSignature) {
        toast.warning("Ticket held, but the current cart changed while it was saving", {
          description: "The newer cart was left open. The saved version is available in Holds.",
        });
        return sessionDraft ? null : order;
      }
      released.current.add(bill);
      activeId.current = null;
      latestDeps.current.resetCart("held");
      if (!silent) toast.success("Order held — reopen it from Hold tickets");
      return order;
    } catch (error) {
      notifyError(error, "Holding the ticket");
      return null;
    } finally {
      holding.current = false;
    }
  }

  /** Reopen a parked ticket. An open ticket is parked first, so the cashier
   *  can switch between drafts without losing either one.
   *
   *  A ticket parked for a manager's decision only comes back with the
   *  approval attached: the server is asked to hand over the single-use
   *  permission, and it refuses if the ticket changed or somebody already
   *  used it. */
  async function resumeHeld(id: string) {
    if (resuming.current.has(id) || (activeId.current === id && deps.lines.length)) return;
    resuming.current.add(id);
    try {
      const order = held.find((h) => h.id === id) ?? await loadHeldOrder(id);
      if (!order) { toast.error("This held ticket is no longer available"); return; }
      if (order.storeId !== deps.storeId) {
        toast.error("That held ticket belongs to another branch");
        return;
      }
      let restoredApproval: Parameters<NonNullable<HeldOrdersDeps["onApprovalClaimed"]>>[0] | null =
        null;
      let request: Awaited<ReturnType<typeof loadApprovalCentre>>["ready"][number] | undefined;
      if (order.pendingRequestId) {
        const centre = await loadApprovalCentre(deps.storeId);
        request = [...centre.waiting, ...centre.ready, ...centre.history].find(
          (candidate) => candidate.id === order.pendingRequestId,
        );
        if (order.status === "waiting" && (!request || request.status === "pending")) {
          toast.info("Still waiting for a decision on this ticket");
          return;
        }
      }
      const parked = deps.lines.length ? await holdOrder(true) : null;
      if (deps.lines.length && !parked) return;
      if (order.pendingRequestId) {
        const storedSnapshotHash = order.approvalSnapshotHash ?? undefined;
        const claimed = await claimApproval(
          order.pendingRequestId,
          storedSnapshotHash ?? request?.snapshotHash ?? undefined,
        ).catch(() => null);
        if (!claimed || !claimed.ok) {
          if (parked) {
            try {
              // holdOrder cleared the open cart only after its durable insert.
              // If claiming the target approval fails, remove that temporary
              // hold first and put the cashier's original ticket back exactly
              // as it was instead of leaving the register unexpectedly blank.
              await db.setHeldOrderStatus(parked.id, "draft");
              activeId.current = parked.id;
              if (parked.billNo) released.current.delete(parked.billNo);
              deps.onApprovalCleared?.();
              deps.setLines(parked.lines);
              deps.setCartDiscount(parked.cartDiscount ?? 0);
              deps.setCartDiscountType(parked.cartDiscountType ?? "amount");
              deps.setExchangeRef(parked.exchangeRef ?? null);
              deps.setMemberId(parked.memberId ?? null);
              deps.setCoupon((parked.coupon as CartCoupon | null) ?? null);
              deps.setBillNo(parked.billNo ?? null);
            } catch {
              toast.warning("Your open ticket is safely available in Holds");
            }
          }
          toast.error(
            (claimed && "error" in claimed ? claimed.error : "") ||
              "That approval can no longer be used",
          );
          return;
        }
        if (claimed.status !== "approved" || !claimed.grantToken) {
          toast.warning(
            `The request was ${claimed.status}; the restricted change was not applied.`,
          );
        } else {
          restoredApproval = {
            requestId: order.pendingRequestId,
            actionKey: claimed.actionKey,
            approvedPayload: claimed.approvedPayload,
            grantToken: claimed.grantToken,
            approvedAmount: claimed.approvedAmount ?? null,
            requestedAmount: claimed.requestedAmount ?? null,
            requesterDirectLimit: claimed.requesterDirectLimit ?? null,
            valueUnit: claimed.valueUnit,
            approvedBy: claimed.approvedBy ?? null,
            approvedByName: claimed.approvedByName ?? null,
          };
        }
      }
      try {
        await db.setHeldOrderStatus(id, "draft");
        activeId.current = id;
        if (order.billNo) released.current.delete(order.billNo);
      } catch (error) {
        if (restoredApproval) {
          await updateHeldOrder(id, {
            status: "held",
            pendingRequestId: null,
            approvalSnapshotHash: null,
          }).catch(() => undefined);
          toast.warning("The ticket stayed in Holds and needs approval again", {
            description:
              "Its previous approval was consumed, but the database could not release the draft safely.",
          });
          return;
        }
        throw error;
      }
      deps.onApprovalCleared?.();
      let approvedDiscount = restoredApproval
        ? applyApprovedDiscount(order, restoredApproval)
        : {
            lines: order.lines,
            cartDiscount: order.cartDiscount ?? 0,
            cartDiscountType: order.cartDiscountType ?? ("amount" as DiscountType),
          };
      if (!restoredApproval && request?.actionKey === "discount_over_limit" && request.payload["discount_scope"] === "ticket") {
        approvedDiscount = removeApprovedDiscount(approvedDiscount, {actionKey:request.actionKey,
          approvedPayload:{...request.payload,requested_discounts:JSON.stringify(ticketDiscounts(request.payload).filter(entry => entry.requiresApproval))}});
      }
      deps.setLines(approvedDiscount.lines);
      deps.setCartDiscount(approvedDiscount.cartDiscount);
      deps.setCartDiscountType(approvedDiscount.cartDiscountType);
      deps.setExchangeRef(order.exchangeRef ?? null);
      deps.setMemberId(order.memberId ?? null);
      deps.setCoupon((order.coupon as CartCoupon | null) ?? null);
      deps.setBillNo(order.billNo ?? null);
      if (restoredApproval) deps.onApprovalClaimed?.(restoredApproval);
      logTicketEvent(parked ? TICKET_ACTIONS.switched : TICKET_ACTIONS.resumed, {
        holdRef: order.id,
        parkedRef: parked?.id ?? null,
        lines: order.lines.length,
        value: order.total,
        heldAt: order.heldAt,
        heldBy: order.heldBy ?? null,
        heldForSeconds: Math.round((Date.now() - new Date(order.heldAt).getTime()) / 1000),
        storeId: deps.storeId,
      });
      toast.success(
        parked ? "Switched ticket — the previous one is on hold" : "Held order resumed",
      );
    } catch (error) {
      notifyError(error, "Reopening the held ticket");
    } finally {
      resuming.current.delete(id);
    }
  }

  useEffect(() => () => {
    void saveDraft().catch(error => notifyError(error, "Saving draft bill"));
  }, [saveDraft]);

  useEffect(() => {
    if (!deps.lines.length || !deps.billNo) return;
    const timer = setTimeout(() => { void saveDraft().catch(error => notifyError(error, "Saving draft bill")); }, 1000);
    return () => clearTimeout(timer);
  }, [deps.lines, deps.billNo, deps.total, deps.cartDiscount, deps.cartDiscountType, deps.memberId, deps.coupon, deps.exchangeRef, saveDraft]);

  useEffect(() => registerSessionDraft(async action => {
    const current = latestDeps.current;
    if (action === "release") {
      if (current.billNo) released.current.add(current.billNo);
      activeId.current = null;
      return;
    }
    if (!current.lines.length) return;
    if (action === "cancel") {
      if (current.billNo) released.current.add(current.billNo);
      const id = activeId.current ?? (current.billNo ? draftTicketId(current.storeId, current.billNo) : null);
      try { if (id) await enqueue(() => db.removeHeldOrder(id)); }
      catch (error) { if (current.billNo) released.current.delete(current.billNo); throw error; }
      activeId.current = null;
    } else if (action === "hold") {
      const saved = await holdOrder(true, undefined, undefined, true);
      if (!saved) throw new Error("The current ticket was not safely held.");
    } else {
      await saveDraft();
      await writes.current;
      return latestDeps.current.billNo ?? undefined;
    }
  }));
  return { held, holdOrder, resumeHeld, getDraftId: () => activeId.current };
}

function ticketSignature(deps: Pick<
  HeldOrdersDeps,
  | "lines"
  | "cartDiscount"
  | "cartDiscountType"
  | "exchangeRef"
  | "memberId"
  | "coupon"
  | "billNo"
>) {
  return JSON.stringify([
    deps.lines,
    deps.cartDiscount,
    deps.cartDiscountType,
    deps.exchangeRef,
    deps.memberId,
    deps.coupon,
    deps.billNo,
  ]);
}

export type ClaimedGrant = Omit<
  Parameters<NonNullable<HeldOrdersDeps["onApprovalClaimed"]>>[0],
  "approvedBy" | "approvedByName"
> & {
  approvedBy?: string | null;
  approvedByName?: string | null;
};

export type ApprovalDiscountState = {
  lines: CartLine[];
  cartDiscount: number;
  cartDiscountType: DiscountType;
};

/** Remove only the economic effect that came from this approval. */
export function removeApprovedDiscount(
  state: ApprovalDiscountState,
  grant: Pick<ClaimedGrant, "actionKey" | "approvedPayload">,
): ApprovalDiscountState {
  if (grant.actionKey !== "discount_over_limit") return state;
  const payload = grant.approvedPayload;
  if (payload["discount_scope"] === "ticket") {
    const discounts = ticketDiscounts(payload);
    return { ...state,
      cartDiscount: discounts.some(entry => entry.index === -1) ? 0 : state.cartDiscount,
      lines: state.lines.map((line,index) => discounts.some(entry => entry.index === index && entry.productId === line.productId) ? {...line,discount:0} : line),
    };
  }
  if (payload["discount_scope"] === "bill") {
    return { ...state, cartDiscount: 0 };
  }

  const productId = String(payload["target_product_id"] ?? "");
  const requestedIndex = Number(payload["target_index"]);
  const indexed = Number.isInteger(requestedIndex) ? state.lines[requestedIndex] : undefined;
  const rawLineKey = String(payload["target_line_key"] ?? "");
  const keyParts = rawLineKey.split("|");
  const hasLineKey = rawLineKey.length > 0 && keyParts.length >= 5;
  const expectedProductId = hasLineKey ? (keyParts.at(-3) ?? productId) : productId;
  const expectedQty = hasLineKey ? Number(keyParts.at(-2)) : Number.NaN;
  const expectedPrice = hasLineKey ? Number(keyParts.at(-1)) : Number.NaN;
  const matches = state.lines.flatMap((line, index) =>
    (!expectedProductId || line.productId === expectedProductId) &&
    (!Number.isFinite(expectedQty) || line.qty === expectedQty) &&
    (!Number.isFinite(expectedPrice) || line.price === expectedPrice)
      ? [index]
      : [],
  );
  const indexedMatches =
    indexed &&
    (!expectedProductId || indexed.productId === expectedProductId) &&
    (!Number.isFinite(expectedQty) || indexed.qty === expectedQty) &&
    (!Number.isFinite(expectedPrice) || indexed.price === expectedPrice);
  const targetIndex = indexedMatches ? requestedIndex : matches.length === 1 ? matches[0] : -1;
  if (targetIndex < 0) return state;
  return {
    ...state,
    lines: state.lines.map((line, index) =>
      index === targetIndex ? { ...line, discount: 0 } : line,
    ),
  };
}

/** Apply the value the manager actually granted to the exact bill/line target. */
export function applyApprovedDiscount(order: HeldOrder, grant: ClaimedGrant) {
  const fallback = {
    lines: order.lines,
    cartDiscount: order.cartDiscount ?? 0,
    cartDiscountType: order.cartDiscountType ?? ("amount" as DiscountType),
  };
  if (grant.actionKey !== "discount_over_limit" || grant.approvedAmount === null) return fallback;

  const payload = grant.approvedPayload;
  const approvedBillNo = String(payload["bill_no"] ?? "");
  if (!order.billNo || approvedBillNo !== order.billNo) return fallback;
  if (payload["discount_scope"] === "ticket") {
    const requested = ticketDiscounts(payload);
    const approved = ticketDiscounts(payload,"approved_discounts");
    const discounts = approved.length ? approved : requested;
    if (discounts.some(entry => entry.index >= 0 && (!order.lines[entry.index] ||
      order.lines[entry.index].productId !== entry.productId || order.lines[entry.index].qty !== entry.qty || order.lines[entry.index].price !== entry.price))) return fallback;
    const bill = discounts.find(entry => entry.index === -1);
    return { ...fallback,
      cartDiscount: bill?.value ?? fallback.cartDiscount,
      cartDiscountType: bill?.type ?? fallback.cartDiscountType,
      lines: order.lines.map((line,index) => {
        const discount = discounts.find(entry => entry.index === index);
        return discount ? {...line,discount:discount.value,discountType:discount.type} : line;
      }),
    };
  }
  const type: DiscountType =
    payload["discount_type"] === "percent" || grant.valueUnit === "percent" ? "percent" : "amount";
  const value = Math.max(0, Number(grant.approvedAmount) || 0);
  if (payload["discount_scope"] === "bill") {
    return { ...fallback, cartDiscount: value, cartDiscountType: type };
  }

  const productId = String(payload["target_product_id"] ?? "");
  const requestedIndex = Number(payload["target_index"]);
  const indexedLine = Number.isInteger(requestedIndex) ? order.lines[requestedIndex] : undefined;
  const matchingIndexes = productId
    ? order.lines.flatMap((line, index) => (line.productId === productId ? [index] : []))
    : [];
  const targetIndex =
    indexedLine && (!productId || indexedLine.productId === productId)
      ? requestedIndex
      : matchingIndexes.length === 1
        ? matchingIndexes[0]
        : -1;
  if (targetIndex < 0 || targetIndex >= order.lines.length) return fallback;
  const targetLine = order.lines[targetIndex]!;
  const expectedLineKey = [
    order.billNo,
    targetIndex,
    targetLine.productId,
    targetLine.qty,
    targetLine.price,
  ].join("|");
  if (payload["target_line_key"] !== expectedLineKey) return fallback;
  return {
    ...fallback,
    lines: order.lines.map((line, index) =>
      index === targetIndex ? { ...line, discount: value, discountType: type } : line,
    ),
  };
}
