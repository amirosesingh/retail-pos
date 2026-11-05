import { beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ bridge: null as Record<string, unknown> | null, terminal: null as { tokenId: string } | null, save: vi.fn(), legacy: vi.fn() }));
vi.mock("@/core/local-db/local-db", () => ({ localDb: () => fixture.bridge }));
vi.mock("@/core/activation/terminal-tokens", () => ({ readTerminalConfig: () => fixture.terminal }));
import { authorizeOfflineDiscount, hasNativeOfflineDiscountCapability } from "@/core/local-db/local-staff";
const request = { requestId: "00000000-0000-4000-8000-000000000001", actionKey: "discount_over_limit" as const, branchId: "branch", username: "manager", credential: "123456", reason: "", snapshot: {}, payload: {}, requestedAmount: 20 };
describe("dedicated native approval transport", () => {
  beforeEach(() => { fixture.save.mockReset().mockResolvedValue({ ok: true }); fixture.legacy.mockReset(); fixture.terminal = { tokenId: "REGISTERED-TERMINAL" }; fixture.bridge = { authorizeOfflineDiscount: fixture.save, verifyApprovalPin: fixture.legacy }; });
  it("uses the existing registered terminal identity and forwards the complete snapshot", async () => {
    expect(hasNativeOfflineDiscountCapability()).toBe(true); await expect(authorizeOfflineDiscount(request)).resolves.toMatchObject({ ok: true });
    expect(fixture.save).toHaveBeenCalledWith({ ...request, registeredTerminalId: "REGISTERED-TERMINAL" }); expect(fixture.legacy).not.toHaveBeenCalled();
  });
  it.each(["absent", "old bridge"])("does not claim native capability for %s", async kind => {
    fixture.bridge = kind === "absent" ? null : { verifyApprovalPin: fixture.legacy }; expect(hasNativeOfflineDiscountCapability()).toBe(false); await expect(authorizeOfflineDiscount(request)).resolves.toMatchObject({ ok: false }); expect(fixture.save).not.toHaveBeenCalled();
  });
  it("a transport failure returns a truthful unpaid status without retrying through the old verifier", async () => {
    fixture.save.mockRejectedValueOnce(Error("Fixture IPC disconnected")); await expect(authorizeOfflineDiscount(request)).resolves.toMatchObject({ ok: false, code: "EAPPROVAL_UNAVAILABLE" }); expect(fixture.save).toHaveBeenCalledOnce(); expect(fixture.legacy).not.toHaveBeenCalled();
  });
  it("a real native denial does not fall back", async () => {
    fixture.save.mockResolvedValueOnce({ ok: false, code: "EPRIVILEGE" }); await expect(authorizeOfflineDiscount(request)).resolves.toEqual({ ok: false, code: "EPRIVILEGE" }); expect(fixture.legacy).not.toHaveBeenCalled();
  });
  it("missing saved registration cannot submit a native audit", async () => {
    fixture.terminal = null; await expect(authorizeOfflineDiscount(request)).resolves.toMatchObject({ ok: false }); expect(fixture.save).not.toHaveBeenCalled();
  });
});
