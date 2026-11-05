import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rules: vi.fn(), load: vi.fn(), pin: vi.fn(), log: vi.fn(), grant: vi.fn(), verifyGrant: vi.fn(), create: vi.fn(), people: vi.fn(), person: vi.fn(), scope: vi.fn(), request: vi.fn(), decide: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => ({ validator: (parse: (v: unknown) => unknown) => ({ handler: (fn: (v: { data: unknown }) => unknown) => (v: { data: unknown }) => fn({ data: parse(v.data) }) }) }) }));
vi.mock("@/core/api/pos-relay.server", () => ({ verifyRelayCaller: async () => ({ kind: "cashier" }) }));
vi.mock("@/core/api/relay-policy.server", () => ({ resolveRelayScope: mocks.scope }));
vi.mock("../pos-rules.server", () => ({ loadRulesResult: mocks.rules, signOverrideGrant: mocks.grant, verifyOverrideGrant: mocks.verifyGrant }));
vi.mock("../authorization.server", () => ({ loadRuleRows: mocks.load, verifyAuthorizationPin: mocks.pin, writeLog: mocks.log,
  createRequest: mocks.create, getRequest: mocks.request, decideRequest: mocks.decide, listAuthorizationPeopleRows: mocks.people, hasRequestAudit: async () => true, markRequestNotified: vi.fn() }));
