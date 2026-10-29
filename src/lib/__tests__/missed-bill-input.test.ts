import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { missedBillInput } from "../missed-bill-input";
import { posDateTimeToIso, setPosTimeZone } from "../time-zone";
import { isMissedBillReference } from "../missed-bill-reference";
const input = () => ({
  storeId: "branch-a", clientKey: "10000000-0000-4000-8000-000000000001", originalReference: "PAPER-123",
  occurredAt: "2026-01-01T10:00:00Z", cashierId: "CASH1", originalShiftId: null,
  reason: "Original paper bill missed", stockHandling: "already_corrected", stockReason: "Adjustment ADJ-123",
  items: [{ productId: "10000000-0000-4000-8000-000000000002", quantity: 3, unitPrice: 10, unitCost: 4, discountAmount: 3, taxAmount: 0 }],
  payments: [{ method: "cash", amount: 27 }],
});
describe("missed-bill entry contract", () => {
  it("labels only server-issued historical receipt references", () => {
    expect(isMissedBillReference("MB-10000000-0000-4000-8000-000000000001")).toBe(true);
    expect(isMissedBillReference("MB-001")).toBe(false);
    expect(isMissedBillReference("STR1-1001")).toBe(false);
  });
  it("requires explicit stock handling and a reason for already-corrected stock", () => {
    expect(missedBillInput.safeParse(input()).success).toBe(true);
    expect(missedBillInput.safeParse({ ...input(), stockHandling: "" }).success).toBe(false);
    expect(missedBillInput.safeParse({ ...input(), stockReason: "" }).success).toBe(false);
  });
  it("rejects duplicate products, invalid amounts and incomplete historical attribution", () => {
    const value = input();
    expect(missedBillInput.safeParse({ ...value, items: [value.items[0], value.items[0]] }).success).toBe(false);
    expect(missedBillInput.safeParse({ ...value, cashierId: "" }).success).toBe(false);
    expect(missedBillInput.safeParse({ ...value, items: [{ ...value.items[0], unitPrice: -1 }] }).success).toBe(false);
    expect(missedBillInput.safeParse({ ...value, payments: [{ method: "cash", amount: 27.001 }] }).success).toBe(false);
  });
  it("interprets original date in the business zone rather than the viewer zone", () => {
    setPosTimeZone("Asia/Singapore");
    try { expect(posDateTimeToIso("2026-01-01T18:00")).toBe("2026-01-01T10:00:00.000Z"); }
    finally { setPosTimeZone(""); }
  });
  it("keeps historical entry separate from checkout and retains retry identity", () => {
    const dialog = readFileSync("src/platforms/web/components/pos/AddMissedBillDialog.tsx", "utf8");
    expect(dialog).toContain("submitted.current = input.data");
    expect(dialog).toContain("Retry same entry");
    expect(dialog).toContain("posDateTimeToIso(date)");
    expect(dialog).toContain("The original shift is an audit reference only");
    expect(dialog).toContain("Your form is retained; no offline transaction was queued");
    expect(dialog).not.toMatch(/commitSale\(|recordSale\(|printSaleReceipt\(|openDrawer\(/);
  });
});
