import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  mayManage: true,
  boundSession: false,
  registryStatus: 200,
  load: vi.fn(),
  save: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: unknown) => ({ options }) }));
// Keep the real validator and handler linked, without a framework transport.
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => ({
  validator: (validate: (data: unknown) => unknown) => ({
    handler: (handle: (input: { data: unknown }) => unknown) =>
      (input: { data: unknown }) => handle({ data: validate(input.data) }),
  }),
}) }));
vi.mock("@/lib/external-supabase-config", () => ({
  runtimeEnvValue: () => "isolated-service-key",
  supabaseConfig: () => ({ url: "https://rules.test", key: "isolated-public-key" }),
}));
vi.mock("@/core/api/relay-policy.server", () => ({
  canCrossBranches: () => false,
  resolveRelayScope: async () => ({ isSupervisor: false, permissions: { can_access_pos_settings: fixture.mayManage } }),
}));
vi.mock("@/lib/secure-settings.server", () => ({ verifyPosStaff: async () => ({
  userId: "00000000-0000-4000-8000-000000000001", role: "supervisor", isAdmin: false,
  permissions: { can_access_pos_settings: fixture.mayManage },
}) }));
vi.mock("@/lib/session-guard.server", () => ({ touchSession: async () => fixture.boundSession ? ({ ok: true,
  session: { terminal_id: terminal, branch_id: branch, kind: "staff", staff_user_id: "staff", label: "Staff" },
}) : ({ ok: false, reason: "revoked" }) }));
vi.mock("@/lib/pos-rules.server", () => ({ loadRulesResult: fixture.load, saveRules: fixture.save }));

import { Route as readRoute } from "@/routes/api/public/pos-rules";
import { Route as saveRoute } from "@/routes/api/public/pos-rules.save";
import { getPosRules, savePosRules } from "../pos-rules.functions";

const terminal = "00000000-0000-4000-8000-000000000010";
const branch = "00000000-0000-4000-8000-00000000000a";
const other = "00000000-0000-4000-8000-00000000000b";
const proof = "a".repeat(64);
const accessToken = "isolated-staff-token";
type PostRoute = { options: { server: { handlers: { POST(input: { request: Request }): Promise<Response> } } } };
const http = (route: unknown, data: object) => (route as PostRoute).options.server.handlers.POST({
  request: new Request("https://pos.test/api/public/pos-rules", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "capacitor://localhost" },
    body: JSON.stringify(data),
  }),
});
const native = () => ({ terminalToken: terminal, deviceBindingProof: proof, accessToken, storeId: branch });
const saveData = () => ({ ...native(), patch: { allow_branch_shift_sharing: true }, expectedVersion: 7 });

beforeEach(() => {
  fixture.mayManage = true; fixture.boundSession = false; fixture.registryStatus = 200;
  fixture.load.mockReset().mockResolvedValue({ source: "DATABASE", rules: {}, rowVersion: 7, shiftSharingAvailable: true });
  fixture.save.mockReset().mockResolvedValue({ rules: {}, rowVersion: 8 });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("/terminal_tokens?")) return Response.json([{
      id: terminal, platform: "pc", status: "used", location_id: branch, is_claimed: true,
      claim_proof: proof, claimed_platform: "electron", management_registration: false,
    }], { status: fixture.registryStatus });
    if (url.endsWith("/auth/v1/user")) return Response.json({ id: "00000000-0000-4000-8000-000000000001" });
    throw new Error("Unexpected database call in isolated rules fixture");
  }));
});

