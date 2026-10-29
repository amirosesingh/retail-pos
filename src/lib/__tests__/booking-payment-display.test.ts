import { describe, expect, it } from "vitest";
import { bookingPaymentDisplay, idleBookingDisplay } from "../booking-payment-display";
import type { Booking, Store } from "@/core/types/pos-types";
const booking = { id: "job", ref: "JOB-1", customerName: "Customer", total: 100, subtotal: 100, tax: 0, discount: 0, paid: 0, dueDate: "2026-10-27", lines: [] } as unknown as Booking;
const store = { name: "Shop" } as Store;
describe("booking collection customer display", () => {
  it("shows verified paid/balance values and the selected tender without pretending payment was committed", () => {
    const snapshot = bookingPaymentDisplay(booking, 40, store, "Business", "Cashier", "card", null);
    expect(snapshot).toMatchObject({ mode: "booking", reference: "JOB-1", paid: 60, balance: 40, total: 100, method: "card" });
    expect(booking.paid).toBe(0);
    expect(bookingPaymentDisplay(booking, 0, store, "Business", "Cashier", "cash", null).balance).toBe(0);
  });
  it("removes customer and payment information when the popup closes", () => {
    const snapshot = idleBookingDisplay(bookingPaymentDisplay(booking, 40, store, "Business", "Cashier", "cash", null));
    expect(snapshot).toMatchObject({ mode: "idle", lines: [], memberName: null, reference: "", paid: 0, balance: 0, method: null });
  });
});
