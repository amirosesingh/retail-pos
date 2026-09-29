import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authorizationBinding } from "../authorization";
import { runAuthorizedMutation, signOverrideGrant } from "../pos-rules.server";

describe("authorization grant at the business mutation boundary", () => {
  beforeEach(() => {
    process.env["SETTINGS_ENCRYPTION_KEY"] = "integration-test-key";
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-28T10:00:00Z"));
  });

  afterEach(() => vi.useRealTimers());

  const payload = { sale_id: "sale-1", total: 25 };
  const binding = authorizationBinding(payload);

  async function mutate(token?: string | null) {
    let writes = 0;
    const value = await runAuthorizedMutation(
      { token, action: "refund", storeId: "branch-a", binding },
      () => ++writes,
    );
    return { value, writes };
  }

  it.each(["manager", "approval"])("allows the actual mutation after a %s grant", async (role) => {
    const token = signOverrideGrant({
      action: "refund",
      approvedBy: role === "approval" ? "request-approver" : "pin-manager",
      role,
      storeId: "branch-a",
      binding,
      ...(role === "approval" ? { requestId: "request-1" } : {}),
    });
    await expect(mutate(token)).resolves.toEqual({ value: 1, writes: 1 });
  });

  it.each([
    ["rejected or absent", null],
    ["tampered", "invalid.token"],
  ])("blocks the actual mutation for %s approval", async (_label, token) => {
    await expect(mutate(token)).rejects.toThrow("valid authorization grant");
  });

  it("blocks expired grants", async () => {
    const token = signOverrideGrant({
      action: "refund",
      approvedBy: "manager-1",
      role: "manager",
      storeId: "branch-a",
      binding,
    });
    vi.advanceTimersByTime(6 * 60_000);
    await expect(mutate(token)).rejects.toThrow("valid authorization grant");
  });

  it("blocks cross-branch and changed-payload bypass attempts", async () => {
    const token = signOverrideGrant({
      action: "refund",
      approvedBy: "manager-1",
      role: "manager",
      storeId: "branch-b",
      binding: authorizationBinding({ sale_id: "sale-2", total: 25 }),
    });
    await expect(mutate(token)).rejects.toThrow("valid authorization grant");
  });
});
