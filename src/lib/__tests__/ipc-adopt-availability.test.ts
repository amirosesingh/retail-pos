import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ fetch: vi.fn(), touch: vi.fn(), registry: vi.fn(), scope: vi.fn(), authority: vi.fn(), auth: vi.fn() }));
vi.stubGlobal("fetch", h.fetch);
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: unknown) => ({ options }) }));
vi.mock("../external-supabase-config", () => ({ runtimeEnvValue: () => "fixture-service-key", supabaseConfig: () => ({ url: "https://pos.fixture", key: "fixture-public-key" }) }));
vi.mock("../session-guard.server", () => ({ touchSession: h.touch }));

import { Route } from "@/routes/api/v1/pos/ipc-adopt";
import { verifyRelayCaller } from "@/core/api/pos-relay.server";
import { resolveRelayScope } from "@/core/api/relay-policy.server";
import { databaseAuthority } from "../desktop-database-authority.server";
import { signCashierSession, verifyCashierSession } from "../pos-session.server";

const postHandler = (Route as unknown as { options: { server: { handlers: { POST: (input: { request: Request }) => Promise<Response> } } } }).options.server.handlers.POST;
const proof = "a".repeat(64);
const terminal = { id: "terminal-a", platform: "pc", status: "used", location_id: "A", is_claimed: true, claim_proof: proof, claimed_platform: "electron" };
const account = { user_id: "cashier", full_name: "Cashier", role: "staff", role_slug: "cashier", store_id: "A", is_active: true, permissions: { can_process_sale: true, can_manage_sync_backup: false } };
const session = { kind: "cashier", label: "Cashier", staff_user_id: "cashier", branch_id: "A", terminal_id: "terminal-a" };
const caller = { kind: "cashier" as const, label: "Cashier", staffUserId: "cashier", storeId: "A" };
const json = (value: unknown, status = 200) => Response.json(value, { status });
const post = (extra: Record<string, unknown> = {}) => postHandler({ request: new Request("https://pos.fixture/api/v1/pos/ipc-adopt", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ sessionToken: "session-proof", terminalToken: "terminal-a", deviceBindingProof: proof, ...extra }),
}) });
const denied = { ok: false, code: "EAUTH_DENIED", error: "Your sign-in could not be verified." };
const unavailable = { ok: false, code: "EAUTH_UNAVAILABLE", error: "Sign-in verification is temporarily unavailable. Please try again." };
const expectFailure = async (response: Response, status: number) => {
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual(status === 503 ? unavailable : denied);
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SETTINGS_ENCRYPTION_KEY", "isolated-fixture-signing-key");
  h.touch.mockResolvedValue({ ok: true, session: { ...session } });
  h.registry.mockImplementation(() => json([{ ...terminal }]));
  h.scope.mockImplementation(() => json([{ ...account }]));
  h.authority.mockImplementation(() => json([{ ...account }]));
  h.auth.mockImplementation(() => json({ id: "auth-user", email: "cashier@example.test" }));
  h.fetch.mockImplementation(async (url: string) => {
    if (url.includes("terminal_tokens?")) return h.registry();
    if (url.includes("app_users?")) return url.includes("full_name,") ? h.scope() : h.authority();
    if (url.endsWith("/auth/v1/user")) return h.auth();
    throw new Error("Unexpected fixture endpoint");
  });
});
afterAll(() => vi.unstubAllEnvs());

