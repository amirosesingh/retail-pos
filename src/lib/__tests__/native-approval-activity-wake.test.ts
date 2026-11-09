import { createHash, generateKeyPairSync, verify } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  verify: vi.fn(),
  scope: vi.fn(),
  rest: vi.fn(),
  authError: class RelayAuthenticationError extends Error {},
  touch: vi.fn(),
  terminal: vi.fn(),
  config: vi.fn(),
  env: new Map<string, string>(),
}));
vi.mock("@/core/api/pos-relay.server", () => ({
  verifyRelayCaller: mocked.verify, serviceRest: mocked.rest, RelayAuthenticationError: mocked.authError,
}));
vi.mock("@/core/api/relay-policy.server", () => ({ resolveRelayScope: mocked.scope }));
vi.mock("@/lib/external-supabase-config", () => ({
  supabaseConfig: mocked.config, runtimeEnvValue: (name: string) => mocked.env.get(name),
}));
vi.mock("../session-guard.server", () => ({ touchSession: mocked.touch }));
vi.mock("../terminal-binding.server", () => ({ readVerifiedTerminal: mocked.terminal }));

import { Route } from "@/routes/api/v1/pos/activity-preferences";
const post = (Route as unknown as { options: { server: { handlers: {
  POST: (input: { request: Request }) => Promise<Response>;
} } } }).options.server.handlers.POST;
const input = { action: "native_approval_wake", projectUrl: "https://owned.example",
  sessionToken: "person-session", terminalToken: "native-pos", deviceBindingProof: "a".repeat(64) };
const terminal = { id: input.terminalToken, platform: "pc", mode: "operations", branchId: "branch" };
const call = (body = input) => post({ request: new Request("https://relay.example/api/v1/pos/activity-preferences", {
  method: "POST", body: JSON.stringify(body),
}) });
const row = (extra: object = {}) => ({ store_id: terminal.branchId, entity_type: "authorization_request",
  event_type: "approval_granted", meta: '{"audience_user_ids":["person"]}', amount: "1.000000000001", ...extra });

beforeEach(() => {
  vi.resetAllMocks();
  mocked.env.clear();
  mocked.config.mockReturnValue({ url: "https://owned.example/" });
  mocked.verify.mockResolvedValue({ kind: "cashier", storeId: terminal.branchId, terminal });
  mocked.scope.mockResolvedValue({ staffUserId: "person", storeId: terminal.branchId, terminalId: terminal.id, role: "cashier" });
  mocked.terminal.mockResolvedValue(terminal);
  mocked.rest.mockResolvedValue(Response.json([row(), row({ store_id: "other" }),
    row({ event_type: "sale_complete" }), row({ meta: '{"audience_user_ids":["another"]}' })]));
});

