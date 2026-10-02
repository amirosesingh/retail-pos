import { describe, expect, it } from "vitest";
import { resolveCategory } from "../audit-log";

describe("human-readable audit categories", () => {
  it("separates payments, refunds and discounts emitted by legacy sale events", () => {
    expect(resolveCategory("sale_event", "Bill payment method corrected", "receipts")).toBe(
      "payment",
    );
    expect(resolveCategory("sale_event", "Sale refunded", "receipts")).toBe("refund");
    expect(resolveCategory("sale_event", "Bill discount approved", "register")).toBe("discount");
    expect(resolveCategory("sale", "Bill payment method corrected", "receipts")).toBe("payment");
    expect(resolveCategory("sale", "Sale refunded", "receipts")).toBe("refund");
    expect(resolveCategory("sale", "Bill discount approved", "register")).toBe("discount");
  });

  it("keeps plain completed-sale events under sales", () => {
    expect(resolveCategory("sale_event", "Bill completed", "register")).toBe("sale");
    expect(resolveCategory("sale", "Job card created", "bookings")).toBe("sale");
  });
});
