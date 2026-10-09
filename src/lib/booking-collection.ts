/**
 * Authoritative booking money.
 *
 * The till may *show* a balance, but it never decides one. Every figure here
 * comes back from the central database, which adds up the settled payments
 * itself and refuses to hand a booking over while anything is still owed.
 */
import { supabaseExternal as supabase } from "@/integrations/supabase/external-client";
import { MONEY_TOLERANCE, type PaymentMethod } from "@/core/types/pos-types";
import { commitOps } from "@/core/api/pos-db";
import { routedQuery } from "@/core/api/db-query";
import { localDb } from "@/core/local-db/local-db";
import { CUSTOMER_REFUNDS_ALLOWED, NO_REFUND_MESSAGE } from "./returns-policy";

export type BookingBalanceState = {
  total: number;
  settledPaid: number;
  outstanding: number;
  fullyPaid: boolean;
  status: string;
  jobStatus: string | null;
  /** the payment was already recorded (retry / another terminal) */
  duplicate?: boolean;
  /** cash handed back when the customer over-tendered */
  changeDue?: number;
};

export type BookingMoneyResult =
  | { ok: true; state: BookingBalanceState }
  | { ok: false; error: string };

const message = (e: unknown, fallback: string) =>
  (typeof e === "object" && e && "message" in e && String((e as { message: string }).message)) ||
  fallback;

const toState = (row: Record<string, unknown>): BookingBalanceState => ({
  total: Number(row["total"] ?? 0),
  settledPaid: Number(row["settled_paid"] ?? 0),
  outstanding: Number(row["outstanding"] ?? 0),
  fullyPaid: !!row["fully_paid"],
  status: String(row["status"] ?? ""),
  jobStatus: (row["job_status"] as string) ?? null,
  duplicate: !!row["duplicate"],
  changeDue: Number(row["change_due"] ?? 0),
});

const roundMoney = (value: number) => Number(value.toFixed(2));

async function localBalance(bookingId: string): Promise<{
  booking: Record<string, unknown>;
  state: BookingBalanceState;
}> {
  const bookings = await routedQuery("bookings", { match: { id: bookingId }, limit: 1 });
  const booking = bookings[0];
  if (!booking) throw new Error("BOOKING_NOT_FOUND");
  const payments = await routedQuery("booking_payments", {
    match: { booking_id: bookingId, status: "settled" },
    orderBy: { column: "created_at", ascending: true },
    limit: 2000,
  });
  const settledPaid = roundMoney(
    payments.reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0),
  );
  const total = roundMoney(Number(booking.total ?? 0));
  const rawOutstanding = roundMoney(total - settledPaid);
  return {
    booking,
    state: {
      total,
      settledPaid,
      outstanding: roundMoney(Math.max(0, rawOutstanding)),
      fullyPaid: rawOutstanding <= MONEY_TOLERANCE,
      status: String(booking.status ?? ""),
      jobStatus: (booking.job_status as string | null | undefined) ?? null,
    },
  };
}

async function duplicatePayment(bookingId: string, clientPaymentId: string) {
  const rows = await routedQuery("booking_payments", {
    match: { booking_id: bookingId, client_payment_id: clientPaymentId },
    limit: 1,
  });
  return rows.length > 0;
}

/** What the server says is still owed on this booking, right now. */
export async function readBookingBalance(bookingId: string): Promise<BookingMoneyResult> {
  try {
    if (localDb()?.query) return { ok: true, state: (await localBalance(bookingId)).state };
    const res = await supabase.rpc("booking_balance_state" as never, {
      _booking_id: bookingId,
    } as never);
    if (res.error) return { ok: false, error: message(res.error, "Balance check failed.") };
    const row = (Array.isArray(res.data) ? res.data[0] : res.data) as
      | Record<string, unknown>
      | undefined;
    if (!row) return { ok: false, error: "This booking is not in the central database yet." };
    return { ok: true, state: toState(row) };
  } catch (e) {
    return { ok: false, error: readable(message(e, "The booking database could not be reached.")) };
  }
}

