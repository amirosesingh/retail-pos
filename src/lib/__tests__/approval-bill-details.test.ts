import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { normalizeSnapshot, previewBillAfterDiscount } from "../ticket-snapshot";
import { applyApprovedDiscount, removeApprovedDiscount } from "../register/use-held-orders";
import { cartTotals } from "../pos-store";

const held = {
  id: "held-1",
  label: "Test bill",
  total: 100,
  billNo: "B-1001",
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
    expect(page).toContain("Decided approvals");
    expect(page).toContain("Include decided");
    expect(page).toContain("Bill number");
    expect(page).toContain("Purpose");
    expect(page).toContain("After discount");
    expect(page).toContain("Open ${row.status} approval details");
    expect(page).toContain('if (unit === "currency") return `$${money(value)}`');
    expect(page).toContain("e.target.validity.badInput || value.length > 12");
    expect(page).not.toContain("e.target.value.slice(0, 12)");
  });

  it("applies an approved percentage to the bill and final payable total", () => {
    const applied = applyApprovedDiscount(held, {
      requestId: "request-1",
      actionKey: "discount_over_limit",
      approvedPayload: {
        discount_scope: "bill",
        discount_type: "percent",
        bill_no: "B-1001",
      },
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

  it("previews a bill discount from the pre-tax value after line discounts", () => {
    const snapshot = normalizeSnapshot({
      ticketId: "draft-42",
      capturedAt: "2026-10-01T02:00:00.000Z",
      storeId: "store-1",
      terminalId: "till-2",
      cashier: "Amina",
      lines: [
        { sku: "SKU-1", name: "Shuttlecock", qty: 2, unitPrice: 12, discount: 1, lineTotal: 23 },
      ],
      subtotal: 24,
      discount: 1,
      tax: 1.15,
      serviceCharge: 0,
      total: 24.15,
    });

    expect(snapshot).not.toBeNull();
    expect(previewBillAfterDiscount(snapshot!, 10, "percent")).toBe(21.74);
    expect(previewBillAfterDiscount(snapshot!, 30, "amount")).toBe(0);

    expect(
      previewBillAfterDiscount(
        { ...snapshot!, tax: 1.1, serviceCharge: 2, total: 25 },
        10,
        "percent",
      ),
    ).toBe(22.7);
  });

  it("applies an approved fixed amount to the requested item", () => {
    const applied = applyApprovedDiscount(held, {
      requestId: "request-2",
      actionKey: "discount_over_limit",
      approvedPayload: {
        discount_scope: "item",
        discount_type: "amount",
        target_product_id: "product-1",
        bill_no: "B-1001",
        target_line_key: "B-1001|0|product-1|1|100",
      },
      grantToken: "grant",
      approvedAmount: 2,
      requestedAmount: 2,
      requesterDirectLimit: 10,
      valueUnit: "currency",
    });
    expect(applied.lines[0]).toMatchObject({ discount: 2, discountType: "amount" });
    expect(cartTotals(applied.lines, applied.cartDiscount, applied.cartDiscountType).total).toBe(
      98,
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
        bill_no: "B-1001",
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
        bill_no: "B-1001",
        target_line_key: "B-1001|1|product-1|2|100",
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

  it("removes the exact approved discount when its bill binding is invalidated", () => {
    const bill = removeApprovedDiscount(
      { lines: held.lines, cartDiscount: 22, cartDiscountType: "percent" },
      { actionKey: "discount_over_limit", approvedPayload: { discount_scope: "bill" } },
    );
    expect(bill.cartDiscount).toBe(0);

    const item = removeApprovedDiscount(
      {
        lines: [{ ...held.lines[0], discount: 2, discountType: "amount" }],
        cartDiscount: 0,
        cartDiscountType: "amount",
      },
      {
        actionKey: "discount_over_limit",
        approvedPayload: {
          discount_scope: "item",
          target_index: 0,
          target_product_id: "product-1",
        },
      },
    );
    expect(item.lines[0]?.discount).toBe(0);
  });

  it("refuses to redirect an approval to another bill or changed item", () => {
    const wrongBill = applyApprovedDiscount(held, {
      requestId: "request-wrong-bill",
      actionKey: "discount_over_limit",
      approvedPayload: {
        discount_scope: "bill",
        discount_type: "percent",
        bill_no: "B-OTHER",
      },
      grantToken: "grant",
      approvedAmount: 15,
      requestedAmount: 15,
      requesterDirectLimit: 10,
      valueUnit: "percent",
    });
    expect(wrongBill.cartDiscount).toBe(0);

    const changedItem = applyApprovedDiscount(held, {
      requestId: "request-changed-item",
      actionKey: "discount_over_limit",
      approvedPayload: {
        discount_scope: "item",
        discount_type: "amount",
        target_product_id: "product-1",
        target_index: 0,
        bill_no: "B-1001",
        target_line_key: "B-1001|0|product-1|2|100",
      },
      grantToken: "grant",
      approvedAmount: 15,
      requestedAmount: 15,
      requesterDirectLimit: 10,
      valueUnit: "currency",
    });
    expect(changedItem.lines[0]?.discount).toBe(0);
  });

  it("rejects unbound discount requests at the trusted server boundary", () => {
    const functions = readFileSync("src/lib/authorization.functions.ts", "utf8");
    expect(functions).toContain("A discount approval must be tied to one reserved bill number");
    expect(functions).toContain("An item approval must match one exact item on that bill");
    expect(functions).toContain("snapshot?.ticketId !== billNo");
    expect(functions).toContain('data.payload["target_line_key"] !== expectedLineKey');
  });

  it("voids bill-bound approvals when their held ticket or applied cart is discarded", () => {
    const server = readFileSync("src/lib/authorization.server.ts", "utf8");
    const functions = readFileSync("src/lib/authorization.functions.ts", "utf8");
    const holds = readFileSync("src/routes/holds.tsx", "utf8");
    const register = readFileSync("src/routes/index.tsx", "utf8");
    const discardStart = holds.indexOf("async function discard");
    const discard = holds.slice(discardStart, holds.indexOf("\n  return (", discardStart));

    expect(server).toContain("status=in.(pending,approved)");
    expect(functions).toContain('request.status !== "approved"');
    expect(functions).toContain('error: "That approval is no longer valid"');
    expect(discard.indexOf("cancelAuthorizationRequest")).toBeLessThan(
      discard.indexOf("removeHeldOrder(order.id)"),
    );
    expect(register).toContain("Approved bill or item changed before completion");
    expect(register).toContain("appliedSnapshotHash");
    expect(register).toContain("revokeApprovalDiscountRef.current(approval)");
    expect(register).toContain("resumedGrant.grantToken");
  });

  it("returns and displays the durable approver identity and payable total", () => {
    const functions = readFileSync("src/lib/authorization.functions.ts", "utf8");
    const register = readFileSync("src/routes/index.tsx", "utf8");
    const checkout = readFileSync("src/lib/register/use-checkout.ts", "utf8");
    expect(functions).toContain("approvedByName: request.decidedByName");
    expect(register).toContain("grant.approvedByName || grant.approvedBy");
    expect(register).toContain("payable ${money(totals.total)}");
    expect(register).toContain("appliedApprovalRef.current.approvedByName");
    expect(checkout).toContain("authorizationRequestId: grant.requestId");
    expect(checkout).toContain("authorizedBy: grant.approvedBy ?? null");
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
    expect(register).toContain("Approval certificate · {appliedApprovalText}");
    expect(register).toContain("approvedAmount - appliedApproval.requesterDirectLimit");
    expect(register).not.toContain("existing.grantToken");
    expect(holds).toContain("Approved — ready");
    expect(holds).toContain("Approval applied");
  });
});
