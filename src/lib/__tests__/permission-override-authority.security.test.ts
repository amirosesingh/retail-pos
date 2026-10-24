import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ person: vi.fn(), scope: vi.fn(), pin: vi.fn(), log: vi.fn(), grant: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => ({ validator: (parse: (v: unknown) => unknown) => ({ handler: (fn: (v: { data: unknown }) => unknown) => (v: { data: unknown }) => fn({ data: parse(v.data) }) }) }) }));
vi.mock("../privileged-caller.server", () => ({ requireCallerScope: mocks.scope }));
vi.mock("../approval-token-server", () => ({ approvalPerson: mocks.person }));
vi.mock("../authorization.server", () => ({ verifyAuthorizationPin: mocks.pin, writeLog: mocks.log }));
vi.mock("../pos-rules.server", () => ({ signOverrideGrant: mocks.grant, verifyManagerPinInDb: vi.fn() }));
vi.mock("../pin-throttle.server", () => ({ throttleStatus: async () => ({ locked: false }), throttleReset: vi.fn(), throttleFail: vi.fn(), minutesLeft: () => 1 }));
vi.mock("../pin-request-throttle.server", () => ({ beginPinRequest: async () => ({ locked: false, key: null }), finishPinRequest: vi.fn() }));
import { verifyManagerPin } from "../pos-rules.functions";
const person = { user_id: "approver", role: "staff", role_slug: "cashier", store_id: "branch-a", is_active: true, permissions: { can_cancel_booking: true, approval_pin_enabled: true } };
const data = { cashierToken: "valid-cashier-proof", managerId: "approver", pin: "123456", action: "permission_override", permission: "can_cancel_booking", storeId: "forged-branch" };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.scope.mockResolvedValue({ storeId: "branch-a", staffUserId: "requester", actorName: "Requester" });
  mocks.person.mockResolvedValue(person);
  mocks.pin.mockResolvedValue({ userId: "approver", role: "staff", name: "Approver" });
  mocks.log.mockResolvedValue({ ok: true });
  mocks.grant.mockReturnValue("signed");
});
describe("assigned permission PIN overrides", () => {
  it("allows an assigned non-manager and binds the audit and grant to the verified caller branch", async () => {
    expect((await verifyManagerPin({ data })).ok).toBe(true);
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ requestedBy: "requester", storeId: "branch-a", detail: { permission: "can_cancel_booking" } }));
    expect(mocks.grant).toHaveBeenCalledWith(expect.objectContaining({ storeId: "branch-a" }));
  });
  it.each([
    { ...person, permissions: { can_cancel_booking: false } },
    { ...person, permissions: { can_cancel_booking: true, approval_pin_enabled: false } },
    { ...person, store_id: "branch-b" },
    { ...person, is_active: false },
    { ...person, store_id:null, permissions:{can_cancel_booking:true,approval_pin_enabled:true,"approval_scope:configured":true,"approval_scope:branch:branch-b":true} },
  ])("rejects unavailable authority before checking credentials", async candidate => {
    mocks.person.mockResolvedValue(candidate);
    expect((await verifyManagerPin({ data })).ok).toBe(false);
    expect(mocks.pin).not.toHaveBeenCalled();
    expect(mocks.grant).not.toHaveBeenCalled();
  });
  it("rejects a permission revoked while the PIN is being verified", async () => {
    mocks.person.mockResolvedValueOnce(person).mockResolvedValueOnce({ ...person, permissions: { can_cancel_booking: false } });
    expect((await verifyManagerPin({ data })).ok).toBe(false);
    expect(mocks.grant).not.toHaveBeenCalled();
  });
  it("requires a verified caller and a persisted approval audit", async () => {
    mocks.scope.mockRejectedValueOnce(new Error("Sign in required"));
    expect((await verifyManagerPin({ data })).ok).toBe(false);
    mocks.log.mockResolvedValue({ ok: false });
    expect((await verifyManagerPin({ data })).ok).toBe(false);
    expect(mocks.grant).not.toHaveBeenCalled();
  });
});