describe("relay-only PIN approval hint grant", () => {
  const body = { ...input, action: "pin_approval_wake_grant" };
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const kid = "fixture-key";
  const enable = () => {
    mocked.config.mockReturnValue({ url: input.projectUrl });
    mocked.env.set("POS_PIN_APPROVAL_WAKE_PROJECT_URL", input.projectUrl);
    mocked.env.set("POS_PIN_APPROVAL_WAKE_SIGNING_JWK", JSON.stringify({ ...privateKey.export({ format: "jwk" }), kid }));
    mocked.env.set("POS_PIN_APPROVAL_WAKE_TERMINAL_IDS", input.terminalToken);
  };
  it("issues only a short-lived private hint credential without a staff or machine bearer", async () => {
    enable();
    const response = await call(body);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const grant = await response.json();
    const topic = `pos-pin-approval-wake:v1:${createHash("sha256").update("branch\x1fperson").digest("hex")}`;
    expect(grant).toMatchObject({ ok: true, protocol: "pin-approval-wake-v1", topic,
      projectUrl: input.projectUrl, terminalId: terminal.id, branchId: terminal.branchId });
    const [header, payload, signature] = grant.bearer.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "ES256", kid, typ: "JWT" });
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    expect(claims).toEqual({ role: "anon", iat: expect.any(Number), exp: claims.iat + 120, pos_pin_approval_wake_topic: topic });
    expect(verify("sha256", Buffer.from(`${header}.${payload}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"))).toBe(true);
    expect(mocked.verify).toHaveBeenCalledExactlyOnceWith(body, { strictAvailability: true, requireBoundCashier: true });
    expect(mocked.rest).not.toHaveBeenCalled();
  });

  it("refuses a disabled gate, unrelated project, unlisted device, supplied branch and revoked or stale session", async () => {
    expect((await call(body)).status).toBe(404);
    enable();
    expect((await call({ ...body, projectUrl: "https://other.example" })).status).toBe(403);
    expect((await call({ ...body, terminalToken: "unlisted" })).status).toBe(403);
    const forged = { ...body, branchId: "unrelated" };
    expect((await call(forged)).status).toBe(400);
    expect(mocked.verify).not.toHaveBeenCalled();
    mocked.verify.mockRejectedValueOnce(new mocked.authError());
    expect((await call(body)).status).toBe(403);
    mocked.scope.mockResolvedValueOnce({ stale: true, staffUserId: "person", storeId: terminal.branchId, terminalId: terminal.id });
    expect((await call(body)).status).toBe(403);
    mocked.scope.mockResolvedValueOnce({ staffUserId: "person", storeId: "different", terminalId: terminal.id });
    expect((await call(body)).status).toBe(403);
  });
});

describe("Windows scoped approval activity read", () => {
  it("uses the configured project, exact proof, bounded types and the verified person's audience", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, protocol: "native-approval-activity-v1",
      projectUrl: input.projectUrl, branchId: terminal.branchId, rows: [row()] });
    expect(mocked.verify).toHaveBeenCalledExactlyOnceWith(input, { strictAvailability: true, requireBoundCashier: true });
    const query = new URL(mocked.rest.mock.calls[0][0], "https://owned.example").searchParams;
    expect(query.get("store_id")).toBe("eq.branch");
    expect(query.get("entity_type")).toBe("eq.authorization_request");
    expect(query.get("limit")).toBe("50");
    expect(query.get("select")).toContain("amount::text");
    expect(query.get("select")).toContain("meta::text");
  });
  it("refuses a different project or renderer-supplied branch before attempting authorization", async () => {
    expect((await call({ ...input, projectUrl: "https://unrelated.example" })).status).toBe(403);
    const withBranch = { ...input, storeId: "other" };
    expect((await call(withBranch)).status).toBe(400);
    expect(mocked.verify).not.toHaveBeenCalled();
    expect(mocked.rest).not.toHaveBeenCalled();
  });
  it.each(["staff", "management", "mobile", "revoked", "different-branch", "stale-person"])(
    "refuses %s before reading activity",
    async variant => {
      if (variant === "revoked") mocked.verify.mockRejectedValue(new mocked.authError());
      if (variant === "staff") mocked.verify.mockResolvedValue({ kind: "staff", storeId: terminal.branchId, terminal });
      if (variant === "management" || variant === "mobile")
        mocked.verify.mockResolvedValue({ kind: "cashier", storeId: terminal.branchId,
          terminal: { ...terminal, ...(variant === "management" ? { mode: "management" } : { platform: "mobile" }) } });
      if (variant === "different-branch") mocked.verify.mockResolvedValue({ kind: "cashier", storeId: "other", terminal });
      if (variant === "stale-person") mocked.scope.mockResolvedValue({ stale: true, staffUserId: "person" });
      expect((await call()).status).toBe(403);
      expect(mocked.rest).not.toHaveBeenCalled();
    },
  );

  it("binds the raw PIN session itself before allowing the relay to resolve the device", async () => {
    const { verifyRelayCaller } = await vi.importActual<typeof import("@/core/api/pos-relay.server")>("@/core/api/pos-relay.server");
    const session = { kind: "cashier", terminal_id: terminal.id, branch_id: terminal.branchId, staff_user_id: "person" };
    const options = { strictAvailability: true, requireBoundCashier: true };
    for (const invalid of [{ ...session, terminal_id: null }, { ...session, branch_id: null }]) {
      mocked.touch.mockResolvedValue({ ok: true, session: invalid });
      await expect(verifyRelayCaller(input, options)).rejects.toThrow("bound to this terminal");
    }
    expect(mocked.terminal).not.toHaveBeenCalled();
    mocked.touch.mockResolvedValue({ ok: true, session: { ...session, branch_id: "other" } });
    await expect(verifyRelayCaller(input, options)).rejects.toThrow("registration changed");
    mocked.touch.mockResolvedValue({ ok: true, session });
    await expect(verifyRelayCaller(input, options)).resolves.toMatchObject({ kind: "cashier", terminal });
    expect(mocked.touch).toHaveBeenLastCalledWith(input.sessionToken);
  });
});
