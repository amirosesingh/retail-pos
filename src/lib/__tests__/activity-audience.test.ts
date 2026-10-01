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
  it("shows an approval result only to its requester or originating terminal", () => {
    const row = {
      store_id: "branch-a",
      terminal_id: "terminal-a",
      meta: { audience_user_ids: ["cashier-1"], audience_terminal_id: "terminal-a" },
    };
    expect(activityVisibleTo(row, cashier)).toBe(true);
    expect(
      activityVisibleTo(row, { ...cashier, userIds: ["cashier-2"], terminalId: "terminal-b" }),
    ).toBe(false);
    expect(activityVisibleTo(row, { ...cashier, storeId: "branch-b" })).toBe(false);
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
