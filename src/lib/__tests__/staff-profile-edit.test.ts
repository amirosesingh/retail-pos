import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const rest = vi.hoisted(() => vi.fn());
vi.mock("@/core/api/pos-relay.server", () => ({ serviceRest: rest, serviceKey: () => "test-key" }));
vi.mock("../external-supabase-config", () => ({ supabaseConfig: () => ({ url: "https://example.invalid" }) }));
import { updateStaffProfile } from "../staff-admin.server";
const profile = { user_id: "cashier", login_username: null, auth_user_id: "stable-auth-id", email: "cashier@pos-internal.local", pin_length: 4, is_active: true };
const input = { username: "cashier", loginUsername: "new-cashier", displayName: "Cashier", branchId: "branch-a", roleSlug: "cashier", baseRole: "staff" as const, active: true };
let auth: ReturnType<typeof vi.fn>;
beforeEach(() => {
 rest.mockReset();
 rest.mockImplementation(async (path: string) => path.startsWith("app_users?") ? Response.json([profile]) : path.endsWith("staff_login_available") ? Response.json(true) : new Response(""));
 auth = vi.fn().mockResolvedValue(new Response("{}")); vi.stubGlobal("fetch", auth);
});
afterEach(() => vi.unstubAllGlobals());
describe("staff profile identity preservation", () => {
 it("edits the label while retaining canonical identity and branch", async () => {
  await updateStaffProfile(input);
  const call = rest.mock.calls.find(([path]) => path === "rpc/staff_account_edit")!;
  expect(JSON.parse(call[1].body)).toMatchObject({ p_user_id: "cashier", p_login_username: "new-cashier", p_auth_user_id: "stable-auth-id", p_store_id: "branch-a", p_terminal_pin: null });
 });
 it("rejects duplicate names before changing authentication", async () => {
  rest.mockImplementation(async (path: string) => path.startsWith("app_users?") ? Response.json([profile]) : Response.json(false));
  await expect(updateStaffProfile(input)).rejects.toThrow("already in use"); expect(auth).not.toHaveBeenCalled();
 });
 it("does not replace the terminal PIN when adding email sign-in", async () => {
  await updateStaffProfile({ ...input, email: "staff@example.com", credential: "password-123" });
  const call = rest.mock.calls.find(([path]) => path === "rpc/staff_account_edit")!;
  expect(JSON.parse(call[1].body).p_terminal_pin).toBeNull();
  expect(JSON.parse(auth.mock.calls.at(-1)![1].body).password).toBe("password-123");
 });
 it("restores the previous Auth email when the database rejects an edit", async () => {
  rest.mockImplementation(async (path: string) => path.startsWith("app_users?") ? Response.json([profile]) : path.endsWith("staff_login_available") ? Response.json(true) : new Response("rejected", { status: 400 }));
  await expect(updateStaffProfile({ ...input, email: "staff@example.com", credential: "password-123" })).rejects.toThrow("rejected");
  expect(auth.mock.calls.map(([, init]) => JSON.parse(init.body))).toEqual([{ email: "staff@example.com" }, { email: profile.email }]);
 });
 it("rejects operator-entered internal addresses", async () => {
  await expect(updateStaffProfile({ ...input, email: "other@pos-internal.local" })).rejects.toThrow("real email"); expect(auth).not.toHaveBeenCalled();
 });
});
