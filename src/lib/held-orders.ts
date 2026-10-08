import { subscribeDataChange } from "./sync-engine";
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
import { clearDeviceSecret, getDeviceSecret, setDeviceSecret } from "./device-secrets";

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
const CORRECTION_RETRY_KEY = "pending-correction-holds";
const isElectronRenderer = () =>
  typeof window !== "undefined" && !!(window as unknown as { pos?: unknown }).pos;
let electronOrders: HeldOrder[] = [];
let electronReadSequence = 0;
let correctionRetryWrite = Promise.resolve();

function serializeCorrectionRetryWrite(work: () => Promise<void>): Promise<void> {
  const next = correctionRetryWrite.then(work, work);
  correctionRetryWrite = next.catch(() => undefined);
  return next;
}

const parseJson = <T>(value: unknown, fallback: T): T => {
  if (value == null) return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

export function rowToHeldOrder(row: Record<string, unknown>): HeldOrder {
  return {
    id: String(row.id ?? ""),
    label: String(row.label ?? "Held ticket"),
    total: Number(row.total ?? 0),
    lines: parseJson<CartLine[]>(row.lines, []),
    heldAt: String(row.held_at ?? new Date().toISOString()),
    storeId: row.store_id == null ? undefined : String(row.store_id),
    heldBy: row.held_by == null ? undefined : String(row.held_by),
    billNo: row.bill_no == null ? undefined : String(row.bill_no),
    cartDiscount: Number(row.cart_discount ?? 0),
    cartDiscountType: row.cart_discount_type === "percent" ? "percent" : "amount",
    exchangeRef: row.exchange_ref == null ? null : String(row.exchange_ref),
    memberId: row.member_id == null ? null : String(row.member_id),
    memberName: row.member_name == null ? null : String(row.member_name),
    coupon: parseJson(row.coupon, null),
    note: String(row.note ?? ""),
    cancelledFrom: row.cancelled_from == null ? undefined : String(row.cancelled_from),
    status: row.status === "waiting" || row.status === "ready" ? row.status : "held",
    pendingRequestId: row.pending_request_id == null ? null : String(row.pending_request_id),
    approvalSnapshotHash:
      row.approval_snapshot_hash == null ? null : String(row.approval_snapshot_hash),
  };
}

export function readHeldOrders(): HeldOrder[] {
  if (typeof window === "undefined") return [];
  if (isElectronRenderer()) return electronOrders;
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
  if (isElectronRenderer()) electronOrders = orders;
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

export async function addHeldOrder(order: HeldOrder) {
  await persistHeldOrder(order);
  setHeldOrders((hs) => [...hs.filter((held) => held.id !== order.id), order]);
}

export async function removeHeldOrder(id: string) {
  await db.removeHeldOrder(id);
  setHeldOrders((hs) => hs.filter((h) => h.id !== id));
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
    approvalSnapshotHash: order.approvalSnapshotHash ?? null,
  });
}

export async function updateHeldOrder(id: string, patch: Partial<HeldOrder>) {
  let current = readHeldOrders().find((held) => held.id === id);
  if (!current) {
    // Electron starts with an empty renderer cache. Approval decisions can
    // arrive before the holds screen has hydrated it, so recover the durable
    // row instead of dropping the state transition.
    const row = (await db.listHeldOrders()).find((held) => String(held.id ?? "") === id);
    if (row) current = rowToHeldOrder(row as Record<string, unknown>);
  }
  if (!current) return;
  const updated = { ...current, ...patch };
  await persistHeldOrder(updated);
  setHeldOrders((orders) =>
    orders.some((held) => held.id === id)
      ? orders.map((held) => (held.id === id ? updated : held))
      : [...orders, updated],
  );
}

/** Park a cancelled bill so the till can correct and re-ring it. */
export function holdCancelledBill(input: {
  id?: string;
  receiptNo: string;
  total: number;
  lines: CartLine[];
  storeId: string;
}): Promise<HeldOrder> {
  const order: HeldOrder = {
    id: input.id ?? `C${crypto.randomUUID()}`,
    label: `Cancelled ${input.receiptNo} · ${input.lines.length} item(s)`,
    total: input.total,
    lines: input.lines.filter((l) => !l.credit),
    heldAt: new Date().toISOString(),
    cancelledFrom: input.receiptNo,
    storeId: input.storeId,
  };
  return addHeldOrder(order).then(() => order);
}

