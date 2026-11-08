import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  verify: vi.fn(),
  scope: vi.fn(),
  rest: vi.fn(),
  authError: class RelayAuthenticationError extends Error {},
  touch: vi.fn(),
  terminal: vi.fn(),
}));
vi.mock("@/core/api/pos-relay.server", () => ({
  verifyRelayCaller: mocked.verify, serviceRest: mocked.rest, RelayAuthenticationError: mocked.authError,
}));
vi.mock("@/core/api/relay-policy.server", () => ({ resolveRelayScope: mocked.scope }));
vi.mock("@/lib/external-supabase-config", () => ({ supabaseConfig: () => ({ url: "https://owned.example/" }) }));
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
  mocked.verify.mockResolvedValue({ kind: "cashier", storeId: terminal.branchId, terminal });
  mocked.scope.mockResolvedValue({ staffUserId: "person", storeId: terminal.branchId, terminalId: terminal.id, role: "cashier" });
  mocked.terminal.mockResolvedValue(terminal);
  mocked.rest.mockResolvedValue(Response.json([row(), row({ store_id: "other" }),
    row({ event_type: "sale_complete" }), row({ meta: '{"audience_user_ids":["another"]}' })]));
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
