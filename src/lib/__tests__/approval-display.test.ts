import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { approvalBranchLabel, approvalDisplayFields } from "../approval-display";
import { ApprovalDiscountReview } from "@/platforms/web/components/pos/ApprovalDiscountReview";
import type { TicketDiscount } from "../authorization";
const id = "a611a328-2217-4d77-944a-5f6a637d123b";
const entries: TicketDiscount[] = [
 { index: 0, productId: "p1", name: "Racket", qty: 2, price: 100, base: 100, type: "percent", value: 20, requiresApproval: true },
 { index: -1, productId: "", name: "Bill discount", qty: 1, price: 200, base: 200, type: "amount", value: 5, requiresApproval: true },
];
describe("readable approval details", () => {
 it("identifies the requesting branch without labelling an unknown ID all branches", () => {
  const stores = [{id, name:"Main store", code:"STR1"}];
  expect(approvalBranchLabel(id.toUpperCase(), stores)).toBe("Main store (STR1)");
  expect(approvalBranchLabel("unknown", stores)).toBe("Branch unknown");
  expect(approvalBranchLabel(null, stores)).toBe("All branches");
 });
 it("keeps wire JSON intact but removes it from generic display fields", () => {
  const payload = {bill_no:"B-1", requested_discounts:JSON.stringify(entries), approved_discounts:"[]", discount_scope:"ticket"};
  expect(approvalDisplayFields(payload)).toEqual([["bill_no","B-1"],["discount_scope","ticket"]]);
  expect(JSON.parse(payload.requested_discounts)).toEqual(entries);
 });
 it("shows item/bill discounts and decisions as labelled values instead of JSON", () => {
  const html = renderToStaticMarkup(h(ApprovalDiscountReview, {payload:{requested_discounts:JSON.stringify(entries)},approvedPayload:{approved_discounts:JSON.stringify([{...entries[0],value:10},{...entries[1],value:0}])}}));
  for (const text of ["Requested discounts","Racket","20%","2 × $100.00","Whole bill","$5.00","Approved 10%","Rejected"]) expect(html).toContain(text);
  expect(html).not.toContain("requiresApproval");
  expect(html).not.toContain("productId");
 });
 it("reports unreadable discount data without printing JSON", () => {
  const html = renderToStaticMarkup(h(ApprovalDiscountReview,{payload:{requested_discounts:'[{"invalid":true}]'},approvedPayload:{}}));
  expect(html).toContain("could not be read");
  expect(html).not.toContain("invalid");
 });
});