describe("actual IPC adoption verification pipeline", () => {
  it("adopts an active ordinary cashier without granting database maintenance or accepting renderer grants", async () => {
    const response = await post({ branchId: "B", permissions: { can_manage_sync_backup: true }, role: "admin" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, subject: "cashier", level: "staff", branchId: "A", accountScope: { branchId: "A" }, permissions: { can_process_sale: true, can_manage_sync_backup: false }, terminal: { id: "terminal-a", platform: "pc", mode: "operations", branchId: "A" } });
  });
  it("preserves authenticated browser/unpaired success with no invented terminal", async () => {
    const response = await post({ sessionToken: undefined, terminalToken: undefined, deviceBindingProof: undefined, accessToken: "auth-proof" });
    expect(response.status).toBe(200);expect(await response.json()).toMatchObject({ ok: true, terminal: null, branchId: "A" });
    expect(h.registry).not.toHaveBeenCalled();
  });
  it.each(["revoked", "wrong-proof", "other-request-token"])("keeps %s terminal refusal denied before account access", async kind => {
    if (kind === "revoked") h.registry.mockImplementation(() => json([{ ...terminal, revoked_at: "now" }]));
    await expectFailure(await post(kind === "wrong-proof" ? { deviceBindingProof: "b".repeat(64) } : kind === "other-request-token" ? { terminalToken: "terminal-b" } : {}), 401);
    expect(h.scope).not.toHaveBeenCalled();expect(h.authority).not.toHaveBeenCalled();
  });
  it("keeps terminal registry outage unavailable without leaking provider text", async () => {
    h.registry.mockImplementation(() => json({ message: "fixture-private-registry-detail" }, 503));
    await expectFailure(await post(), 503);expect(h.scope).not.toHaveBeenCalled();
  });
  it.each(["unknown", "revoked", "idle"])("retains %s raw-session denial", async reason => {
    h.touch.mockResolvedValue({ ok: false, reason });
    await expectFailure(await post({ terminalToken: undefined, deviceBindingProof: undefined }), 401);
    expect(h.authority).not.toHaveBeenCalled();
  });
  it("does not replace unavailable raw-session authority with an Auth fallback", async () => {
    h.touch.mockResolvedValue({ ok: false, reason: "unavailable" });
    await expectFailure(await post({ accessToken: "auth-proof" }), 503);expect(h.auth).not.toHaveBeenCalled();expect(h.authority).not.toHaveBeenCalled();
  });
  it("sanitizes a thrown raw-session read failure", async () => {
    h.touch.mockRejectedValue(new Error("fixture-private-session-read"));
    await expectFailure(await post(), 503);
  });
  it.each([401, 403])("keeps Auth HTTP%s denied", async status => {
    h.auth.mockImplementation(() => json({ message: "fixture-private-auth-detail" }, status));
    await expectFailure(await post({ sessionToken: undefined, accessToken: "auth-proof" }), 401);expect(h.authority).not.toHaveBeenCalled();
  });
  it.each([429, 500, 503, 504])("keeps Auth HTTP%s temporarily unavailable", async status => {
    h.auth.mockImplementation(() => json({ message: "fixture-private-auth-detail" }, status));
    await expectFailure(await post({ sessionToken: undefined, accessToken: "auth-proof" }), 503);
  });
  it("sanitizes Auth transport failure", async () => {
    h.auth.mockRejectedValue(new TypeError("fixture-private-fetch-endpoint"));
    await expectFailure(await post({ sessionToken: undefined, accessToken: "auth-proof" }), 503);
  });
  it.each([null, [], {}, { id: 7 }, { id: " " }, { id: "auth-user", email: 7 }])("rejects malformed successful Auth result %j as unavailable", async value => {
    h.auth.mockImplementation(() => json(value));
    await expectFailure(await post({ sessionToken: undefined, accessToken: "auth-proof" }), 503);
  });
  it("keeps unreadable Auth success unavailable", async () => {
    h.auth.mockImplementation(() => new Response("fixture-private-invalid-json"));
    await expectFailure(await post({ sessionToken: undefined, accessToken: "auth-proof" }), 503);
  });
  for (const stage of ["scope", "authority"] as const) {
    it(`${stage} HTTP outage stays unavailable`, async () => { h[stage].mockImplementation(() => json({ message: "fixture-private-sql-detail" }, 503));await expectFailure(await post(), 503); });
    it(`${stage} transport outage stays unavailable`, async () => { h[stage].mockRejectedValue(new Error("fixture-private-db-detail"));await expectFailure(await post(), 503); });
    it(`${stage} unreadable JSON stays unavailable`, async () => { h[stage].mockImplementation(() => new Response("fixture-private-invalid-json"));await expectFailure(await post(), 503); });
    it.each([{}, [null], [{ ...account, is_active: "true" }], [{ ...account, store_id: 1 }], [{ ...account, permissions: [] }], [account, account]])(`${stage} malformed staff data %j stays unavailable`, async value => {
      h[stage].mockImplementation(() => json(value));await expectFailure(await post(), 503);
    });
    it(`${stage} genuine inactive account remains denied`, async () => { h[stage].mockImplementation(() => json([{ ...account, is_active: false }]));await expectFailure(await post(), stage === "scope" ? 401 : 403); });
    it(`${stage} genuine empty lookup remains denied`, async () => { h[stage].mockImplementation(() => json([]));await expectFailure(await post(), stage === "scope" ? 401 : 403); });
  }
  it("keeps a real account/terminal branch mismatch denied", async () => {
    h.scope.mockImplementation(() => json([{ ...account, store_id: "B" }]));await expectFailure(await post(), 401);expect(h.authority).not.toHaveBeenCalled();
  });
  it("re-reads revocations instead of keeping completed strict authority", async () => {
    expect((await post()).status).toBe(200);h.scope.mockImplementation(() => json([{ ...account, is_active: false }]));await expectFailure(await post(), 401);
  });
  it("distinguishes signed cashier backing-session unavailability from a bad signature", async () => {
    const token = signCashierSession({ id: "cashier-id", username: "cashier", storeId: "A", sessionToken: "backing-session" });
    h.touch.mockResolvedValue({ ok: false, reason: "unavailable" });
    await expectFailure(await post({ sessionToken: undefined, cashierToken: token }), 503);expect(h.authority).not.toHaveBeenCalled();
    await expectFailure(await post({ sessionToken: undefined, terminalToken: undefined, cashierToken: "invalid.signature" }), 401);
  });
  it("adopts a genuine signed cashier through the same verified terminal and account checks", async () => {
    const token = signCashierSession({ id: "cashier-id", username: "cashier", storeId: "A", sessionToken: "backing-session" });
    expect((await post({ sessionToken: undefined, cashierToken: token })).status).toBe(200);
  });
  it("treats unavailable signed-verifier infrastructure as temporary without changing default denial", async () => {
    const token = signCashierSession({ id: "cashier-id", username: "cashier", storeId: "A", sessionToken: "backing-session" });
    vi.stubEnv("SETTINGS_ENCRYPTION_KEY", "");
    await expectFailure(await post({ sessionToken: undefined, cashierToken: token }), 503);
    expect(h.authority).not.toHaveBeenCalled();expect(h.touch).not.toHaveBeenCalled();
    await expect(verifyRelayCaller({ cashierToken: token })).rejects.toThrow("This till could not prove who it is");
  });
});

