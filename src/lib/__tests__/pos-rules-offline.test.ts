import { describe, expect, it } from "vitest";

import { DEFAULT_POS_RULES, offlineApprovalMode, type PosRules } from "@/lib/pos-rules";
import { pendingExpired, rulesEqual, PENDING_MAX_AGE_MS } from "@/lib/pos-rules-pending";

const rules = (patch: Partial<PosRules> = {}): PosRules => ({ ...DEFAULT_POS_RULES, ...patch });

describe("rules waiting to reach head office", () => {
  it("recognises the same policy coming back from the central system", () => {
    expect(rulesEqual(rules(), rules())).toBe(true);
    expect(rulesEqual(rules(), rules({ require_pin_void_line: !DEFAULT_POS_RULES.require_pin_void_line }))).toBe(
      false,
    );
  });

  it("stops holding the branch to a change that never got through", () => {
    const now = Date.now();
    expect(pendingExpired(now - 1000, now)).toBe(false);
    expect(pendingExpired(now - PENDING_MAX_AGE_MS - 1, now)).toBe(true);
  });
});

describe("what may be approved with no connection", () => {
  it("refuses everything when the branch does not allow offline approvals", () => {
    expect(offlineApprovalMode(rules({ allow_offline_approvals: false }), "refund")).toBe("refused");
  });

  it("refuses an action the branch marked connection-only", () => {
    expect(offlineApprovalMode(rules({ online_only_refund: true }), "refund")).toBe("refused");
    expect(offlineApprovalMode(rules({ online_only_refund: true }), "void_line")).not.toBe(
      "refused",
    );
  });

  it("does not apply the void-cart online-only policy to opening the cash drawer", () => {
    const policy = rules({ online_only_void_cart: true, allow_offline_approvals: true, offline_approval_requires_pin: true });
    expect(offlineApprovalMode(policy, "void_cart")).toBe("refused");
    expect(offlineApprovalMode(policy, "no_sale_drawer")).toBe("manager_pin");
    expect(offlineApprovalMode({ ...policy, allow_offline_approvals: false }, "no_sale_drawer")).toBe("refused");
  });

  it("asks for a manager PIN when the branch requires one", () => {
    expect(offlineApprovalMode(rules({ offline_approval_requires_pin: true }), "void_line")).toBe(
      "manager_pin",
    );
    expect(offlineApprovalMode(rules({ offline_approval_requires_pin: false }), "void_line")).toBe(
      "cached",
    );
  });
});
