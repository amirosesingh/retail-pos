import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ native: true, fetch: vi.fn(), list: vi.fn(), permissions: vi.fn() }));
vi.mock("@/platform-config/platform", () => ({ isTerminalApp: () => mocks.native }));
vi.mock("../server-origin", () => ({ posFetch: mocks.fetch }));
vi.mock("../staff-admin.functions", () => ({
  listManagedStaffAccounts: mocks.list,
  setManagedStaffPermissions: mocks.permissions,
  saveStaffAccount: vi.fn(), setStaffAccountActive: vi.fn(), migrateCashiersToAccounts: vi.fn(),
  updateStaffAccount: vi.fn(), deleteStaffAccount: vi.fn(),
}));
import { listManagedStaffAccounts, setManagedStaffPermissions } from "../staff-admin-client";
import { handleStaffAdminRequest } from "../staff-admin-endpoint.server";
beforeEach(() => { vi.clearAllMocks(); mocks.native = true; });
it("sends native staff reads and permission saves with the unchanged person proof", async () => {
  mocks.fetch.mockImplementation(async () => Response.json({ ok: true, rows: [] }));
  const proof = { sessionToken: "person", terminalToken: "terminal" };
  await listManagedStaffAccounts({ data: proof });
  const save = { ...proof, userId: "cashier", permissions: { can_sell: true } };
  await setManagedStaffPermissions({ data: save });
  for (const [index, action, data] of [[0, "list", proof], [1, "permissions", save]] as const) {
    expect(mocks.fetch.mock.calls[index][0]).toBe("/api/v1/pos/sync?operation=staff_admin");
    expect(JSON.parse(mocks.fetch.mock.calls[index][1].body)).toEqual({ action, data });
  }
  expect(mocks.list).not.toHaveBeenCalled();
  expect(mocks.permissions).not.toHaveBeenCalled();
});
it("uses the same bounded JSON staff read on the website", async () => {
  mocks.native = false;
  mocks.fetch.mockResolvedValue(Response.json({ok: true, rows: []}));
  const input = { data: { sessionToken: "person" } };
  await listManagedStaffAccounts(input);
  expect(mocks.list).not.toHaveBeenCalled();
  expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toEqual({action: "list", data: input.data});
});
it("dispatches hosted list and permission actions to the existing guarded handlers", async () => {
  mocks.list.mockResolvedValue({ ok: false, rows: [], error: "Permission required" });
  mocks.permissions.mockResolvedValue({ ok: false, error: "Wrong branch" });
  for (const action of ["list", "permissions"]) {
    const response = await handleStaffAdminRequest(new Request("https://pos.example", {
      method: "POST", body: JSON.stringify({ action, data: { sessionToken: "proof" } }),
    }));
    expect((await response.json()).ok).toBe(false);
  }
  expect(mocks.list).toHaveBeenCalledWith({ data: { sessionToken: "proof" } });
  expect(mocks.permissions).toHaveBeenCalledWith({ data: { sessionToken: "proof" } });
});
