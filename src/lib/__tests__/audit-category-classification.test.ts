import { describe, expect, it } from "vitest";
import { boundedAuditDetails, resolveCategory } from "../audit-log";

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

  it("bounds accidental state snapshots before they enter a durable audit batch", () => {
    const details = boundedAuditDetails({
      logo: `data:image/png;base64,${"a".repeat(7 * 1024 * 1024)}`,
      settings: { integrations: { enabled: true } },
    });

    expect(Buffer.byteLength(JSON.stringify(details), "utf8")).toBeLessThan(16 * 1024);
    expect(details.logo).toContain("characters omitted");
    expect(details.settings).toEqual({ integrations: { enabled: true } });
  });
});
