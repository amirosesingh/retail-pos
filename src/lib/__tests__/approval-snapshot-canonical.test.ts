import { describe, expect, it } from "vitest";
import { normalizeSnapshot, snapshotFingerprint, type TicketSnapshot } from "../ticket-snapshot";
const ticket: TicketSnapshot = {
  ticketId: "BILL-1", billNo: "BILL-1", capturedAt: "2026-10-23T00:00:00Z",
  storeId: "A", terminalId: "PC1", cashier: "Staff",
  lines: [{ sku: "item", name: "Long product name ".repeat(15), qty: 1, unitPrice: 12.345678, discount: 25, lineTotal: 9.2592585 }],
  subtotal: 12.345678, discount: 3.0864195, tax: 0, serviceCharge: 0, total: 9.2592585, requestedValue: 25,
};
describe("approval ticket fingerprint", () => {
  it("matches the server-normalized ticket after holding and reopening", () => {
    expect(snapshotFingerprint(ticket)).toBe(snapshotFingerprint(normalizeSnapshot(ticket)));
    expect(snapshotFingerprint(ticket)).toBe(snapshotFingerprint(JSON.parse(JSON.stringify(ticket))));
  });
  it("still rejects a changed amount, discount, member or bill", () => {
    for (const change of [{ total: 8 }, { requestedValue: 30 }, { ticketId: "BILL-2" }, { member: { id: "other", name: "Other" } }]) {
      expect(snapshotFingerprint({ ...ticket, ...change })).not.toBe(snapshotFingerprint(ticket));
    }
    expect(snapshotFingerprint({ ...ticket, lines: [{ ...ticket.lines[0], qty: 2 }] })).not.toBe(snapshotFingerprint(ticket));
  });
  it("ignores presentation-only capture time and terminal", () => {
    expect(snapshotFingerprint({ ...ticket, capturedAt: "later", terminalId: "PC2" })).toBe(snapshotFingerprint(ticket));
  });
});
