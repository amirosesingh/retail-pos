import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  scope: {
    storeId: null as string | null,
    role: "manager",
    roleSlug: "supervisor",
    isSupervisor: true,
    staffUserId: "approver",
    label: "Approver",
    permissions: {} as Record<string, boolean>,
    branchRestricted: false,
  },
  rows: [] as Record<string, unknown>[],
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
  serviceRest: vi.fn(),
}));
vi.mock("@/core/api/relay-policy.server", () => ({ resolveRelayScope: async () => state.scope }));
vi.mock("../authorization.server", () => ({
  expirePendingRequests: async () => [],
  listRequests: async () => state.rows,
  loadRuleRows: async () => [],
  writeLog: vi.fn(),
  decideRequest: vi.fn(),
  getRequest: async () => state.rows[0],
  hasRequestAudit: state.audit,
}));
import { listAuthorizationRequests, decideAuthorizationRequest } from "../authorization.functions";
import { withApprovalScope } from "../approval-branch-scope";
const request = (id: string, storeId: string, person = "approver") => ({
  id,
  storeId,
  status: "pending",
  actionKey: "refund",
  createdAt: new Date().toISOString(),
  requestedBy: "cashier",
  requestedAmount: 10,
  requesterDirectLimit: 0,
  approvalRoute: {
    primaryApprovers: [{ id: person }],
    escalationApprovers: [],
    escalationAfterMinutes: null,
  },
});
beforeEach(() => {
  state.scope.storeId = null;
  state.scope.permissions = {};
  state.scope.branchRestricted = false;
  state.rows = [
    request("11111111-1111-4111-8111-111111111111", "branch-a"),
    request("22222222-2222-4222-8222-222222222222", "branch-b"),
    request("33333333-3333-4333-8333-333333333333", "branch-a", "someone-else"),
  ];
  state.audit.mockClear();
});
describe("approval queue branch enforcement", () => {
  const load = (allBranches = false) =>
    listAuthorizationRequests({
      data: {
        sessionToken: "verified-person-session",
        storeId: "branch-a",
        allBranches,
        status: "pending",
        page: 1,
        pageSize: 25,
      },
    });
  it("lets an account without a home branch read its routed requests without treating the supplied branch as a grant", async () => {
    const result = await load();
    expect(result.ok).toBe(true);
    expect(result.requests.map((row) => row.id)).toEqual(
      state.rows.slice(0, 2).map((row) => row.id),
    );
    expect(await load(true)).toMatchObject({ ok: false });
  });
  it("applies a saved particular branch before returning routed requests", async () => {
    state.scope.permissions = withApprovalScope({}, "selected", "branch-b");
    const result = await load();
    expect(result.ok).toBe(true);
    expect(result.requests.map((row) => row.id)).toEqual([state.rows[1].id]);
  });
  it("requires an explicit all-branch grant and still excludes another person's route", async () => {
    state.scope.permissions = withApprovalScope({}, "all");
    const result = await load(true);
    expect(result.ok).toBe(true);
    expect(result.requests).toHaveLength(2);
  });
  it("keeps a registered till pinned even when all-branch approval scope is saved", async () => {
    state.scope.permissions = withApprovalScope({}, "all");
    state.scope.storeId = "branch-a";
    state.scope.branchRestricted = true;
    const result = await load();
    expect(result.ok).toBe(true);
    expect(result.requests).toHaveLength(1);
    expect(await load(true)).toMatchObject({ ok: false });
  });
  it("rejects a decision outside the saved scope before checking or writing any decision audit", async () => {
    state.scope.permissions = withApprovalScope({}, "selected", "branch-b");
    expect(
      await decideAuthorizationRequest({
        data: {
          sessionToken: "verified-person-session",
          id: String(state.rows[0].id),
          approve: true,
        },
      }),
    ).toMatchObject({ ok: false, error: "Cross-branch access is not allowed" });
    expect(state.audit).not.toHaveBeenCalled();
  });
});
