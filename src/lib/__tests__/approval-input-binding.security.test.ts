import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rules: vi.fn(), load: vi.fn(), pin: vi.fn(), log: vi.fn(), grant: vi.fn(), create: vi.fn(), people: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => ({ validator: (parse: (v: unknown) => unknown) => ({ handler: (fn: (v: { data: unknown }) => unknown) => (v: { data: unknown }) => fn({ data: parse(v.data) }) }) }) }));
vi.mock("@/core/api/pos-relay.server", () => ({ verifyRelayCaller: async () => ({ kind: "cashier" }) }));
vi.mock("@/core/api/relay-policy.server", () => ({ resolveRelayScope: async () => ({ kind: "cashier", role: "staff", roleSlug: "cashier", storeId: "branch-a", staffUserId: "requester", actorName: "Requester", permissions: {}, isSupervisor: false }) }));
vi.mock("../pos-rules.server", () => ({ loadRulesResult: mocks.rules, signOverrideGrant: mocks.grant }));
vi.mock("../authorization.server", () => ({ loadRuleRows: mocks.load, verifyAuthorizationPin: mocks.pin, writeLog: mocks.log,
  createRequest: mocks.create, listAuthorizationPeopleRows: mocks.people, hasRequestAudit: async () => true, markRequestNotified: vi.fn() }));
vi.mock("../pin-throttle.server", () => ({ throttleStatus: async () => ({ locked: false }), throttleReset: vi.fn(), throttleFail: vi.fn(), minutesLeft: () => 1 }));
vi.mock("../pin-request-throttle.server", () => ({ beginPinRequest: async () => ({ locked: false, key: "attempt" }), finishPinRequest: vi.fn() }));
vi.mock("../approval-token-server", () => ({ approvalPerson: async () => ({ is_active: true, permissions: {} }), verifyApprovalTotp: async () => null, identifyApprovalTotp: async () => null }));
import { authorizeWithPin, submitAuthorizationRequest } from "../authorization.functions";
import { defaultRule } from "../authorization";
beforeEach(() => {
  vi.resetAllMocks();
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