vi.mock("../pin-throttle.server", () => ({ throttleStatus: async () => ({ locked: false }), throttleReset: vi.fn(), throttleFail: vi.fn(), minutesLeft: () => 1 }));
vi.mock("../pin-request-throttle.server", () => ({ beginPinRequest: async () => ({ locked: false, key: "attempt" }), finishPinRequest: vi.fn() }));
vi.mock("../approval-token-server", () => ({ approvalPerson: mocks.person, verifyApprovalTotp: async () => null, identifyApprovalTotp: async () => null }));
import { authorizeWithPin, submitAuthorizationRequest, decideAuthorizationRequest, verifyBusinessAuthorization } from "../authorization.functions";
import { approvalForAction, defaultRule, normalizeRequest } from "../authorization";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.scope.mockResolvedValue({ kind: "cashier", role: "staff", roleSlug: "cashier", storeId: "branch-a", staffUserId: "requester", actorName: "Requester", permissions: {}, isSupervisor: false });
  mocks.person.mockResolvedValue({ user_id: "approver", role: "manager", role_slug: "supervisor", store_id: "branch-a", is_active: true, permissions: { can_give_discount: true } });
  mocks.rules.mockResolvedValue({ source: "database", rules: { max_cashier_discount_percent: 10 } });
  mocks.load.mockResolvedValue([ { ...defaultRule("manual_discount"), isEnabled: true, mode: "either", allowedRoles: ["manager"], requesterRoles: ["cashier"], extraAuthority: { "role:manager": 5 } } ]);
  mocks.pin.mockResolvedValue({ userId: "approver", role: "manager", name: "Manager" });
  mocks.log.mockResolvedValue({ ok: true });
  mocks.grant.mockReturnValue("signed-grant");
  mocks.people.mockResolvedValue([{ id: "approver", role: "manager", name: "Manager", storeId: "branch-a" }]);
  mocks.create.mockImplementation(async input => ({ created: false, request: input }));
});
const input = { cashierToken: "valid-cashier-proof", actionKey: "manual_discount", authorizerId: "approver", pin: "1234", binding: "ticket-binding", requesterDirectLimit: 999, storeId: "branch-a", valueUnit: "percent" as const };
describe("server-derived requester direct approval limit", () => {
  it("allows an amountless cart approval after an unrelated numeric discount approval", async () => {
    const discount = { actionKey: "discount_over_limit", requestedAmount: 15, approvedAmount: 15 };
    const resumedGrant = approvalForAction("void_cart", discount);
    mocks.load.mockResolvedValue([{ ...defaultRule("void_cart"), mode: "pin", isEnabled: true, allowedRoles: ["manager"] }]);
    mocks.verifyGrant.mockReturnValue({ approvedBy: "approver", approvedAmount: null });
    const result = await verifyBusinessAuthorization({ data: { ...input, actionKey: "void_cart", payload: {},
      requestedAmount: resumedGrant?.requestedAmount ?? resumedGrant?.approvedAmount ?? null, grantToken: "void-grant" } });
    expect(result).toMatchObject({ ok: true, required: true });
    expect(approvalForAction("discount_over_limit", discount)).toBe(discount);
  });
  it.each([null, undefined])("does not mint a numeric grant with missing requested value %s", async requestedAmount => {
    expect((await authorizeWithPin({ data: { ...input, requestedAmount } })).ok).toBe(false);
    expect(mocks.grant).not.toHaveBeenCalled();
  });
  it.each([null, undefined, -1, NaN])("does not accept an old numeric grant with invalid approved value %s", async approvedAmount => {
    mocks.verifyGrant.mockReturnValue({ approvedBy: "approver", approvedAmount });
    expect((await verifyBusinessAuthorization({ data: { ...input, requestedAmount: 15, payload: {}, grantToken: "old-grant" } })).ok).toBe(false);
  });
  it.each([15, 16])("accepts a numeric grant covering value 15 with ceiling %s", async approvedAmount => {
    mocks.verifyGrant.mockReturnValue({ approvedBy: "approver", approvedAmount });
    expect((await verifyBusinessAuthorization({ data: { ...input, requestedAmount: 15, payload: {}, grantToken: "grant" } })).ok).toBe(true);
  });
  it("rejects an above-ceiling numeric grant and preserves disabled rules", async () => {
    mocks.verifyGrant.mockReturnValue({ approvedBy: "approver", approvedAmount: 14 });
    expect((await verifyBusinessAuthorization({ data: { ...input, requestedAmount: 15, payload: {}, grantToken: "grant" } })).ok).toBe(false);
    mocks.load.mockResolvedValue([{ ...defaultRule("manual_discount"), mode: "none", isEnabled: true }]);
    expect((await verifyBusinessAuthorization({ data: { ...input, requestedAmount: null, payload: {} } })).ok).toBe(true);
  });
  it("rejects a valid approval PIN outside the person's saved approval branch selection",async()=>{
    mocks.person.mockResolvedValue({user_id:"approver",role:"manager",role_slug:"supervisor",store_id:null,is_active:true,permissions:{can_give_discount:true,"approval_scope:configured":true,"approval_scope:branch:branch-b":true}});
    expect((await authorizeWithPin({data:{...input,requestedAmount:15}})).ok).toBe(false);
    expect(mocks.grant).not.toHaveBeenCalled();
  });
  it("rejects a valid PIN when the current approver lacks the action permission", async () => {
    mocks.person.mockResolvedValue({ user_id: "approver", role: "manager", role_slug: "supervisor", store_id: "branch-a", is_active: true, permissions: { can_give_discount: false } });
    expect((await authorizeWithPin({ data: { ...input, requestedAmount: 15 } })).ok).toBe(false);
    expect(mocks.grant).not.toHaveBeenCalled();
  });
  it("does not let a valid PIN cross the approver's branch assignment", async () => {
    mocks.person.mockResolvedValue({ user_id: "approver", role: "manager", role_slug: "supervisor", store_id: "branch-b", is_active: true, permissions: { can_give_discount: true } });
    expect((await authorizeWithPin({ data: { ...input, requestedAmount: 15 } })).ok).toBe(false);
    expect(mocks.grant).not.toHaveBeenCalled();
  });
  it("rechecks assigned permission when a queued request is decided, including escalation", async () => {
    mocks.scope.mockResolvedValue({ kind: "cashier", role: "manager", roleSlug: "supervisor", storeId: "branch-a", staffUserId: "approver", actorName: "Approver", permissions: { can_give_discount: false }, isSupervisor: true });
    const id = "11111111-1111-4111-8111-111111111111";
    mocks.request.mockResolvedValue(normalizeRequest({ id, action_key: "manual_discount", requested_by: "requester", store_id: "branch-a", payload: {}, status: "pending", created_at: new Date(Date.now() - 120_000).toISOString(), requested_amount: 15 }));
    expect((await decideAuthorizationRequest({ data: { cashierToken: "valid-cashier-proof", id, approve: true } })).ok).toBe(false);
    expect(mocks.decide).not.toHaveBeenCalled();
  });
  it("denies an inflated baseline even with a correct approver PIN", async () => {
    const result = await authorizeWithPin({ data: { ...input, requestedAmount: 16 } });
    expect(result.ok).toBe(false);
    expect(mocks.pin).toHaveBeenCalled();
    expect(mocks.grant).not.toHaveBeenCalled();
  });
  it("keeps the configured direct limit plus relative allowance working", async () => {
    expect((await authorizeWithPin({ data: { ...input, requesterDirectLimit: 0, requestedAmount: 15 } })).ok).toBe(true);
    expect(mocks.grant).toHaveBeenCalledWith(expect.objectContaining({ approvedAmount: 15 }));
  });
  it("does not issue a grant using unverified fallback rules", async () => {
    mocks.rules.mockResolvedValue({ source: "defaults", rules: { max_cashier_discount_percent: 999 } });
    expect((await authorizeWithPin({ data: { ...input, requestedAmount: 15 } })).ok).toBe(false);
    expect(mocks.grant).not.toHaveBeenCalled();
  });
  it("persists a trusted baseline for queued approvals", async () => {
    const result = await submitAuthorizationRequest({ data: { ...input, requestId: "11111111-1111-4111-8111-111111111111", reason: "Needs approval", payload: {}, requestedAmount: 15 } });
    expect(result.ok).toBe(true);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ requesterDirectLimit: 10 }));
  });
});
