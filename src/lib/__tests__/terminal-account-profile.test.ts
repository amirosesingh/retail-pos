import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rest: vi.fn(), fetch: vi.fn(), profile: null as Record<string, unknown> | null }));
vi.mock("@/core/api/pos-relay.server", () => ({ serviceRest: mocks.rest, serviceKey: () => "sb_secret_test" }));
vi.mock("../external-supabase-config", () => ({ runtimeEnvValue: () => "unit-test-secret", supabaseConfig: () => ({ url: "https://unit.example" }) }));
import { ensureTerminalAccount } from "../terminal-account.server";
const token = "730746a4-4abe-4389-a155-b4c2d0da4834";
const proof = "a".repeat(64);
const profile = { user_id: `terminal.${token}`, auth_user_id: "auth-id", role: "staff", is_active: true, store_id: "branch-1" };
beforeEach(() => {
  vi.clearAllMocks(); mocks.profile = { ...profile };
  mocks.fetch.mockResolvedValue(Response.json({ id: "auth-id" }));
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.rest.mockImplementation(async (url: string, options?: RequestInit) => {
    if (options?.method === "PATCH") return Response.json([{ ...mocks.profile, is_active: true }]);
    if (url.startsWith("terminal_tokens?")) return Response.json([{ status: "active", location_id: "branch-1", claimed_at: "2026-10-19", claim_proof: proof }]);
    if (url.startsWith("app_users?email=")) return Response.json(mocks.profile ? [mocks.profile] : []);
    return Response.json([{}]);
  });
});
afterEach(() => vi.unstubAllGlobals());
it("reuses a verified legacy profile without an email conflict or username change", async () => {
  expect(await ensureTerminalAccount(token, proof)).toMatchObject({ email: `terminal.${token}@pos.local` });
  expect(mocks.rest.mock.calls.some(([url, options]) => url.startsWith("app_users?") && options?.method === "POST")).toBe(false);
});
it("uses the full terminal UUID for a new profile and handles email conflicts without overwriting", async () => {
  mocks.profile = null;
  await ensureTerminalAccount(token, proof);
  const write = mocks.rest.mock.calls.find(([url]) => url === "app_users?on_conflict=email");
  expect(JSON.parse(write![1].body)[0].user_id).toBe(`terminal-${token}`);
  expect(write![1].prefer).toContain("ignore-duplicates");
});
it.each([
  { is_active: false }, { auth_user_id: "other-user" }, { store_id: "other-branch" }, { role: "admin" },
])("refuses a disabled or mismatched profile without changing its permissions: %j", async patch => {
  mocks.profile = { ...profile, ...patch };
  mocks.fetch.mockImplementation(async (url: string, init?: RequestInit) => init?.method === "POST"
    ? new Response("exists", { status: 422 })
    : Response.json(url.includes("page=") ? { users: [{ id: "auth-id", email: `terminal.${token}@pos.local` }] } : { id: "auth-id" }));
  await expect(ensureTerminalAccount(token, proof)).rejects.toThrow(/inactive|administrator review/);
  expect(mocks.rest.mock.calls.some(([url, options]) => options?.method === "POST")).toBe(false);
});
it("rejects the wrong device proof before creating credentials or changing profiles", async () => {
  await expect(ensureTerminalAccount(token, "b".repeat(64))).rejects.toThrow("another device");
  expect(mocks.fetch).not.toHaveBeenCalled();
});

it("initializes only a newly-created machine profile disabled by the Auth trigger", async () => {
  mocks.profile = { ...profile, is_active: false };
  await expect(ensureTerminalAccount(token, proof)).resolves.toMatchObject({ email: `terminal.${token}@pos.local` });
  const patch = mocks.rest.mock.calls.find(([, options]) => options?.method === "PATCH");
  expect(patch?.[0]).toContain("auth_user_id=eq.auth-id");
  expect(patch?.[0]).toContain("is_active=eq.false");
  expect(JSON.parse(patch?.[1].body)).toEqual({ is_active: true });
});

it("finds an existing machine identity beyond the first Auth page", async () => {
  mocks.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") return new Response("exists", { status: 422 });
    if (url.includes("page=1&")) return Response.json({ users: Array.from({ length: 1000 }, (_, i) => ({ id: `other-${i}`, email: `other-${i}@pos.local` })) });
    if (url.includes("page=2&")) return Response.json({ users: [{ id: "auth-id", email: `terminal.${token}@pos.local` }] });
    return Response.json({ id: "auth-id" });
  });
  await expect(ensureTerminalAccount(token, proof)).resolves.toMatchObject({ email: `terminal.${token}@pos.local` });
  expect(mocks.fetch.mock.calls.some(([url]) => url.includes("page=2&"))).toBe(true);
});
