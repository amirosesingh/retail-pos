import { describe, expect, it } from "vitest";
import { markTicketDiscountApprovals, ticketDiscountApprovalPercent, type TicketDiscount } from "../authorization";
const item = (value = 20): TicketDiscount => ({ index: 0, productId: "p", name: "Item", qty: 1, price: 100, base: 100, type: "percent", value, requiresApproval: false });
const bill = (value: number, type: "amount" | "percent" = "amount"): TicketDiscount => ({ index: -1, productId: "", name: "Whole bill", qty: 1, price: 0, base: 80, type, value, requiresApproval: false });
describe("cumulative discount approval", () => {
  it("allows exactly 20 percent without extra discount", () => {
    expect(ticketDiscountApprovalPercent([item()])).toBe(20);
    expect(markTicketDiscountApprovals([item()], 20, 100)[0].requiresApproval).toBe(false);
  });
  it("requires approval for 20 percent plus three dollars", () => {
    expect(ticketDiscountApprovalPercent([item(), bill(3)])).toBe(23);
    const marked = markTicketDiscountApprovals([item(), bill(3)], 20, 100);
    expect(marked[0].requiresApproval).toBe(false);
    expect(marked[1].requiresApproval).toBe(true);
    expect(marked[1].type).toBe("amount");
    expect(marked[1].value).toBe(3);
  });
  it("compounds percentages on the remaining balance", () => {
    expect(ticketDiscountApprovalPercent([item(), bill(10, "percent")])).toBe(28);
  });
  it("converts item amounts and preserves standalone amount caps", () => {
    expect(ticketDiscountApprovalPercent([{...item(), type: "amount"}, bill(3)])).toBe(23);
    expect(markTicketDiscountApprovals([bill(3)], 20, 2)[0].requiresApproval).toBe(true);
  });
  it("does not average away a heavily discounted item or exceed 100 percent", () => {
    expect(ticketDiscountApprovalPercent([item(50), {...item(0), index: 1}, bill(10, "percent")])).toBe(55);
    expect(ticketDiscountApprovalPercent([item(100), bill(100, "percent")])).toBe(100);
  });
  it("uses the increased bill balance when an approver reduces item discounts", () => {
    const requested = [item(), bill(3)];
    expect(ticketDiscountApprovalPercent([item(10), bill(3)], requested)).toBeCloseTo(13);
    expect(ticketDiscountApprovalPercent([item(0), bill(3)], requested)).toBeCloseTo(3);
    expect(ticketDiscountApprovalPercent(requested)).toBe(23);
  });
  it("handles empty and zero base tickets", () => {
    expect(ticketDiscountApprovalPercent([])).toBe(0);
    expect(ticketDiscountApprovalPercent([{...bill(0), base: 0}])).toBe(0);
  });
});
