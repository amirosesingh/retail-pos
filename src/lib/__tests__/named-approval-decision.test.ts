import { beforeEach, expect, it, vi } from "vitest";
import { defaultRule, normalizeRule } from "../authorization";

const state = vi.hoisted(() => ({
  scope: {
    role: "cashier",
    roleSlug: "cashier",
    staffUserId: "chosen",
    label: "Chosen",
    storeId: "a",
    permissions: {} as Record<string, boolean>,
  },
  rule: {} as ReturnType<typeof defaultRule>,
  request: {} as Record<string, unknown>,
  decide: vi.fn(),
  save: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    validator: (parse: (v: unknown) => unknown) => ({
      handler: (fn: (v: { data: unknown }) => unknown) => (v: { data: unknown }) =>
        fn({ data: parse(v.data) }),
    }),
  }),
}));
vi.mock("@/core/api/pos-relay.server", () => ({
  verifyRelayCaller: async () => ({ kind: "staff" }),
}));
vi.mock("@/core/api/relay-policy.server", () => ({ resolveRelayScope: async () => state.scope }));
vi.mock("../authorization.server", () => ({
  getRequest: async () => state.request,
  loadRuleRows: async () => [state.rule],
  hasRequestAudit: async () => true,
  decideRequest: state.decide,
  saveRuleRow: state.save,
  writeLog: state.audit,
}));
vi.mock("../activity-events.server", () => ({ writeActivityEvent: vi.fn() }));
vi.mock("../record-edits.server", () => ({ releaseDecidedHold: vi.fn(async () => undefined) }));
import { decideAuthorizationRequest, saveAuthorizationRule } from "../authorization.functions";

const id = "11111111-1111-4111-8111-111111111111";
const sessionToken = "verified-session-token";
beforeEach(() => {
  vi.clearAllMocks();
  state.scope = {
    role: "cashier",
    roleSlug: "cashier",
    staffUserId: "chosen",
    label: "Chosen",
    storeId: "a",
    permissions: {
      can_approve_sponsorship: true,
      can_adjust_stock: true,
      can_archive_product: true,
    },
  };
  state.rule = {
    ...defaultRule("sponsorship"),
    allowedRoles: [],
    allowedUserIds: ["chosen"],
    mode: "request",
  };
  state.request = {
    id,
    actionKey: "sponsorship",
    requestedBy: "requester",
    storeId: "a",
    status: "pending",
    createdAt: new Date().toISOString(),
    requestedAmount: 10,
    payload: {},
    approvalRoute: {
      primaryApprovers: [{ id: "chosen" }],
      escalationAfterMinutes: null,
      escalationApprovers: [],
    },
  };
  state.decide.mockImplementation(async () => ({ ...state.request, status: "approved" }));
  state.audit.mockResolvedValue({ ok: true });
  state.save.mockImplementation(async (row: unknown) => normalizeRule(row));
});
const decide = (approve = true, approvedAmount?: number) =>
  decideAuthorizationRequest({ data: { sessionToken, id, approve, approvedAmount } });

it.each(["sponsorship", "stock_adjustment", "delete_product"] as const)(
  "allows a selected cashier to approve %s without a manager title",
  async (action) => {
    state.rule = { ...state.rule, actionKey: action };
    state.request.actionKey = action;
    expect(await decide()).toMatchObject({ ok: true });
    expect(state.decide).toHaveBeenCalledOnce();
    expect(state.audit).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "approved", authorizedBy: "chosen" }),
    );
  },
);
it.each(["sponsorship", "stock_adjustment", "delete_product"] as const)(
  "denies an unselected administrator even on a previously routed %s request",
  async (action) => {
    state.rule = { ...state.rule, actionKey: action };
    state.request.actionKey = action;
    state.scope.role = state.scope.roleSlug = "admin";
    state.scope.staffUserId = "not-selected";
    state.request.approvalRoute = {
      primaryApprovers: [{ id: "not-selected" }],
      escalationAfterMinutes: null,
      escalationApprovers: [],
    };
    expect(await decide()).toMatchObject({ ok: false });
    expect(state.decide).not.toHaveBeenCalled();
  },
);
it("denies a selected person whose action permission was revoked", async () => {
  state.scope.permissions.can_approve_sponsorship = false;
  expect(await decide()).toMatchObject({ ok: false, error: expect.stringMatching(/permission/) });
  expect(state.decide).not.toHaveBeenCalled();
});
it("rejects partial sponsorship approval and self approval without saving a decision", async () => {
  expect(await decide(true, 5)).toMatchObject({
    ok: false,
    error: expect.stringMatching(/complete/),
  });
  state.request.requestedBy = "chosen";
  expect(await decide()).toMatchObject({ ok: false, error: expect.stringMatching(/own request/) });
  expect(state.decide).not.toHaveBeenCalled();
});
it("allows the selected person to reject a request with an audit", async () => {
  expect(await decide(false)).toMatchObject({ ok: true });
  expect(state.audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: "rejected" }));
});
it("saves a named-only sponsorship rule without adding roles or escalation", async () => {
  state.scope.role = state.scope.roleSlug = "admin";
  const result = await saveAuthorizationRule({
    data: {
      sessionToken,
      actionKey: "sponsorship",
      scopeType: "global",
      mode: "request",
      allowedRoles: [],
      allowedUserIds: ["chosen"],
      requesterRoles: ["cashier"],
      requireReason: true,
      threshold: null,
    },
  });
  expect(result).toMatchObject({
    ok: true,
    rule: {
      allowedRoles: [],
      allowedUserIds: ["chosen"],
      escalationRoles: [],
      escalationAfterMinutes: null,
    },
  });
  expect(state.save).toHaveBeenCalledOnce();
});