/**
 * Record money against a booking and, when `complete` is set and nothing is
 * left owing, let the server move it to collected in the same transaction.
 * `clientPaymentId` makes a retry safe: the same id is never taken twice.
 */
export async function collectBookingPayment(input: {
  bookingId: string;
  amount: number;
  method: PaymentMethod;
  cashier?: string | null;
  reference?: string | null;
  clientPaymentId: string;
  complete: boolean;
}): Promise<BookingMoneyResult> {
  try {
    if (localDb()?.writeBatch) {
      const before = await localBalance(input.bookingId);
      if (before.state.status === "cancelled") throw new Error("BOOKING_CANCELLED");
      const duplicate = await duplicatePayment(input.bookingId, input.clientPaymentId);
      let changeDue = 0;
      let taken = roundMoney(Math.max(0, input.amount));
      if (!duplicate && taken > before.state.outstanding + MONEY_TOLERANCE) {
        if (String(input.method).toLowerCase() !== "cash") throw new Error("BOOKING_OVERPAYMENT");
        changeDue = roundMoney(taken - before.state.outstanding);
        taken = before.state.outstanding;
      }
      const now = new Date().toISOString();
      const settledPaid = roundMoney(before.state.settledPaid + (!duplicate ? taken : 0));
      const outstanding = roundMoney(Math.max(0, before.state.total - settledPaid));
      const fullyPaid = outstanding <= MONEY_TOLERANCE;
      const nextStatus = input.complete && fullyPaid ? "collected" : before.state.status;
      const nextJob = input.complete && fullyPaid && before.state.jobStatus ? "collected" : before.state.jobStatus;
      const ops = [] as Parameters<typeof commitOps>[1];
      if (!duplicate && taken > 0) {
        ops.push({
          kind: "insert",
          table: "booking_payments",
          rows: [{
            id: crypto.randomUUID(), booking_id: input.bookingId, amount: taken,
            method: input.method, cashier: input.cashier ?? before.booking.cashier ?? null,
            paid_at: now, created_at: now, status: "settled", reference: input.reference ?? null,
            client_payment_id: input.clientPaymentId, kind: "payment", change_given: changeDue,
          }],
        });
      }
      ops.push({
        kind: "update", table: "bookings", match: { id: input.bookingId },
        values: {
          store_id: before.booking.store_id, paid: settledPaid, status: nextStatus,
          job_status: nextJob,
          ...(input.complete && fullyPaid ? {
            closed_at: now,
            ...(before.state.jobStatus ? { job_status_at: now, job_status_by: input.cashier ?? before.booking.job_status_by ?? null } : {}),
          } : {}),
          updated_at: now,
        },
      });
      await commitOps("Booking payment", ops);
      return { ok: true, state: { total: before.state.total, settledPaid, outstanding, fullyPaid, status: nextStatus, jobStatus: nextJob, duplicate, changeDue } };
    }
    const res = await supabase.rpc("booking_collect" as never, {
      _booking_id: input.bookingId,
      _amount: input.amount,
      _method: input.method,
      _cashier: input.cashier ?? null,
      _reference: input.reference ?? null,
      _client_payment_id: input.clientPaymentId,
      _complete: input.complete,
    } as never);
    if (res.error) return { ok: false, error: readable(message(res.error, "Payment refused.")) };
    const row = (Array.isArray(res.data) ? res.data[0] : res.data) as
      | Record<string, unknown>
      | undefined;
    if (!row) return { ok: false, error: "The server did not confirm the payment." };
    return { ok: true, state: toState(row) };
  } catch (e) {
    return { ok: false, error: readable(message(e, "The booking database could not be reached.")) };
  }
}

/**
 * Hand money back. The server caps the refund at what was actually taken and
 * writes a negative payment line, so the history is never rewritten.
 */
