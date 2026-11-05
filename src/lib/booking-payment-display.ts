import type { Booking, PaymentDetails, PaymentMethod, Store } from "@/core/types/pos-types";
import { lineRevenue } from "@/core/pricing/profit";
import { toDisplayLine, type DisplaySnapshot } from "./customer-display";
import { r2 } from "@/core/types/pos-types";
/** Show verified debt, never present an uncommitted tender as money received. */
export function bookingPaymentDisplay(booking: Booking, outstanding: number, store: Store, companyName: string, cashier: string, method: PaymentMethod, payment: PaymentDetails | null): DisplaySnapshot {
  return {
    at: Date.now(), mode: "booking", companyName, storeName: store.name, cashier,
    memberName: booking.customerName, memberPoints: null,
    lines: booking.lines.map(line => toDisplayLine(line, lineRevenue(line))),
    subtotal: booking.subtotal, discount: booking.discount, tax: booking.tax,
    total: booking.total, paid: r2(Math.max(0, booking.total - outstanding)), change: 0,
    balance: outstanding, reference: booking.ref, dueDate: booking.dueDate, promos: [],
    payment, method, transferRef: "",
  };
}
export function idleBookingDisplay(snapshot: DisplaySnapshot): DisplaySnapshot {
  return { ...snapshot, at: Date.now(), mode: "idle", lines: [], memberName: null, memberPoints: null, subtotal: 0, discount: 0, tax: 0, total: 0, paid: 0, change: 0, balance: 0, reference: "", dueDate: "", method: null, transferRef: "" };
}
