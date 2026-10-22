import { beforeEach, afterEach, expect, it, vi } from "vitest";
const rest = vi.hoisted(() => vi.fn());
vi.mock("@/core/api/pos-relay.server", () => ({ serviceRest: rest, serviceKey: () => "test-key" }));
vi.mock("../external-supabase-config", () => ({ supabaseConfig: () => ({ url: "https://example.invalid" }) }));
import { provisionStaffAccount, setStaffActive, updateStaffProfile, sendStaffConfirmation } from "../staff-admin.server";
let auth: ReturnType<typeof vi.fn>;
let saved: { user_id: string; auth_user_id: string; is_active: boolean; email: string; pin_length: number };
const create = { username: "cashier", displayName: "Cashier", roleSlug: "cashier", baseRole: "staff" as const, branchId: "branch-a", active: true, pin: "1234" };
const edit = { username: "cashier", displayName: "Cashier", roleSlug: "cashier", baseRole: "staff" as const, branchId: "branch-a", active: true };
beforeEach(() => {
  saved = { user_id: "cashier", auth_user_id: "auth-id", is_active: false, email: "cashier@pos-internal.local", pin_length: 4 };
  rest.mockReset();
  rest.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.startsWith("app_users?")) return Response.json([saved]);
    if (path === "rpc/staff_login_available") return Response.json(true);
    if (path === "rpc/staff_account_set_active") saved.is_active = JSON.parse(String(init?.body)).p_active;
    return new Response("");
  });
  auth = vi.fn().mockResolvedValue(Response.json({ id: "auth-id" }));
  vi.stubGlobal("fetch", auth);
});
afterEach(() => vi.unstubAllGlobals());
it.each([true, false])("creates a user with the requested active state %s", async active => {
  await provisionStaffAccount({ ...create, active });
  expect(saved.is_active).toBe(active);
  expect(rest.mock.calls.find(([p]) => p === "rpc/staff_account_upsert")?.[1].body).toContain(`"p_is_active":${active}`);
});
it.each([true, false])("edits a user and synchronizes cashier activation %s without resetting the PIN", async active => {
  await updateStaffProfile({ ...edit, active });
  expect(saved.is_active).toBe(active);
  const payload = JSON.parse(rest.mock.calls.find(([p]) => p === "rpc/staff_account_edit")![1].body);
  expect(payload).toMatchObject({ p_is_active: active, p_terminal_pin: null, p_store_id: "branch-a" });
  expect(JSON.parse(auth.mock.calls.at(-1)![1].body).user_metadata.active).toBe(active);
});
it("does not report successful activation if the database skipped the write", async () => {
  rest.mockImplementation(async (path: string) => path.startsWith("app_users?") ? Response.json([saved]) : new Response(""));
  await expect(setStaffActive("cashier", true)).rejects.toThrow("status was not saved");
  expect(auth).not.toHaveBeenCalled();
});
it("rejects a missing account instead of a successful no-op", async () => {
  rest.mockResolvedValue(Response.json([]));
  await expect(setStaffActive("missing", true)).rejects.toThrow("no authentication identity");
  expect(auth).not.toHaveBeenCalled();
});
it("surfaces an Auth status update failure", async () => {
  auth.mockResolvedValue(new Response("unavailable", { status: 503 }));
  await expect(setStaffActive("cashier", true)).rejects.toThrow("login status could not be updated");
});
it("finds an existing identity after other users on the first page", async () => {
  auth.mockImplementation(async (url: string, init: RequestInit) => {
    if (init.method === "POST") return new Response("exists", { status: 422 });
    if (new URL(url).searchParams.get("page") === "1") return Response.json({ users: Array.from({ length: 1000 }, (_, i) => ({ id: `other-${i}`, email: `other-${i}@example.test` })) });
    if (new URL(url).searchParams.get("page") === "2") return Response.json({ users: [{ id: "auth-id", email: "cashier@pos-internal.local" }] });
    return Response.json({ id: "auth-id" });
  });
  await expect(provisionStaffAccount(create)).resolves.toEqual({ userId: "auth-id" });
  expect(auth.mock.calls.some(([url]) => url.endsWith("admin/users/auth-id"))).toBe(true);
});
it("does not continue provisioning after an Auth repair failure", async () => {
  auth.mockImplementation(async (url: string, init: RequestInit) => url.includes("page=")
    ? Response.json({ users: [{ id: "auth-id", email: "cashier@pos-internal.local" }] })
    : new Response(init.method === "POST" ? "exists" : "unavailable", { status: 422 }));
  await expect(provisionStaffAccount(create)).rejects.toThrow("existing login account could not be updated");
  expect(rest).not.toHaveBeenCalled();
});
it("does not report successful creation when the role write fails", async () => {
  const normal = rest.getMockImplementation()!;
  rest.mockImplementation((path: string, init?: RequestInit) => path.startsWith("user_roles?")
    ? Promise.resolve(new Response("rejected", { status: 500 })) : normal(path, init));
  await expect(provisionStaffAccount(create)).rejects.toThrow("role could not be saved");
});


