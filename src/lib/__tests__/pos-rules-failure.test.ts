import { describe, expect, it } from "vitest";

import { classifyRulesFailure, rulesRevision } from "../pos-rules.server";
import { DEFAULT_POS_RULES } from "../pos-rules";

describe("rules failure classification", () => {
  it("separates a stale key from a network outage", () => {
    expect(classifyRulesFailure("Invalid API key")).toBe("auth");
    expect(
      classifyRulesFailure("This till could not prove who it is — sign in again or re-activate it."),
    ).toBe("auth");
    expect(classifyRulesFailure("Your session has ended — please sign in again.")).toBe("auth");
    expect(classifyRulesFailure("fetch failed")).toBe("network");
  });

  it("names a missing configuration and a refused policy", () => {
    expect(classifyRulesFailure("POS service key is not configured")).toBe("config");
    expect(classifyRulesFailure("permission denied for table pos_settings")).toBe("permission");
  });

  it("flags a missing routine as a data problem, not a connection one", () => {
    expect(classifyRulesFailure('PGRST202: function pos_rules_get does not exist')).toBe("data");
  });
});

describe("rules revision stamp", () => {
  it("is stable for the same rules and changes when a rule changes", () => {
    const a = rulesRevision(DEFAULT_POS_RULES);
    const b = rulesRevision({ ...DEFAULT_POS_RULES });
    expect(a).toBe(b);
    const c = rulesRevision({
      ...DEFAULT_POS_RULES,
      max_cashier_discount_percent: 99,
    });
    expect(c).not.toBe(a);
  });
});
