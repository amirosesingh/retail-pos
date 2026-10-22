import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ verify: vi.fn(), resolve: vi.fn() }));
vi.mock("@/core/api/pos-relay.server", () => ({ verifyRelayCaller: mocks.verify }));
vi.mock("@/core/api/relay-policy.server", () => ({ resolveRelayScope: mocks.resolve }));
import { requireCallerScope } from "../privileged-caller.server";
beforeEach(() => { vi.resetAllMocks(); mocks.verify.mockResolvedValue({ kind: "staff" }); });
it("denies a supervisor whose sensitive permission is explicitly blocked", async () => {
  mocks.resolve.mockResolvedValue({ role: "manager", roleSlug: "supervisor", isSupervisor: true,
    permissions: { can_manage_staff: false } });
  await expect(requireCallerScope({}, { permission: "can_manage_staff" })).rejects.toThrow("permission");
});
it("fails closed for a missing action permission", async () => {
  mocks.resolve.mockResolvedValue({ role: "manager", isSupervisor: true, permissions: {} });
  await expect(requireCallerScope({}, { permission: "can_manage_staff" })).rejects.toThrow("permission");
});
it("allows a permitted user without granting supervisor status", async () => {
  mocks.resolve.mockResolvedValue({ role: "cashier", isSupervisor: false, permissions: { can_manage_staff: true } });
  await expect(requireCallerScope({}, { permission: "can_manage_staff" })).resolves.toMatchObject({ isSupervisor: false });
  await expect(requireCallerScope({}, { permission: "can_manage_staff", supervisor: true })).rejects.toThrow("Supervisor");
});
it("preserves the administrator recovery path", async () => {
  mocks.resolve.mockResolvedValue({ role: "admin", isSupervisor: true, permissions: {} });
  await expect(requireCallerScope({}, { permission: "can_manage_staff" })).resolves.toMatchObject({ role: "admin" });
});
it("rejects stale authority even for an administrator", async () => {
  mocks.resolve.mockResolvedValue({ role: "admin", isSupervisor: true, stale: true, permissions: {} });
  await expect(requireCallerScope({}, { permission: "can_manage_staff" })).rejects.toThrow("stale");
});
