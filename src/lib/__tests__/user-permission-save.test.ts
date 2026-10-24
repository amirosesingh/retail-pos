import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rest: vi.fn(), scope: vi.fn(), verify: vi.fn(), audit: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => ({ validator: (parse: (value: unknown) => unknown) => ({ handler: (fn: (value: { data: unknown }) => unknown) => (input: { data: unknown }) => fn({ data: parse(input.data) }) }) }) }));
vi.mock("../privileged-caller.server", () => ({ requireCallerScope: mocks.scope }));
vi.mock("@/core/api/pos-relay.server", () => ({ serviceRest: mocks.rest, verifyRelayCaller: mocks.verify }));
vi.mock("../system-audit.server", () => ({ writeSystemAudit: mocks.audit }));
import { setManagedStaffPermissions } from "../staff-admin.functions";
import { readSessionPermissionsServer } from "../session-permissions.server";
import { normalizePermissions } from "../permissions";
import { managementDeviceAllowed } from "../management-device-access";
import { userRouteVisible } from "../ui-visibility";

beforeEach(() => { vi.clearAllMocks(); mocks.scope.mockResolvedValue({ role: "admin", staffUserId: "owner" }); mocks.verify.mockResolvedValue({ kind: "cashier", staffUserId: "staff-a", storeId: "branch-a" }); });
it("saves and rereads device/display grants and revocations through the guarded handlers", async () => {
  let stored: Record<string, boolean> = {};
  mocks.rest.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === "rpc/approval_token_state") {
      const input = JSON.parse(String(init?.body));
      expect(input.p_user_id).toBe("staff-a");
      stored = JSON.parse(input.p_secret);
      return Response.json(true);
    }
    return Response.json([{ user_id: "staff-a", full_name: "Staff", email: "staff@example.test", role: "staff", role_slug: "cashier", store_id: "branch-a", is_active: true, permissions: stored }]);
  });
  for (const enabled of [true, false]) {
    const result = await setManagedStaffPermissions({ data: { sessionToken: "owner-proof", userId: "staff-a", permissions: { can_use_management_pc: enabled, "display:route:/settings/tax": enabled } } });
    expect(result.ok).toBe(true);
    const refreshed = await readSessionPermissionsServer({ cashierToken: "staff-proof" });
    expect(refreshed.status).toBe("ok");
    if (refreshed.status !== "ok") throw new Error("Profile not refreshed");
    const permissions = normalizePermissions(refreshed.profile.permissions);
    expect(managementDeviceAllowed({ role: refreshed.profile.role, permissions }, false)).toBe(enabled);
    expect(userRouteVisible({}, "/settings/tax", "cashier", permissions)).toBe(enabled);
    expect(refreshed.profile.store_id).toBe("branch-a");
  }
  expect(mocks.scope).toHaveBeenCalledWith(expect.anything(), { permission: "can_manage_staff" });
  expect(mocks.audit).toHaveBeenCalledTimes(2);
});
it("refuses a permission save before persistence when the caller lacks staff authority", async () => {
  mocks.scope.mockRejectedValue(new Error("Permission required"));
  expect((await setManagedStaffPermissions({ data: { userId: "staff-a", permissions: { can_use_management_pc: true } } })).ok).toBe(false);
  expect(mocks.rest).not.toHaveBeenCalled();
});