export type PendingCorrectionHold = Parameters<typeof holdCancelledBill>[0] & { saleId: string };

export async function rememberPendingCorrectionHold(input: PendingCorrectionHold) {
  return serializeCorrectionRetryWrite(async () => {
    const pending =
      (await getDeviceSecret<Record<string, PendingCorrectionHold>>(CORRECTION_RETRY_KEY)) ?? {};
    pending[input.saleId] = input;
    await setDeviceSecret(CORRECTION_RETRY_KEY, pending);
  });
}

export async function loadPendingCorrectionHold(
  saleId: string,
): Promise<PendingCorrectionHold | null> {
  const pending =
    await getDeviceSecret<Record<string, PendingCorrectionHold>>(CORRECTION_RETRY_KEY);
  return pending?.[saleId] ?? null;
}

export async function clearPendingCorrectionHold(saleId: string) {
  return serializeCorrectionRetryWrite(async () => {
    const pending =
      await getDeviceSecret<Record<string, PendingCorrectionHold>>(CORRECTION_RETRY_KEY);
    if (!pending?.[saleId]) return;
    delete pending[saleId];
    if (Object.keys(pending).length) await setDeviceSecret(CORRECTION_RETRY_KEY, pending);
    else clearDeviceSecret(CORRECTION_RETRY_KEY);
  });
}

export function useHeldOrders(storeId?: string): HeldOrder[] {
  const [orders, setOrders] = useState<HeldOrder[]>(() =>
    readHeldOrders().filter((order) => !storeId || order.storeId === storeId),
  );
  useEffect(() => {
    let active = true;
    const sync = async () => {
      let loaded: HeldOrder[] | null = null;
      if (isElectronRenderer()) {
        const requestSequence = ++electronReadSequence;
        try {
          // Keep the process-wide cache complete. Branch-filtered reads from
          // two mounted screens must never replace each other's tickets.
          const rows = await db.listHeldOrders();
          if (!active) return;
          loaded = rows.map((row) => rowToHeldOrder(row as Record<string, unknown>));
          if (requestSequence === electronReadSequence) electronOrders = loaded;
        } catch {
          // Keep the last confirmed SQL result visible while connection recovery runs.
        }
      }
      if (active) {
        // Even if another hook issued a newer shared-cache request, this hook
        // can still render the durable rows it just loaded.
        const current = loaded ?? readHeldOrders();
        setOrders(storeId ? current.filter((order) => order.storeId === storeId) : current);
      }
    };
    void sync();
    const refresh = () => void sync();
    const offData = subscribeDataChange(change => { if (change.table === "held_orders") refresh(); });
    window.addEventListener(EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      active = false;
      offData();
      window.removeEventListener(EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [storeId]);
  return storeId ? orders.filter((order) => order.storeId === storeId) : orders;
}

/**
 * Park a ticket because it is waiting for a manager's decision.
 *
 * The cashier can then serve the next customer; the ticket stays exactly as
 * the approver saw it, bound to the request that will decide it.
 */
export function markHeldWaiting(id: string, requestId: string, snapshotHash?: string) {
  return updateHeldOrder(id, {
    status: "waiting",
    pendingRequestId: requestId,
    approvalSnapshotHash: snapshotHash ?? null,
  });
}

/** The decision has arrived — the ticket can be picked up again. */
export function markHeldReady(id: string) {
  return updateHeldOrder(id, { status: "ready" });
}

/** Back to an ordinary parked ticket, with no request attached. */
export function clearHeldPending(id: string) {
  return updateHeldOrder(id, {
    status: "held",
    pendingRequestId: null,
    approvalSnapshotHash: null,
  });
}

/** The parked ticket bound to a given approval request, if it is still here. */
export const heldOrderForRequest = (requestId: string): HeldOrder | undefined =>
  readHeldOrders().find((h) => h.pendingRequestId === requestId);
