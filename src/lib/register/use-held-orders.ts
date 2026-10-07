/**
 * Parked tickets.
 *
 * Holding an order stores everything on it — lines, discounts, member, coupon
 * and the reserved bill number — so reopening is lossless. Resuming parks the
 * open ticket first, letting the cashier switch between drafts. Lifted out of
 * the register screen unchanged, including the audit trail.
 */
import { toast } from "sonner";
import { useRef } from "react";
import { notifyError } from "@/lib/notify";
import {
  addHeldOrder,
  clearHeldPending,
  removeHeldOrder,
  useHeldOrders,
  type HeldOrder,
} from "@/lib/held-orders";
import { claimApproval, loadApprovalCentre } from "@/lib/approval-centre";
import type { TicketSnapshot } from "@/lib/ticket-snapshot";
import type { AuthPayload } from "@/lib/authorization";
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
  // Route effects can run twice in React development mode, and a fast double
  // click can do the same in production. Claiming is a one-time server write,
  // so collapse concurrent attempts for the same parked ticket.
  const resuming = useRef(new Set<string>());
  const holding = useRef(false);

  /** Park the open ticket with everything on it, so reopening is lossless. */
  async function holdOrder(silent = false, requestedId?: string) {
    const { lines, total, storeId, memberId, memberName } = deps;
    if (!lines.length || holding.current) return null;
    holding.current = true;
    try {
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
    const id = requestedId ?? `H${crypto.randomUUID()}`;
    const order: HeldOrder = {
      id,
      label: `${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${snapshot.length} item(s)`,
      total: heldTotal,
      lines: snapshot,
      heldAt: new Date().toISOString(),
      storeId,
      heldBy: deps.cashier,
      cartDiscount: cleaned.cartDiscount,
      ...(deps.billNo ? { billNo: deps.billNo } : {}),
      cartDiscountType: deps.cartDiscountType,
      exchangeRef: deps.exchangeRef,
      memberId,
      memberName,
      coupon: deps.coupon,
    };
    await addHeldOrder(order);
    logTicketEvent(TICKET_ACTIONS.held, {
      holdRef: id,
      lines: snapshot.length,
      value: heldTotal,
      storeId,
      memberId,
      member: memberName,
      items: snapshot.map((l) => ({ name: l.name, qty: l.qty, price: l.price })),
    });
    deps.resetCart("held");
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
    if (resuming.current.has(id)) return;
    resuming.current.add(id);
    try {
      const order = held.find((h) => h.id === id);
      if (!order) return;
      let restoredApproval: Parameters<NonNullable<HeldOrdersDeps["onApprovalClaimed"]>>[0] | null =
        null;
      if (order.pendingRequestId) {
        const centre = await loadApprovalCentre(deps.storeId);
        const request = [...centre.waiting, ...centre.ready, ...centre.history].find(
          (candidate) => candidate.id === order.pendingRequestId,
        );
        if (order.status === "waiting" && (!request || request.status === "pending")) {
          toast.info("Still waiting for a decision on this ticket");
          return;
        }
        const storedSnapshotHash = order.approvalSnapshotHash ?? undefined;
        const claimed = await claimApproval(
          order.pendingRequestId,
          storedSnapshotHash ?? request?.snapshotHash ?? undefined,
        ).catch(() => null);
        if (!claimed || !claimed.ok) {
          toast.error(
            (claimed && "error" in claimed ? claimed.error : "") ||
              "That approval can no longer be used",
          );
          return;
        }
        if (claimed.status !== "approved" || !claimed.grantToken) {
          await clearHeldPending(order.id);
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
      const parked = deps.lines.length ? await holdOrder(true) : null;
      if (deps.lines.length && !parked) return;
      deps.onApprovalCleared?.();
      const approvedDiscount = restoredApproval
        ? applyApprovedDiscount(order, restoredApproval)
        : {
            lines: order.lines,
            cartDiscount: order.cartDiscount ?? 0,
            cartDiscountType: order.cartDiscountType ?? ("amount" as DiscountType),
          };
      await removeHeldOrder(id);
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

  return { held, holdOrder, resumeHeld };
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
