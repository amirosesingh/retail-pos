/**
 * Held orders shared across routes.
 *
 * The register used to keep parked tickets in component state, so a bill
 * cancelled from the receipt vault had nowhere to land. Keeping them in one
 * small platform store lets the receipts screen push a cancelled
 * bill straight back onto the register's hold list.
 */
import { useEffect, useState } from "react";

import type { CartLine } from "@/core/types/pos-types";
import { db } from "@/core/api/pos-db";
import { readBusinessValue, writeBusinessValue } from "./business-storage";

export type HeldOrder = {
  id: string;
  label: string;
  total: number;
  lines: CartLine[];
  heldAt: string;
  /** set when the entry came from a cancelled bill */
  cancelledFrom?: string;
  /** branch the ticket was parked at */
  storeId?: string;
  /** bill number reserved when the ticket was started */
  billNo?: string;
  /** who parked it */
  heldBy?: string;
  /** full ticket context so a reopened draft is identical to the parked one */
  cartDiscount?: number;
  cartDiscountType?: "amount" | "percent";
  exchangeRef?: string | null;
  memberId?: string | null;
  memberName?: string | null;
  coupon?: unknown;
  note?: string;
  /**
   * "held" is an ordinary parked ticket; "waiting" means it is parked because
   * it is waiting for a manager's decision, and "ready" means the decision has
   * arrived and the ticket can be resumed.
   */
  status?: "held" | "waiting" | "ready";
  /** the approval request this ticket is bound to, when it is waiting */
  pendingRequestId?: string | null;
  /** fingerprint of the exact ticket reviewed by the approver */
  approvalSnapshotHash?: string | null;
};

const KEY = "pos.held.orders";
const EVENT = "pos:held-orders-changed";

export function readHeldOrders(): HeldOrder[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = readBusinessValue(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as HeldOrder[]) : [];
  } catch {
    return [];
  }
}

function write(orders: HeldOrder[]) {
  if (typeof window === "undefined") return;
  try {
    writeBusinessValue(KEY, JSON.stringify(orders));
  } catch {
    /* storage full or blocked — the in-memory event still updates the UI */
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function setHeldOrders(update: (current: HeldOrder[]) => HeldOrder[]) {
  write(update(readHeldOrders()));
}

export function addHeldOrder(order: HeldOrder) {
  setHeldOrders((hs) => [...hs, order]);
  void persistHeldOrder(order);
}

export function removeHeldOrder(id: string) {
  setHeldOrders((hs) => hs.filter((h) => h.id !== id));
  db.removeHeldOrder(id);
}

/**
 * Store the parked ticket in the database (cloud, local SQL Server or the
 * on-disk outbox) and only resolve once it is safe somewhere, so the till can
 * wait before clearing the cart.
 */
export function persistHeldOrder(order: HeldOrder) {
  return db.commitHeldOrder({
    id: order.id,
    label: order.label,
    storeId: order.storeId ?? null,
    heldBy: order.heldBy ?? null,
    billNo: order.billNo ?? null,
    total: order.total,
    lines: order.lines,
    cartDiscount: order.cartDiscount ?? 0,
    cartDiscountType: order.cartDiscountType ?? "amount",
    exchangeRef: order.exchangeRef ?? null,
    memberId: order.memberId ?? null,
    memberName: order.memberName ?? null,
    coupon: order.coupon ?? null,
    note: order.note ?? "",
    cancelledFrom: order.cancelledFrom ?? null,
    heldAt: order.heldAt,
    status: order.status ?? "held",
    pendingRequestId: order.pendingRequestId ?? null,
  });
}

export function updateHeldOrder(id: string, patch: Partial<HeldOrder>) {
  let updated: HeldOrder | undefined;
  setHeldOrders((hs) =>
    hs.map((h) => {
      if (h.id !== id) return h;
      updated = { ...h, ...patch };
      return updated;
    }),
  );
  if (updated) void persistHeldOrder(updated);
}

/** Park a cancelled bill so the till can correct and re-ring it. */
export function holdCancelledBill(input: {
  receiptNo: string;
  total: number;
  lines: CartLine[];
}): HeldOrder {
  const order: HeldOrder = {
    id: `C${Date.now()}`,
    label: `Cancelled ${input.receiptNo} · ${input.lines.length} item(s)`,
    total: input.total,
    lines: input.lines.filter((l) => !l.credit),
    heldAt: new Date().toISOString(),
    cancelledFrom: input.receiptNo,
  };
  addHeldOrder(order);
  return order;
}

export function useHeldOrders(): HeldOrder[] {
  const [orders, setOrders] = useState<HeldOrder[]>(() => readHeldOrders());
  useEffect(() => {
    const sync = () => setOrders(readHeldOrders());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return orders;
}

/**
 * Park a ticket because it is waiting for a manager's decision.
 *
 * The cashier can then serve the next customer; the ticket stays exactly as
 * the approver saw it, bound to the request that will decide it.
 */
export function markHeldWaiting(id: string, requestId: string, snapshotHash?: string) {
  updateHeldOrder(id, {
    status: "waiting",
    pendingRequestId: requestId,
    approvalSnapshotHash: snapshotHash ?? null,
  });
}

/** The decision has arrived — the ticket can be picked up again. */
export function markHeldReady(id: string) {
  updateHeldOrder(id, { status: "ready" });
}

/** Back to an ordinary parked ticket, with no request attached. */
export function clearHeldPending(id: string) {
  updateHeldOrder(id, {
    status: "held",
    pendingRequestId: null,
    approvalSnapshotHash: null,
  });
}

/** The parked ticket bound to a given approval request, if it is still here. */
export const heldOrderForRequest = (requestId: string): HeldOrder | undefined =>
  readHeldOrders().find((h) => h.pendingRequestId === requestId);
