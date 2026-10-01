import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { normalizeSnapshot } from "../ticket-snapshot";
import { applyApprovedDiscount } from "../register/use-held-orders";
import { cartTotals } from "../pos-store";

const held = {
  id: "held-1",
  label: "Test bill",
  total: 100,
  heldAt: "2026-10-01T02:00:00.000Z",
  lines: [
    {
      productId: "product-1",
      name: "Racket",
      price: 100,
      qty: 1,
      taxRate: 0,
      discount: 0,
      discountType: "percent" as const,
    },
  ],
};

describe("approval bill details", () => {
  it("retains the member and cart context needed for a later approval review", () => {
    const snapshot = normalizeSnapshot({
      ticketId: "draft-42",
      capturedAt: "2026-10-01T02:00:00.000Z",
      storeId: "store-1",
      terminalId: "till-2",
      cashier: "Amina",
      billNo: "B-1042",
      lines: [
        { sku: "SKU-1", name: "Shuttlecock", qty: 2, unitPrice: 12, discount: 1, lineTotal: 23 },
      ],
      subtotal: 24,
      discount: 1,
      tax: 0,
      serviceCharge: 0,
      total: 23,
      requestedValue: 15,
      requestedLabel: "Authorise bill discount",
      member: {
        id: "member-1",
        code: "M-100",
        name: "Nur",
        phone: "+6731234567",
        email: "nur@example.test",
        tier: "Gold",
        points: 320,
        totalSpend: 850,
      },
    });

    expect(snapshot).toMatchObject({
      billNo: "B-1042",
      requestedValue: 15,
      lines: [{ sku: "SKU-1", qty: 2, lineTotal: 23 }],
      member: {
        id: "member-1",
        code: "M-100",
        phone: "•••••• 4567",
        email: "n•••@example.test",
        totalSpend: 850,
      },
    });
  });

  it("shows complete bill review and explicit total-versus-extra approval controls", () => {
    const page = readFileSync("src/routes/approvals.tsx", "utf8");
    expect(page).toContain("Bill number");
    expect(page).toContain("Member ID");
    expect(page).toContain("Member code");
    expect(page).toContain("No cart lines were recorded");
    expect(page).toContain("Requested total");
    expect(page).toContain("Cashier's current limit");
    expect(page).toContain("Extra being granted");
    expect(page).toContain("Total approval to grant");
    expect(page).toContain("Extra above cashier limit");
    expect(page).toContain("This request was created without a bill snapshot");
    expect(page).toContain("e.target.validity.badInput || value.length > 12");
    expect(page).not.toContain("e.target.value.slice(0, 12)");
  });

  it("applies an approved percentage to the bill and final payable total", () => {
    const applied = applyApprovedDiscount(held, {
      requestId: "request-1",
      actionKey: "discount_over_limit",
      approvedPayload: { discount_scope: "bill", discount_type: "percent" },
      grantToken: "grant",
      approvedAmount: 22,
      requestedAmount: 22,
      requesterDirectLimit: 20,
      valueUnit: "percent",
    });
    expect(applied).toMatchObject({ cartDiscount: 22, cartDiscountType: "percent" });
    expect(cartTotals(applied.lines, applied.cartDiscount, applied.cartDiscountType).total).toBe(
      78,
    );
  });

  it("applies an approved fixed amount to the requested item", () => {
    const applied = applyApprovedDiscount(held, {
      requestId: "request-2",
      actionKey: "discount_over_limit",
      approvedPayload: {
        discount_scope: "item",
        discount_type: "amount",
        target_product_id: "product-1",
      },
      grantToken: "grant",
      approvedAmount: 20,
      requestedAmount: 20,
      requesterDirectLimit: 10,
      valueUnit: "currency",
    });
    expect(applied.lines[0]).toMatchObject({ discount: 20, discountType: "amount" });
    expect(cartTotals(applied.lines, applied.cartDiscount, applied.cartDiscountType).total).toBe(
      80,
    );
  });

  it("does not redirect an item approval to a duplicate or mismatched cart line", () => {
    const duplicate = {
      ...held,
      lines: [held.lines[0], { ...held.lines[0], qty: 2 }],
    };
    const ambiguous = applyApprovedDiscount(duplicate, {
      requestId: "request-duplicate",
      actionKey: "discount_over_limit",
      approvedPayload: {
        discount_scope: "item",
        discount_type: "percent",
        target_product_id: "product-1",
      },
      grantToken: "grant",
      approvedAmount: 22,
      requestedAmount: 22,
      requesterDirectLimit: 20,
      valueUnit: "percent",
    });
    expect(ambiguous.lines.every((line) => line.discount === 0)).toBe(true);

    const exact = applyApprovedDiscount(duplicate, {
      requestId: "request-exact",
      actionKey: "discount_over_limit",
      approvedPayload: {
        discount_scope: "item",
        discount_type: "percent",
        target_product_id: "product-1",
        target_index: 1,
      },
      grantToken: "grant",
      approvedAmount: 22,
      requestedAmount: 22,
      requesterDirectLimit: 20,
      valueUnit: "percent",
    });
    expect(exact.lines[0].discount).toBe(0);
    expect(exact.lines[1].discount).toBe(22);
  });

  it("expires unused approved requests and guards consumption by the deadline", () => {
    const server = readFileSync("src/lib/authorization.server.ts", "utf8");
    expect(server).toContain("status=in.(pending,approved)&consumed_at=is.null");
    expect(server).toContain("&expires_at=gt.");
  });

  it("allows a discount when the effective authorization rule is switched off", () => {
    const register = readFileSync("src/routes/index.tsx", "utf8");
    expect(register).toContain("if (grant === null) return;");
  });

  it("prevents duplicate one-time claims and keeps the applied approval visible", () => {
    const held = readFileSync("src/lib/register/use-held-orders.ts", "utf8");
    const register = readFileSync("src/routes/index.tsx", "utf8");
    const holds = readFileSync("src/routes/holds.tsx", "utf8");
    expect(held).toContain("resuming.current.has(id)");
    expect(register).toContain("Approval applied · {appliedApprovalText}");
    expect(register).toContain("approvedAmount - appliedApproval.requesterDirectLimit");
    expect(holds).toContain("Approved — ready");
    expect(holds).toContain("Approval applied");
  });
});
