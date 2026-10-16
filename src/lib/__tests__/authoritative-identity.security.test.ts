import { beforeEach, describe, expect, it, vi } from "vitest";
const { rest, verify, start, writeHistory, writeActivity } = vi.hoisted(() => ({
  rest: vi.fn(),
  verify: vi.fn(),
  start: vi.fn(),
  writeHistory: vi.fn(),
  writeActivity: vi.fn(),
}));
vi.mock("@/core/api/pos-relay.server", () => ({ serviceRest: rest, verifyRelayCaller: verify }));
vi.mock("../session-guard.server", () => ({ startSession: start }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => ({
    validator: (parse: (v: unknown) => unknown) => ({
      handler: (fn: (v: { data: unknown }) => unknown) => (v: { data: unknown }) =>
        fn({ data: parse(v.data) }),
    }),
  }),
}));
vi.mock("../status-history.server", () => ({ writeStatusHistory: writeHistory }));
vi.mock("../activity-events.server", () => ({ writeActivityEvent: writeActivity }));
import { recordStatusHistory } from "../status-history.functions";
import { pushActivityEvent } from "../activity-events.functions";
import { resolveRelayScope } from "@/core/api/relay-policy.server";
import { claimsFromPayload } from "@/core/api/relay-claims.server";
import { startDeviceSession } from "../user-sessions.functions";
import { auditReadBranch } from "../audit-read-scope.server";
import { throttleStatus } from "../pin-throttle.server";
const active = {
  user_id: "cashier",
  full_name: "Cashier",
  role: "staff",
  role_slug: "cashier",
  store_id: "branch-a",
  is_active: true,
  permissions: { can_receive_transfer: true },
};
let sequence = 0;
beforeEach(() => {
  vi.resetAllMocks();
  sequence++;
  rest.mockResolvedValue({ ok: true, json: async () => [active] });
  verify.mockResolvedValue({ kind: "staff", label: "cashier", authUserId: `auth-${sequence}` });
  start.mockResolvedValue({ token: "new-session", idleMinutes: 30 });
  writeHistory.mockResolvedValue({ ok: true });
  writeActivity.mockResolvedValue({ ok: true });
});
describe("authoritative identity boundaries", () => {
  it("ignores editable metadata and loads current account despite administrative claims", async () => {
    expect(
      claimsFromPayload({
        user_metadata: { role: "admin", permissions: { can_manage_staff: true } },
      }),
    ).toBeNull();
    const scope = await resolveRelayScope({
      kind: "staff",
      label: "cashier",
      authUserId: `metadata-${sequence}`,
      claims: {
        storeId: "branch-b",
        role: "admin",
        roleSlug: "admin",
        staffUserId: "admin",
        actorName: "Admin",
        permissions: { can_manage_staff: true },
      },
    });
    expect(scope.role).toBe("staff");
    expect(scope.storeId).toBe("branch-a");
    expect(scope.isSupervisor).toBe(false);
    expect(rest.mock.calls[0][0]).toContain(`auth_user_id=eq.metadata-${sequence}`);
  });
  it("does not fall back to another subject for missing or inactive Auth accounts", async () => {
    rest.mockResolvedValue({ ok: true, json: async () => [] });
    await expect(
      resolveRelayScope({
        kind: "staff",
        label: "admin",
        authUserId: `missing-${sequence}`,
        staffUserId: "admin",
        email: "admin@example.invalid",
      }),
    ).rejects.toThrow("Active staff");
    expect(rest).toHaveBeenCalledTimes(1);
    rest.mockResolvedValue({ ok: true, json: async () => [{ ...active, is_active: false }] });
    await expect(
      resolveRelayScope({ kind: "staff", label: "cashier", authUserId: `inactive-${sequence}` }),
    ).rejects.toThrow("Active staff");
  });
  it("rejects a terminal branch mismatch but preserves an all-branch account's verified terminal", async () => {
    await expect(
      resolveRelayScope({
        kind: "cashier",
        label: "cashier",
        staffUserId: `fixed-${sequence}`,
        storeId: "branch-b",
      }),
    ).rejects.toThrow("different branch");
    rest.mockResolvedValue({ ok: true, json: async () => [{ ...active, store_id: null }] });
    expect(
      (
        await resolveRelayScope({
          kind: "cashier",
          label: "cashier",
          staffUserId: `all-${sequence}`,
          storeId: "branch-b",
        })
      ).storeId,
    ).toBe("branch-b");
  });
  it("mints only the proven identity even when the body names an administrator", async () => {
    const result = await startDeviceSession({
      data: {
        accessToken: "valid",
        kind: "cashier",
        staffUserId: "admin",
        label: "Admin",
        branchId: "branch-b",
        terminalId: "forged",
        platform: "web",
      },
    });
    expect(result.ok).toBe(true);
    expect(start).toHaveBeenCalledWith({
      kind: "staff",
      label: "Cashier",
      staffUserId: "cashier",
      cashierId: null,
      branchId: "branch-a",
      terminalId: null,
      platform: "web",
    });
  });
  it("keeps module history visible in its branch while denying unrestricted audit reads", async () => {
    expect(await auditReadBranch({ accessToken: "valid" }, "stock_transfer")).toBe("branch-a");
    await expect(auditReadBranch({ accessToken: "valid" })).rejects.toThrow("Audit-trail");
  });
  it("stamps verified reporters and distinguishes client reports from proven actions", async () => {
    await recordStatusHistory({
      data: {
        accessToken: "valid",
        transitions: [
          {
            entityType: "sale",
            entityId: "record",
            newStatus: "reported",
            actorId: "admin",
            actorName: "Admin",
            actorRole: "admin",
            metadata: { client_reported: false },
          },
        ],
      },
    });
    expect(writeHistory).toHaveBeenCalledWith([
      expect.objectContaining({
        actor_id: "cashier",
        actor_name: "Cashier",
        actor_role: "staff",
        metadata: { client_reported: true },
      }),
    ]);
    await pushActivityEvent({
      data: {
        accessToken: "valid",
        type: "sale",
        title: "Claimed refund",
        actorId: "admin",
        actorName: "Admin",
        actorRole: "admin",
        meta: { client_reported: false },
      },
    });
    expect(writeActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        actor_id: "cashier",
        actor_name: "Cashier",
        actor_role: "staff",
        title: "Reported activity: Claimed refund",
        meta: { client_reported: true },
      }),
    );
  });
  it("fails closed when the central throttle cannot be read", async () => {
    rest.mockResolvedValue({ ok: false });
    await expect(throttleStatus("cashier:test")).rejects.toThrow("unavailable");
  });
});