export async function refundBookingPayment(input: {
  bookingId: string;
  amount: number;
  method: PaymentMethod;
  reason: string;
  cashier?: string | null;
  clientPaymentId: string;
}): Promise<BookingMoneyResult> {
  if (!CUSTOMER_REFUNDS_ALLOWED) return { ok: false, error: NO_REFUND_MESSAGE };
  try {
    if (localDb()?.writeBatch) {
      const clean = input.reason.trim();
      if (clean.length < 3) throw new Error("REFUND_REASON_REQUIRED");
      const before = await localBalance(input.bookingId);
      const duplicate = await duplicatePayment(input.bookingId, input.clientPaymentId);
      const give = roundMoney(input.amount);
      if (give <= 0) throw new Error("REFUND_AMOUNT_INVALID");
      if (!duplicate && give > before.state.settledPaid + MONEY_TOLERANCE) throw new Error("REFUND_EXCEEDS_PAID");
      const now = new Date().toISOString();
      const settledPaid = roundMoney(before.state.settledPaid - (duplicate ? 0 : give));
      const outstanding = roundMoney(Math.max(0, before.state.total - settledPaid));
      const ops = [] as Parameters<typeof commitOps>[1];
      if (!duplicate) ops.push({
        kind: "insert", table: "booking_payments", rows: [{
          id: crypto.randomUUID(), booking_id: input.bookingId, amount: -give,
          method: input.method, cashier: input.cashier ?? before.booking.cashier ?? null,
          paid_at: now, created_at: now, status: "settled", client_payment_id: input.clientPaymentId,
          kind: "refund", refund_reason: clean, change_given: 0,
        }],
      });
      ops.push({ kind: "update", table: "bookings", match: { id: input.bookingId }, values: {
        store_id: before.booking.store_id, paid: settledPaid, updated_at: now,
      } });
      await commitOps("Booking refund", ops);
      return { ok: true, state: { ...before.state, settledPaid, outstanding, fullyPaid: outstanding <= MONEY_TOLERANCE, duplicate, changeDue: 0 } };
    }
    const res = await supabase.rpc("booking_refund" as never, {
      _booking_id: input.bookingId,
      _amount: input.amount,
      _method: input.method,
      _reason: input.reason,
      _cashier: input.cashier ?? null,
      _client_payment_id: input.clientPaymentId,
    } as never);
    if (res.error) return { ok: false, error: readable(message(res.error, "Refund refused.")) };
    const row = (Array.isArray(res.data) ? res.data[0] : res.data) as
      | Record<string, unknown>
      | undefined;
    if (!row) return { ok: false, error: "The server did not confirm the refund." };
    return { ok: true, state: toState(row) };
  } catch (e) {
    return { ok: false, error: readable(message(e, "The booking database could not be reached.")) };
  }
}

