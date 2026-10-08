import { describe, expect, it } from "vitest";
import { activityVisibleTo } from "../activity-audience";

const cashier = {
  userIds: ["cashier-1"],
  role: "cashier",
  storeId: "branch-a",
  terminalId: "terminal-a",
  mayViewGeneralActivity: false,
};

describe("targeted activity notifications", () => {
  it("shows an approval result only to its requester", () => {
    const row = {
      store_id: "branch-a",
      terminal_id: "terminal-a",
      meta: { audience_user_ids: ["cashier-1"] },
    };
    expect(activityVisibleTo(row, cashier)).toBe(true);
    expect(
      activityVisibleTo(row, { ...cashier, userIds: ["cashier-2"], terminalId: "terminal-b" }),
    ).toBe(false);
    expect(activityVisibleTo(row, { ...cashier, storeId: "branch-b" })).toBe(false);
    expect(
      activityVisibleTo(row, { ...cashier, userIds: ["cashier-2"], terminalId: "terminal-a" }),
    ).toBe(false);
  });

  it("honours an explicit terminal-only audience for non-user alerts", () => {
    const row = {
      store_id: "branch-a",
      terminal_id: "source-terminal",
      meta: { audience_terminal_id: "terminal-a" },
    };
    expect(activityVisibleTo(row, cashier)).toBe(true);
    expect(activityVisibleTo(row, { ...cashier, terminalId: "terminal-b" })).toBe(false);
  });

  it("routes requests only to configured approver roles in the same branch", () => {
    const row = {
      store_id: "branch-a",
      meta: { audience: "configured_approvers", audience_roles: ["manager"] },
    };
    expect(activityVisibleTo(row, { ...cashier, role: "manager" })).toBe(true);
    expect(activityVisibleTo(row, cashier)).toBe(false);
    expect(activityVisibleTo(row, { ...cashier, role: "manager", storeId: "branch-b" })).toBe(
      false,
    );
  });

  it("rejects a branch-targeted alert when the duty branch is unknown", () => {
    expect(activityVisibleTo({ store_id: "branch-a", meta: { audience_user_ids: ["cashier-1"] } }, { ...cashier, storeId: null })).toBe(false);
    expect(activityVisibleTo({ store_id: "BRANCH-A", meta: { audience_user_ids: ["CASHIER-1"] } }, cashier)).toBe(true);
  });

  it("keeps general activity behind audit access", () => {
    expect(activityVisibleTo({ store_id: "branch-a", meta: {} }, cashier)).toBe(false);
    expect(
      activityVisibleTo(
        { store_id: "branch-a", meta: {} },
        { ...cashier, mayViewGeneralActivity: true },
      ),
    ).toBe(true);
  });
});


describe("branch operations and admin financial notifications", () => {
  it.each(["stock_request_received", "transfer_received", "transfer_sent", "po_finalised"])("shows %s to branch staff without audit permission", (event_type) => {
    const row = { event_type, store_id: "branch-a", meta: {} };
    expect(activityVisibleTo(row, cashier)).toBe(true);
    expect(activityVisibleTo(row, { ...cashier, storeId: "branch-b" })).toBe(false);
    expect(activityVisibleTo({ ...row, store_id: null }, cashier)).toBe(false);
  });
  it.each(["sale_complete", "shift_close", "shift_open", "shift_cash_variance"])("limits %s to administrators", (event_type) => {
    const row = { event_type, store_id: "branch-a", meta: {} };
    expect(activityVisibleTo(row, { ...cashier, role: "manager", mayViewGeneralActivity: true })).toBe(false);
    expect(activityVisibleTo(row, { ...cashier, role: "admin", mayViewGeneralActivity: true })).toBe(true);
  });
  it("does not let audit permission override a private approval audience", () => {
    expect(activityVisibleTo({ store_id: "branch-a", meta: { audience_user_ids: ["other-person"] } }, { ...cashier, role: "admin", mayViewGeneralActivity: true })).toBe(false);
  });
});
