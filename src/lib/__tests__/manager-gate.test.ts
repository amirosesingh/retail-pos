/**
 * Manager approvals: every gated action must map to a real rule, and the
 * grant handed back after a PIN check must not be forgeable or reusable
 * for a different action.
 */
import { beforeAll, describe, expect, it } from "vitest";

import {
  DEFAULT_POS_RULES,
  GATE_RULE_KEY,
  normalizeRules,
  requiresManagerPin,
  type GateAction,
} from "../pos-rules";

beforeAll(() => {
  process.env["SETTINGS_ENCRYPTION_KEY"] ??= "test-key-for-manager-gate";
});

const actions = Object.keys(GATE_RULE_KEY) as GateAction[];

describe("manager gate rule mapping", () => {
  it("maps every gated action to a rule that exists", () => {
    for (const action of actions) {
      expect(DEFAULT_POS_RULES).toHaveProperty(GATE_RULE_KEY[action]);
    }
  });

  it("asks for a PIN only when the branch rule is on", () => {
    for (const action of actions) {
      const key = GATE_RULE_KEY[action];
      expect(requiresManagerPin(normalizeRules({ [key]: true }), action)).toBe(true);
      expect(requiresManagerPin(normalizeRules({ [key]: false }), action)).toBe(false);
    }
  });

  it("falls back to the shipped rules when a branch sends junk", () => {
    expect(normalizeRules(null)).toEqual(DEFAULT_POS_RULES);
    expect(normalizeRules({ require_pin_void_cart: "yes" }).require_pin_void_cart).toBe(
      DEFAULT_POS_RULES.require_pin_void_cart,
    );
  });
});

describe("override grants", () => {
  it("accepts a grant it just signed for the same action", async () => {
    const { signOverrideGrant, verifyOverrideGrant } = await import("../pos-rules.server");
    const token = signOverrideGrant({ action: "refund", approvedBy: "MGR1", role: "manager", storeId: "s1", binding: "sale:1" });
    const grant = verifyOverrideGrant(token, "refund");
    expect(grant?.approvedBy).toBe("MGR1");
  });

  it("refuses a grant issued for a different action", async () => {
    const { signOverrideGrant, verifyOverrideGrant } = await import("../pos-rules.server");
    const token = signOverrideGrant({ action: "refund", approvedBy: "MGR1", role: "manager", storeId: "s1", binding: "sale:1" });
    expect(verifyOverrideGrant(token, "void_cart")).toBeNull();
  });

  it("refuses a tampered or missing grant", async () => {
    const { signOverrideGrant, verifyOverrideGrant } = await import("../pos-rules.server");
    const token = signOverrideGrant({ action: "refund", approvedBy: "MGR1", role: "manager", storeId: "s1", binding: "sale:1" });
    const [body] = token.split(".");
    expect(verifyOverrideGrant(`${body}.deadbeef`, "refund")).toBeNull();
    expect(verifyOverrideGrant(undefined, "refund")).toBeNull();
    expect(verifyOverrideGrant("garbage", "refund")).toBeNull();
  });

  it("refuses an expired grant", async () => {
    const { verifyOverrideGrant } = await import("../pos-rules.server");
    const { createHmac, createHash } = await import("node:crypto");
    const secret = createHash("sha256")
      .update(process.env["SETTINGS_ENCRYPTION_KEY"]!, "utf8")
      .digest();
    const body = Buffer.from(
      JSON.stringify({ action: "refund", approvedBy: "MGR1", role: "manager", exp: Date.now() - 1 }),
      "utf8",
    ).toString("base64url");
    const sig = createHmac("sha256", secret).update(body).digest("base64url");
    expect(verifyOverrideGrant(`${body}.${sig}`, "refund")).toBeNull();
  });
});
