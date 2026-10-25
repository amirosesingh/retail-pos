import { describe, expect, it } from "vitest";
import {
  approvalAllBranchesAllowed,
  approvalBranchAllowed,
  approvalSelectedBranch,
  withApprovalScope,
} from "../approval-branch-scope";
import { normalizePermissions } from "../permissions";
describe("saved approval branch scope", () => {
  const account = { permissions: {}, storeId: "", isAdmin: false, branchRestricted: false };
  it("does not infer all-branch authority from an unassigned account or supervisor title", () => {
    expect(approvalAllBranchesAllowed(account)).toBe(false);
    expect(approvalBranchAllowed(account, "branch-a")).toBe(false);
  });
  it("round trips a selected branch through the existing saved permission matrix", () => {
    const permissions = normalizePermissions(
      withApprovalScope({ can_process_refund: true }, "selected", "branch-a"),
    );
    expect(approvalSelectedBranch(permissions)).toBe("branch-a");
    expect(approvalBranchAllowed({ ...account, permissions }, "branch-a")).toBe(true);
    expect(approvalBranchAllowed({ ...account, permissions }, "branch-b")).toBe(false);
    expect(permissions.can_process_refund).toBe(true);
  });
  it("honours explicitly saved all-branch access but cannot widen a fixed till or account", () => {
    const permissions = withApprovalScope({}, "all");
    expect(approvalAllBranchesAllowed({ ...account, permissions })).toBe(true);
    expect(approvalBranchAllowed({ ...account, permissions }, "branch-b")).toBe(true);
    expect(
      approvalBranchAllowed(
        { ...account, permissions, storeId: "branch-a", branchRestricted: true },
        "branch-b",
      ),
    ).toBe(false);
    expect(
      approvalBranchAllowed({ ...account, permissions, storeId: "branch-a" }, "branch-b"),
    ).toBe(false);
    expect(approvalAllBranchesAllowed({ ...account, permissions, storeId: "branch-a" })).toBe(
      false,
    );
  });
  it("removes old grants when switching mode and preserves unrelated permissions", () => {
    const all = withApprovalScope({ can_close_shift: true }, "all");
    const selected = withApprovalScope(all, "selected", "branch-b");
    expect((selected as Record<string, boolean>)["approval_scope:all"]).toBeUndefined();
    const assigned = withApprovalScope(selected, "assigned");
    expect(approvalSelectedBranch(assigned)).toBe("");
    expect(approvalAllBranchesAllowed({ ...account, permissions: assigned })).toBe(false);
    expect(assigned.can_close_shift).toBe(true);
  });
  it("lets the editor reset an old selected branch after an account is reassigned",()=>{
    const permissions=withApprovalScope({},"selected","branch-b");
    const moved={...account,storeId:"branch-a",permissions};
    expect(approvalBranchAllowed(moved,"branch-a")).toBe(false);
    expect(approvalBranchAllowed({...moved,permissions:withApprovalScope(permissions,"assigned")},"branch-a")).toBe(true);
  });
});
