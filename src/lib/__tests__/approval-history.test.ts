import { expect, it } from "vitest";
import { approvalHistorySummary } from "../approval-history";
it("shows the verified approver, token method and bill for cloud and offline SQL JSON", () => {
  const detail = {
    credential_method: "totp",
    approved_by_name: "Test Approver",
    ticket_reference: "B-123",
    offline: true,
  };
  for (const value of [detail, JSON.stringify(detail)]) {
    expect(
      approvalHistorySummary({ mode_used: "offline_pin", authorized_by: "manager", detail: value }),
    ).toEqual({
      name: "Test Approver",
      method: "soft token",
      reference: "B-123",
      label: "Approved by Test Approver using soft token",
      offline: true,
    });
  }
});
it("keeps legacy PIN/request attribution without inventing a token method", () => {
  expect(
    approvalHistorySummary({ authorized_by: "manager", mode_used: "pin", detail: "{}" }).label,
  ).toBe("Approved by manager using approval PIN");
  expect(
    approvalHistorySummary({ mode_used: "request", detail: { bill_no: "B-2" } }).reference,
  ).toBe("B-2");
});