describe("strict availability is opt-in, not a relay policy change", () => {
  it("retains the legacy authority helper's non-OK null result", async () => {
    h.authority.mockImplementation(() => json({}, 503));await expect(databaseAuthority({ userId: "cashier" })).resolves.toBeNull();
  });
  it("retains the legacy scope denial for non-OK staff lookup", async () => {
    h.scope.mockImplementation(() => json({}, 503));await expect(resolveRelayScope(caller)).rejects.toThrow("Active staff account required");
  });
  it("does not coalesce a strict scope read into a non-strict unavailable-as-null lookup", async () => {
    h.scope.mockImplementation(() => json({}, 503));
    const result = await Promise.allSettled([resolveRelayScope(caller), resolveRelayScope(caller, { strictAvailability: true })]);
    expect(result[0].status).toBe("rejected");expect(result[1]).toMatchObject({ status: "rejected", reason: { status: 503 } });expect(h.scope).toHaveBeenCalledTimes(2);
  });
  it("retains default Auth fallback after an unavailable raw-session lookup", async () => {
    h.touch.mockResolvedValue({ ok: false, reason: "unavailable" });
    expect(await verifyRelayCaller({ sessionToken: "unavailable", accessToken: "auth-proof" })).toMatchObject({ kind: "staff", authUserId: "auth-user" });
  });
  it("retains default terminal identity after Auth HTTP outage", async () => {
    h.auth.mockImplementation(() => json({}, 503));
    expect(await verifyRelayCaller({ terminalToken: "terminal-a", deviceBindingProof: proof, accessToken: "auth-proof" })).toMatchObject({ kind: "terminal", terminalId: "terminal-a" });
  });
  it("retains default signed-cashier null on unavailable backing session", async () => {
    const token = signCashierSession({ id: "cashier-id", username: "cashier", storeId: "A", sessionToken: "backing-session" });
    h.touch.mockResolvedValue({ ok: false, reason: "unavailable" });await expect(verifyCashierSession(token)).resolves.toBeNull();
  });
});
