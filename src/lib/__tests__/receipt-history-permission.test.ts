import { describe, expect, it } from "vitest";
import { canRetrieveHistoricalReceipt } from "../receipt-history-permission";

describe("historical receipt read permission", () => {
  it("allows a cashier with reprint permission without granting refund authority", () => {
    const scope = { role: "cashier", permissions: { can_reprint_bill: true, can_process_refund: false } };
    expect(canRetrieveHistoricalReceipt(scope)).toBe(true);
    expect(scope.permissions.can_process_refund).toBe(false);
  });
  it("retains administrator and existing refund reads and rejects unrelated permissions", () => {
    expect(canRetrieveHistoricalReceipt({ role: "admin", permissions: {} })).toBe(true);
    expect(canRetrieveHistoricalReceipt({ permissions: { can_process_refund: true } })).toBe(true);
    expect(canRetrieveHistoricalReceipt({ role: "manager", permissions: {} })).toBe(false);
    expect(canRetrieveHistoricalReceipt({ permissions: { can_view_sales_reports: true } })).toBe(false);
  });
});
