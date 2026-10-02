import { afterEach, describe, expect, it, vi } from "vitest";

import { logRules } from "../pos-rules-log";

describe("POS rules logging", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does not log routine successful settings synchronization", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    logRules("POS_RULES_SYNC_STARTED", { branch_id: "branch-1" });
    logRules("POS_RULES_SYNC_SUCCESS", { branch_id: "branch-1", revision: "2" });

    expect(info).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps actual synchronization failures visible", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    logRules("POS_RULES_LOAD_FAILED", { branch_id: "branch-1", category: "network" });

    expect(warn).toHaveBeenCalledOnce();
  });

  it("does not warn while the sign-in screen has no terminal identity", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    logRules("POS_RULES_LOAD_FAILED", { branch_id: "branch-1", category: "none" });
    expect(warn).not.toHaveBeenCalled();
  });
});
