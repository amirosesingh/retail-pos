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
import {
  addHeldOrder,
  clearHeldPending,
  removeHeldOrder,
  useHeldOrders,
  type HeldOrder,
} from "@/lib/held-orders";
import { claimApproval } from "@/lib/approval-centre";
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
  resetCart: () => void;
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
  }) => void;
  /** Clears approval UI/state before another parked ticket becomes active. */
  onApprovalCleared?: () => void;
};

export function useRegisterHeldOrders(deps: HeldOrdersDeps) {
  const held = useHeldOrders();
  // Route effects can run twice in React development mode, and a fast double
  // click can do the same in production. Claiming is a one-time server write,
  // so collapse concurrent attempts for the same parked ticket.
  const resuming = useRef(new Set<string>());

  /** Park the open ticket with everything on it, so reopening is lossless. */
  function holdOrder(silent = false, requestedId?: string) {
    const { lines, total, storeId, memberId, memberName } = deps;
    if (!lines.length) return null;
    const snapshot = lines;
    const id = requestedId ?? `H${Date.now()}`;
    const order: HeldOrder = {
      id,
      label: `${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${snapshot.length} item(s)`,
      total,
      lines: snapshot,
      heldAt: new Date().toISOString(),
      storeId,
      heldBy: deps.cashier,
      cartDiscount: deps.cartDiscount,
      ...(deps.billNo ? { billNo: deps.billNo } : {}),
      cartDiscountType: deps.cartDiscountType,
      exchangeRef: deps.exchangeRef,
      memberId,
      memberName,
      coupon: deps.coupon,
    };
    addHeldOrder(order);
    logTicketEvent(TICKET_ACTIONS.held, {
      holdRef: id,
      lines: snapshot.length,
      value: total,
      storeId,
      memberId,
      member: memberName,
      items: snapshot.map((l) => ({ name: l.name, qty: l.qty, price: l.price })),
    });
    deps.resetCart();
    if (!silent) toast.success("Order held — reopen it from Hold tickets");
    return order;
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
        if (order.status === "waiting") {
          toast.info("Still waiting for a decision on this ticket");
          return;
        }
        const claimed = await claimApproval(
          order.pendingRequestId,
          order.approvalSnapshotHash ?? undefined,
        ).catch(() => null);
        if (!claimed || !claimed.ok) {
          toast.error(
            (claimed && "error" in claimed ? claimed.error : "") ||
              "That approval can no longer be used",
          );
          return;
        }
        if (claimed.status !== "approved" || !claimed.grantToken) {
          clearHeldPending(order.id);
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
          };
        }
      }
      const parked = deps.lines.length ? holdOrder(true) : null;
      deps.onApprovalCleared?.();
      const approvedDiscount = restoredApproval
        ? applyApprovedDiscount(order, restoredApproval)
        : {
            lines: order.lines,
            cartDiscount: order.cartDiscount ?? 0,
            cartDiscountType: order.cartDiscountType ?? ("amount" as DiscountType),
          };
      deps.setLines(approvedDiscount.lines);
      deps.setCartDiscount(approvedDiscount.cartDiscount);
      deps.setCartDiscountType(approvedDiscount.cartDiscountType);
      deps.setExchangeRef(order.exchangeRef ?? null);
      deps.setMemberId(order.memberId ?? null);
      deps.setCoupon((order.coupon as CartCoupon | null) ?? null);
      deps.setBillNo(order.billNo ?? null);
      if (restoredApproval) deps.onApprovalClaimed?.(restoredApproval);
      removeHeldOrder(id);
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
    } finally {
      resuming.current.delete(id);
    }
  }

  return { held, holdOrder, resumeHeld };
}

type ClaimedGrant = Parameters<NonNullable<HeldOrdersDeps["onApprovalClaimed"]>>[0];

/** Apply the value the manager actually granted to the exact bill/line target. */
export function applyApprovedDiscount(order: HeldOrder, grant: ClaimedGrant) {
  const fallback = {
    lines: order.lines,
    cartDiscount: order.cartDiscount ?? 0,
    cartDiscountType: order.cartDiscountType ?? ("amount" as DiscountType),
  };
  if (grant.actionKey !== "discount_over_limit" || grant.approvedAmount === null) return fallback;

  const payload = grant.approvedPayload;
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
  return {
    ...fallback,
    lines: order.lines.map((line, index) =>
      index === targetIndex ? { ...line, discount: value, discountType: type } : line,
    ),
  };
}
