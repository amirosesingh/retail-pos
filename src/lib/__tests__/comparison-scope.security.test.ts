import { beforeEach, describe, expect, it, vi } from "vitest";
const { verify, rest, cashier } = vi.hoisted(() => ({ verify: vi.fn(), rest: vi.fn(), cashier: vi.fn() }));
vi.mock("../secure-settings.server", () => ({ verifyPosStaff: verify }));
vi.mock("@/core/api/pos-relay.server", () => ({ serviceRest: rest }));
vi.mock("../pos-session.server", () => ({ verifyCashierSession: cashier }));
import { resolveCompareCaller } from "../data-compare-access.server";
beforeEach(() => { vi.resetAllMocks(); });
describe("comparison scope for distinct Auth and staff IDs", () => {
  it("uses the verified branch without looking up an Auth UUID as a staff code", async () => {
    verify.mockResolvedValue({ userId: "auth-uuid", isAdmin: false, storeId: "branch-a" });
    await expect(resolveCompareCaller({ accessToken: "valid", storeId: "branch-b" }))
      .resolves.toEqual({ ok: true, isAdmin: false, storeId: "branch-a" });
    expect(rest).not.toHaveBeenCalled();
  });
  it("denies a non-admin with missing branch rather than returning unrestricted scope", async () => {
    verify.mockResolvedValue({ userId: "auth-uuid", isAdmin: false, storeId: "" });
    expect((await resolveCompareCaller({ accessToken: "valid" })).ok).toBe(false);
  });
  it("keeps explicit administrator branch selection", async () => {
    verify.mockResolvedValue({ userId: "admin-uuid", isAdmin: true, storeId: "" });
    await expect(resolveCompareCaller({ accessToken: "valid", storeId: "branch-b" }))
      .resolves.toEqual({ ok: true, isAdmin: true, storeId: "branch-b" });
  });
  it.each([null, { store_id: "branch-b", is_active: true }, { store_id: "branch-a", is_active: false }])
    ("denies missing, inactive or differently assigned cashier accounts", async row => {
      cashier.mockResolvedValue({ username: "staff-code", storeId: "branch-a" });
      rest.mockResolvedValue({ ok: true, json: async () => row ? [row] : [] });
      expect((await resolveCompareCaller({ cashierToken: "valid" })).ok).toBe(false);
    });
});