it("sends verification after saving a real-email account without changing its disabled state", async () => {
  saved.email = "cashier@example.test";
  auth.mockImplementation(async (url: string) => Response.json(url.endsWith("admin/users/auth-id")
    ? { id: "auth-id", email: saved.email, email_confirmed_at: null } : { id: "auth-id" }));
  const result = await provisionStaffAccount({ ...create, username: saved.email, password: "long-password", active: false });
  expect(result).toEqual({ userId: "auth-id" });
  expect(saved.is_active).toBe(false);
  expect(auth.mock.calls.find(([url]) => url.endsWith("/resend"))?.[1].body).toBe(JSON.stringify({ type: "signup", email: saved.email }));
});
it("reports mail failure separately after the staff account was saved", async () => {
  saved.email = "cashier@example.test";
  auth.mockImplementation(async (url: string) => url.endsWith("/resend")
    ? new Response("limited", { status: 429 })
    : Response.json({ id: "auth-id", email: saved.email, email_confirmed_at: null }));
  const result = await provisionStaffAccount({ ...create, username: saved.email, password: "long-password" });
  expect(result.emailWarning).toContain("Account saved");
  expect(saved.is_active).toBe(true);
});
it("never sends confirmation for an internal PIN account", async () => {
  await provisionStaffAccount(create);
  expect(auth.mock.calls.some(([url]) => url.endsWith("/resend"))).toBe(false);
});
it("resending cannot enable a disabled user or change their password", async () => {
  saved.email = "cashier@example.test";
  auth.mockResolvedValue(Response.json({ id: "auth-id", email: saved.email, email_confirmed_at: null }));
  await sendStaffConfirmation("cashier");
  expect(saved.is_active).toBe(false);
  expect(rest.mock.calls.every(([, init]) => !init?.method)).toBe(true);
  expect(auth.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(0);
});
it("refuses email for a mismatched authentication identity", async () => {
  saved.email = "cashier@example.test";
  auth.mockResolvedValue(Response.json({ id: "other", email: saved.email }));
  await expect(sendStaffConfirmation("cashier")).rejects.toThrow("administrator review");
  expect(auth.mock.calls.some(([url]) => url.endsWith("/resend"))).toBe(false);
});

it.each(['admin@example.com','cashier@pos-internal.local'])("disables %s without accepting or replacing credentials", async email => {
 saved.email=email;
 await setStaffActive('cashier',false);
 expect(saved.is_active).toBe(false);
 expect(rest.mock.calls.some(([path]) => path==='rpc/staff_account_edit' || path==='rpc/staff_account_upsert')).toBe(false);
 for(const [,init] of auth.mock.calls) {
  const payload=JSON.parse(init.body);
  expect(payload).not.toHaveProperty('password');
  expect(payload).not.toHaveProperty('pin');
 }
});
