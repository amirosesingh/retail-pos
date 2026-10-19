import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ scope: vi.fn(), rest: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => ({
  validator: (parse: (data: unknown) => unknown) => ({ handler: (handle: (input: { data: unknown }) => unknown) =>
    (input: { data: unknown }) => handle({ data: parse(input.data) }) }),
}) }));
vi.mock("../privileged-caller.server", () => ({ requireCallerScope: mocks.scope }));
vi.mock("@/core/api/pos-relay.server", () => ({ serviceRest: mocks.rest }));
vi.mock("../staff-admin.server", () => ({ staffLastSignIns: async () => new Map([["auth-admin", "2026-10-19T08:00:00Z"]]) }));
import { listManagedStaffAccounts } from "../staff-admin.functions";
const person = {
  id: "person", auth_user_id: null, user_id: "cashier", full_name: "Cashier", email: "cashier@example.test",
  role: "staff", role_slug: "cashier", store_id: "branch-a", is_active: true, permissions: { can_sell: true },
  pin_length: 6, pin_set_at: null, last_login_at: null, created_at: null,
};
beforeEach(() => { vi.clearAllMocks(); mocks.scope.mockResolvedValue({ roleSlug: "admin", staffUserId: "manager" }); });
it("loads staff with nullable schema metadata without exposing credential fields", async () => {
  mocks.rest.mockImplementation(async (path: string) => Response.json(path.startsWith("app_users?")
    ? [{ ...person, pin_hash: "must-not-leak", auth_secret: "must-not-leak" }] : []));
  const proof = { accessToken: "staff-access", sessionToken: "person-session" };
  const result = await listManagedStaffAccounts({ data: proof });
  expect(result.ok).toBe(true);
  expect(result.rows[0]).toMatchObject(person);
  expect(result.rows[0]).not.toHaveProperty("pin_hash");
  expect(result.rows[0]).not.toHaveProperty("auth_secret");
  expect(mocks.scope).toHaveBeenCalledWith(proof, { permission: "can_manage_staff" });
  expect(mocks.rest.mock.calls[0][0]).not.toContain("pin_hash");
});
it("does not read staff data when person or permission verification fails", async () => {
  mocks.scope.mockRejectedValue(new Error("Your session has ended — please sign in again."));
  const result = await listManagedStaffAccounts({ data: { accessToken: "expired" } });
  expect(result).toMatchObject({ ok: false, rows: [], error: expect.stringContaining("sign in again") });
  expect(mocks.rest).not.toHaveBeenCalled();
});
it("reports a failed central read rather than treating it as an empty staff list", async () => {
  mocks.rest.mockResolvedValue(new Response("unavailable", { status: 503 }));
  const result = await listManagedStaffAccounts({ data: { sessionToken: "person" } });
  expect(result).toMatchObject({ ok: false, rows: [], error: "Staff accounts could not be loaded." });
});

it("uses the latest Auth sign-in for linked administrators", async () => {
  mocks.rest.mockImplementation(async (path: string) => Response.json(path.startsWith("app_users?") ? [{ ...person, auth_user_id: "AUTH-ADMIN", last_login_at: "2026-10-18T08:00:00Z" }] : []));
  const result = await listManagedStaffAccounts({ data: { accessToken: "staff-access" } });
  expect(result.rows[0].last_login_at).toBe("2026-10-19T08:00:00Z");
});