/** Cancel a booking with a reason the server stores for good. */
export async function cancelBookingAuthoritative(input: {
  bookingId: string;
  reason: string;
  cancelledBy?: string | null;
  terminal?: string | null;
  /** what happens to money already taken — required once anything is held */
  moneyAction?: "refunded" | "retained" | null;
  clientPaymentId?: string | null;
}): Promise<{ ok: true; row: Record<string, unknown> } | { ok: false; error: string }> {
  if (!CUSTOMER_REFUNDS_ALLOWED && input.moneyAction === "refunded") return { ok: false, error: NO_REFUND_MESSAGE };
  try {
    if (localDb()?.writeBatch) {
      const clean = input.reason.trim();
      if (clean.length < 3) throw new Error("CANCEL_REASON_REQUIRED");
      const before = await localBalance(input.bookingId);
      if (before.state.status === "collected") throw new Error("BOOKING_ALREADY_COLLECTED");
      let action = String(input.moneyAction ?? "").toLowerCase();
      if (before.state.settledPaid > MONEY_TOLERANCE && !["refunded", "retained"].includes(action))
        throw new Error("CANCEL_MONEY_DECISION_REQUIRED");
      if (before.state.settledPaid <= MONEY_TOLERANCE) action = "none";
      const now = new Date().toISOString();
      const duplicate = input.clientPaymentId ? await duplicatePayment(input.bookingId, input.clientPaymentId) : false;
      const ops = [] as Parameters<typeof commitOps>[1];
      if (action === "refunded" && before.state.settledPaid > 0 && !duplicate) ops.push({
        kind: "insert", table: "booking_payments", rows: [{
          id: crypto.randomUUID(), booking_id: input.bookingId, amount: -before.state.settledPaid,
          method: "cash", cashier: input.cancelledBy ?? before.booking.cashier ?? null,
          paid_at: now, created_at: now, status: "settled", client_payment_id: input.clientPaymentId ?? null,
          kind: "refund", refund_reason: `Refunded on cancellation: ${clean}`, change_given: 0,
        }],
      });
      const paid = action === "refunded" ? 0 : before.state.settledPaid;
      const values = {
        store_id: before.booking.store_id, status: "cancelled", paid,
        closed_at: before.booking.closed_at ?? now,
        cancel_reason: before.booking.cancel_reason ?? clean,
        cancelled_by: before.booking.cancelled_by ?? input.cancelledBy ?? null,
        cancelled_at: before.booking.cancelled_at ?? now,
        cancelled_terminal: before.booking.cancelled_terminal ?? input.terminal ?? null,
        cancel_money_action: before.booking.cancel_money_action ?? action,
        updated_at: now,
      };
      ops.push({ kind: "update", table: "bookings", match: { id: input.bookingId }, values });
      await commitOps("Booking cancellation", ops);
      return { ok: true, row: { ...before.booking, ...values } };
    }
    const res = await supabase.rpc("booking_cancel" as never, {
      _booking_id: input.bookingId,
      _reason: input.reason,
      _cancelled_by: input.cancelledBy ?? null,
      _terminal: input.terminal ?? null,
      _money_action: input.moneyAction ?? null,
      _client_payment_id: input.clientPaymentId ?? null,
    } as never);
    if (res.error)
      return { ok: false, error: readable(message(res.error, "The cancellation was refused.")) };
    const row = (Array.isArray(res.data) ? res.data[0] : res.data) as
      | Record<string, unknown>
      | undefined;
    if (!row) return { ok: false, error: "The server did not confirm the cancellation." };
    return { ok: true, row };
  } catch (e) {
    return { ok: false, error: readable(message(e, "The booking database could not be reached.")) };
  }
}

/** Turn the server's coded refusals into counter English. */
export function readable(raw: string): string {
  if (raw.includes("PERMISSION_DENIED_COLLECT_BOOKING"))
    return "You do not have permission to collect booking payments.";
  if (raw.includes("PERMISSION_DENIED_CANCEL_BOOKING"))
    return "You do not have permission to cancel bookings.";
  if (raw.includes("CANCEL_REASON_REQUIRED")) return "A cancellation reason is required.";
  if (raw.includes("BOOKING_ALREADY_COLLECTED")) return "This booking has already been collected.";
  if (raw.includes("BOOKING_CANCELLED")) return "This booking was cancelled.";
  if (raw.includes("BOOKING_OVERPAYMENT"))
    return "That is more than the amount still outstanding — refresh and try again.";
  if (raw.includes("BOOKING_BALANCE_DUE"))
    return "A balance is still outstanding, so this booking cannot be marked collected.";
  if (raw.includes("PERMISSION_DENIED_REFUND_BOOKING"))
    return "You do not have permission to process refunds.";
  if (raw.includes("REFUND_REASON_REQUIRED")) return "A refund reason is required.";
  if (raw.includes("REFUND_AMOUNT_INVALID")) return "Enter a refund amount greater than zero.";
  if (raw.includes("REFUND_EXCEEDS_PAID"))
    return "That is more than has been taken on this booking.";
  if (raw.includes("CANCEL_MONEY_DECISION_REQUIRED"))
    return "Money is held on this booking — say whether it is refunded or retained.";
  if (raw.includes("BOOKING_NOT_FOUND")) return "This booking is not in the central database.";
  return raw;
}

export const isSettled = (outstanding: number) => outstanding <= MONEY_TOLERANCE;
