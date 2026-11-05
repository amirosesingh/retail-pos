import { describe, expect, it, vi } from "vitest";

const verifyRelayCaller = vi.fn();
vi.mock("@/core/api/pos-relay.server", () => ({ verifyRelayCaller }));

import { resolveRulesAccess } from "../pos-rules-access.server";

describe("who may read which branch's rules", () => {
  it("answers for the branch the proof carries, whatever was asked for", async () => {
    verifyRelayCaller.mockResolvedValue({ kind: "terminal", label: "t", storeId: "bandar" });
    const res = await resolveRulesAccess({ terminalToken: "abc", storeId: "" });
    expect(res).toMatchObject({ ok: true, branchId: "bandar" });
  });

  it("refuses a terminal that names another branch", async () => {
    verifyRelayCaller.mockResolvedValue({ kind: "terminal", label: "t", storeId: "bandar" });
    const res = await resolveRulesAccess({ terminalToken: "abc", storeId: "kajang" });
    expect(res).toMatchObject({ ok: false, status: 403, code: "FORBIDDEN" });
  });

  it("lets an unbound administrator ask for a named branch", async () => {
    verifyRelayCaller.mockResolvedValue({ kind: "staff", label: "a", storeId: null });
    const res = await resolveRulesAccess({ accessToken: "x".repeat(20), storeId: "kajang" });
    expect(res).toMatchObject({ ok: true, branchId: "kajang" });
  });

  it("refuses a caller that cannot prove who it is", async () => {
    verifyRelayCaller.mockImplementation(async () => {
      throw new Error("could not prove");
    });

    const res = await resolveRulesAccess({ storeId: "bandar" });
    expect(res).toMatchObject({ ok: false, status: 401, code: "IDENTITY" });
  });
  it("does not trust an arbitrary status field as a typed service outage", async () => {
    verifyRelayCaller.mockRejectedValue(Object.assign(new Error("Identity rejected"), { status: 503 }));
    expect(await resolveRulesAccess({ terminalToken: "abc" })).toMatchObject({ ok: false, status: 401, code: "IDENTITY" });
  });
});