describe("native rules transports retain proof and terminal authority", () => {
  it("HTTP read passes the valid native proof to actual terminal verification and returns sharing capability", async () => {
    const res = await http(readRoute, native());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, branchId: branch, shiftSharingAvailable: true });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("capacitor://localhost");
    expect(fixture.load).toHaveBeenCalledWith(branch);
  });
  it("HTTP save retains proof, expected version and the normal terminal's branch", async () => {
    expect((await http(saveRoute, saveData())).status).toBe(200);
    expect(fixture.save).toHaveBeenCalledWith(branch, { allow_branch_shift_sharing: true }, accessToken, 7);
  });
  it.each([undefined, "b".repeat(64)])("HTTP read and save reject missing/wrong proof %s", async invalid => {
    for (const route of [readRoute, saveRoute]) {
      const res = await http(route, { ...saveData(), deviceBindingProof: invalid });
      expect(res.status).toBe(401);
    }
    expect(fixture.save).not.toHaveBeenCalled(); expect(fixture.load).not.toHaveBeenCalled();
  });
  it("rejects malformed proof before verification", async () => {
    expect((await http(readRoute, { ...native(), deviceBindingProof: "not-a-proof" })).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("never drops a native administrator terminal lock to use wider staff scope", async () => {
    for (const route of [readRoute, saveRoute]) expect((await http(route, { ...saveData(), storeId: other })).status).toBe(403);
    expect(fixture.load).not.toHaveBeenCalled(); expect(fixture.save).not.toHaveBeenCalled();
  });
  it("keeps POS-settings permission checks on save", async () => {
    fixture.mayManage = false;
    expect((await http(saveRoute, saveData())).status).toBe(403);
    expect(fixture.save).not.toHaveBeenCalled();
  });
  it("keeps activation failures from becoming rules writes", async () => {
    fixture.registryStatus = 503;
    expect((await http(readRoute, native())).status).toBe(401);
    expect(fixture.load).not.toHaveBeenCalled(); expect(fixture.save).not.toHaveBeenCalled();
  });
  it("retains terminal-bound revocable-session compatibility without a raw proof", async () => {
    fixture.boundSession = true;
    expect((await http(readRoute, { sessionToken: "session-token", terminalToken: terminal, storeId: branch })).status).toBe(200);
  });
  it("keeps unbound authenticated browser management reads", async () => {
    expect((await http(readRoute, { accessToken, storeId: other })).status).toBe(200);
    expect(fixture.load).toHaveBeenCalledWith(other);
  });
  it("direct server functions retain the same valid proof and save credentials", async () => {
    expect(await getPosRules({ data: native() })).toMatchObject({ ok: true, branchId: branch, shiftSharingAvailable: true });
    expect(await savePosRules({ data: { ...saveData(), sessionToken: undefined, cashierToken: undefined } })).toMatchObject({ ok: true });
    expect(fixture.save).toHaveBeenCalledWith(branch, { allow_branch_shift_sharing: true }, accessToken, 7);
  });
  it("direct save keeps terminal context even for a staff account with broader access", async () => {
    expect(await savePosRules({ data: { ...saveData(), storeId: other } })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(fixture.save).not.toHaveBeenCalled();
  });
  it.each([undefined, "b".repeat(64)])("direct functions reject missing/wrong native proof %s without saving", async invalid => {
    const data = { ...saveData(), deviceBindingProof: invalid };
    expect(await getPosRules({ data })).toMatchObject({ ok: false, identified: false, code: "IDENTITY" });
    expect(await savePosRules({ data })).toMatchObject({ ok: false, code: "IDENTITY" });
    expect(fixture.save).not.toHaveBeenCalled();
    // The existing global safety response is explicitly unverified, never the requested branch.
    expect(fixture.load).toHaveBeenCalledWith("");
    expect(fixture.load).not.toHaveBeenCalledWith(branch);
  });
  it("direct read and save keep revocable credentials instead of downgrading to a staff bearer", async () => {
    const data = { ...saveData(), sessionToken: "revoked-session" };
    expect(await getPosRules({ data })).toMatchObject({ ok: false, code: "IDENTITY" });
    expect(await savePosRules({ data })).toMatchObject({ ok: false, code: "IDENTITY" });
    expect(fixture.save).not.toHaveBeenCalled();
  });
});
