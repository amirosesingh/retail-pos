import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rpcStatus: "invalid", rest: vi.fn(), begin: vi.fn(), finish: vi.fn(),
  accountStatus: vi.fn(), accountFail: vi.fn(), accountReset: vi.fn(),
  audit: vi.fn(), mint: vi.fn(), start: vi.fn(), sign: vi.fn(),
  authority: vi.fn(), terminal: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: unknown) => ({ options }) }));
vi.mock("@/lib/public-api-guard.server", () => ({ callerVerifiedDownstream: () => null }));
vi.mock("@/core/api/pos-relay.server", () => ({ serviceRest: h.rest, hasServiceKey: () => true }));
vi.mock("@/lib/pin-request-throttle.server", () => ({ beginPinRequest: h.begin, finishPinRequest: h.finish }));
vi.mock("@/lib/pin-throttle.server", () => ({
  throttleStatus: h.accountStatus, throttleFail: h.accountFail,
  throttleReset: h.accountReset, minutesLeft: () => 7,
}));
vi.mock("@/lib/system-audit.server", () => ({ writeSystemAudit: h.audit }));
vi.mock("@/lib/staff-admin.server", () => ({ createVerifiedPinSignInToken: h.mint }));
vi.mock("@/lib/session-guard.server", () => ({ startSession: h.start }));
vi.mock("@/lib/pos-session.server", () => ({ signCashierSession: h.sign }));
vi.mock("@/lib/desktop-database-authority.server", () => ({ databaseAuthority: h.authority }));
vi.mock("@/lib/terminal-binding.server", () => ({ readVerifiedTerminal: h.terminal }));

import { handleCashierLogin } from "@/routes/api/public/cashier-login";
import { Route as AliasRoute } from "@/routes/api/cashier-login";
import { Route as IpcRoute } from "@/routes/api/v1/pos/ipc-authorize";
import { cashierServiceFailure } from "../cashier-login-failure";
import { countsAsWrongCashierPin } from "../login-failure";
import { publicCashierLoginResponse } from "../cashier-login-response.server";
import { cashierLoginServer } from "../cashier-login.server";

type TestRoute = { options: { server: { handlers: { POST: (input: { request: Request }) => Promise<Response> } } } };
const alias = (AliasRoute as unknown as TestRoute).options.server.handlers.POST;
const ipc = (IpcRoute as unknown as TestRoute).options.server.handlers.POST;
const endpoints = [
  { name: "public cashier login", run: handleCashierLogin, usernameBucket: true, ipc: false },
  { name: "short login alias", run: (request: Request) => alias({ request }), usernameBucket: true, ipc: false },
  { name: "IPC authorization", run: (request: Request) => ipc({ request }), usernameBucket: false, ipc: true },
];
const refusal = {
  ok: false, code: "sign_in_failed",
  error: "Sign-in was not accepted. Check your details, wait before retrying, or ask an administrator for help.",
};
const request = (extra: Record<string, unknown> = {}) => new Request("https://pos.test/api/public/cashier-login", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: " Cashier.Alias ", pin: "test-only-pin", ...extra }),
});
const envelope = async (response: Response) => ({ status: response.status, body: await response.json() });

beforeEach(() => {
  vi.resetAllMocks(); h.rpcStatus = "invalid";
  h.begin.mockResolvedValue({ key: "address-key", locked: false });
  h.finish.mockResolvedValue(undefined); h.audit.mockResolvedValue(undefined);
  h.accountStatus.mockResolvedValue({ locked: false });
  h.accountFail.mockResolvedValue(undefined); h.accountReset.mockResolvedValue(undefined);
  h.rest.mockImplementation(async (path: string) => path.startsWith("rpc/")
    ? Response.json({ status: h.rpcStatus, ...(h.rpcStatus === "verified" ? { account: { user_id: "cashier" } } : {}) })
    : Response.json([{ id: "account", user_id: "cashier", full_name: "Cashier", email: "cashier@pos.local",
      auth_user_id: "auth-user", role: "staff", role_slug: "cashier", store_id: "A", is_active: true,
      permissions: { can_process_sale: true } }]));
  h.mint.mockResolvedValue("auth-proof"); h.start.mockResolvedValue({ token: "session-proof", idleMinutes: 30 });
  h.sign.mockReturnValue("cashier-proof");
  h.authority.mockResolvedValue({ permissions: { can_manage_sync_backup: true } });
});

describe.each(endpoints)("PIN response privacy: $name", endpoint => {
  it.each(["invalid", "account_inactive", "credential_unavailable", "locked", "invalid_input"])(
    "hides private %s state while preserving private counting and denial", async state => {
      h.rpcStatus = state;
      const result = await envelope(await endpoint.run(request()));
      expect(result).toEqual({ status: 401, body: refusal });
      expect(h.rest).toHaveBeenCalledOnce();
      expect(h.rest.mock.calls[0][1].body).toContain('"p_user_id":"cashier.alias"');
      expect(h.finish).toHaveBeenCalledTimes(state === "invalid" ? 1 : 0);
      if (state === "invalid") expect(h.finish).toHaveBeenCalledWith("address-key", false, expect.any(AbortSignal));
      expect(h.accountFail).toHaveBeenCalledTimes(state === "invalid" && endpoint.usernameBucket ? 1 : 0);
      expect(h.audit).toHaveBeenCalledTimes(state === "invalid" ? 1 : 0);
      expect(h.start).not.toHaveBeenCalled(); expect(h.mint).not.toHaveBeenCalled();
      expect(h.sign).not.toHaveBeenCalled(); expect(h.authority).not.toHaveBeenCalled();
      const client = cashierServiceFailure(result.status, result.body);
      expect(client.useLocal).toBe(false);
      expect(countsAsWrongCashierPin(client.code)).toBe(false);
    },
  );

  it("does not reveal state when repeated private failures reach a SQL lock", async () => {
    const replies = [];
    for (const state of ["invalid", "invalid", "locked", "credential_unavailable", "account_inactive"])
    { h.rpcStatus = state; replies.push(await envelope(await endpoint.run(request({ username: "CASHIER@EXAMPLE.TEST" })))); }
    expect(replies).toEqual(Array.from({ length: 5 }, () => ({ status: 401, body: refusal })));
    expect(h.finish).toHaveBeenCalledTimes(2);
    expect(h.accountFail).toHaveBeenCalledTimes(endpoint.usernameBucket ? 2 : 0);
    expect(h.start).not.toHaveBeenCalled();
  });

  it("keeps a locked address denied without exposing its lock or checking credentials", async () => {
    h.begin.mockResolvedValue({ key: "address-key", locked: true });
    expect(await envelope(await endpoint.run(request()))).toEqual({ status: 401, body: refusal });
    expect(h.rest).not.toHaveBeenCalled(); expect(h.finish).not.toHaveBeenCalled();
    expect(h.accountFail).not.toHaveBeenCalled(); expect(h.start).not.toHaveBeenCalled();
  });

  it.each(["unicode-pin", "long-unicode-pin", "blank-username"])("prevents an address-budget probe using %s from distinguishing the target state", async probe => {
    const replies = [];
    for (const targetState of ["invalid", "account_inactive", "credential_unavailable"]) {
      let addressFailures = 0;
      h.begin.mockImplementation(async () => ({ key: "address-key", locked: addressFailures >= 20 }));
      h.finish.mockImplementation(async (_key, valid: boolean) => { if (!valid) addressFailures++; });
      h.rest.mockImplementation(async (_path: string, init: { body: string }) => {
        const input = JSON.parse(init.body);
        // Actual PostgreSQL validation is covered by test-terminal-pin-result:
        // IPC accepts JS length4 while SQL counts these as two characters.
        return Response.json({ status: input.p_pin === "😀😀" ? "invalid_input" : h.rpcStatus });
      });
      h.rpcStatus = "invalid";
      for (let index = 0; index < 19; index++)
        await endpoint.run(request({ username: `unknown-${index}` }));
      h.rpcStatus = targetState;
      await endpoint.run(request({ username: "guessed-target" }));
      expect(addressFailures).toBe(targetState === "invalid" ? 20 : 19);
      replies.push(await envelope(await endpoint.run(request(probe === "unicode-pin"
        ? { username: "probe", pin: "😀😀" } : probe === "long-unicode-pin"
          ? { username: "probe", pin: "😀".repeat(20) } : { username: " " }))));
    }
    expect(replies[1]).toEqual(replies[0]); expect(replies[2]).toEqual(replies[0]);
    const validationPassed = probe === "unicode-pin" ? endpoint.ipc : probe === "long-unicode-pin" && !endpoint.ipc;
    expect(replies[0].status).toBe(validationPassed ? 401 : 400);
    expect(h.start).not.toHaveBeenCalled(); expect(h.authority).not.toHaveBeenCalled();
  });

  it("preserves unavailable verification and safe local-fallback classification without wrong attempts", async () => {
    h.rest.mockResolvedValue(new Response(null, { status: 503 }));
    const result = await envelope(await endpoint.run(request()));
    expect(result.status).toBe(503); expect(result.body.code).toBe("central_unavailable");
    const client = cashierServiceFailure(result.status, result.body);
    expect(client.useLocal).toBe(true); expect(countsAsWrongCashierPin(client.code)).toBe(false);
    expect(h.finish).not.toHaveBeenCalled(); expect(h.accountFail).not.toHaveBeenCalled();
    expect(h.start).not.toHaveBeenCalled();
  });

  it("preserves a verified cashier's session/permissions and IPC's separate authority grant", async () => {
    h.rpcStatus = "verified";
    const result = await envelope(await endpoint.run(request()));
    expect(result.status).toBe(200); expect(result.body.ok).toBe(true);
    expect(h.start).toHaveBeenCalledWith(expect.objectContaining({ staffUserId: "cashier", branchId: "A" }), expect.anything());
    if (endpoint.ipc) expect(h.authority).toHaveBeenCalledWith({ userId: "cashier" });
    else expect(result.body).toMatchObject({ cashierToken: "cashier-proof", sessionToken: "session-proof",
      cashier: { store_id: "A", permissions: { can_process_sale: true } } });
    expect(h.accountFail).not.toHaveBeenCalled();
  });

  it("retains verified terminal/account branch denial before any session is issued", async () => {
    h.rpcStatus = "verified";
    h.terminal.mockResolvedValue({ id: "terminal-b", branchId: "B", mode: "operations", platform: "pc" });
    const result = await envelope(await endpoint.run(request({ terminalId: "terminal-b", deviceBindingProof: "a".repeat(64) })));
    expect(result.status).toBe(401); expect(result.body.ok).toBe(false);
    expect(h.start).not.toHaveBeenCalled(); expect(h.authority).not.toHaveBeenCalled();
  });
});

it("hides the public username-bucket lock while continuing to enforce it before PIN verification", async () => {
  h.accountStatus.mockResolvedValue({ locked: true });
  expect(await envelope(await handleCashierLogin(request()))).toEqual({ status: 401, body: refusal });
  expect(h.begin).not.toHaveBeenCalled(); expect(h.rest).not.toHaveBeenCalled();
  expect(h.accountFail).not.toHaveBeenCalled(); expect(h.start).not.toHaveBeenCalled();
});

it("keeps the IPC maintenance permission required after a valid PIN", async () => {
  h.rpcStatus = "verified"; h.authority.mockResolvedValue({ permissions: { can_manage_sync_backup: false } });
  const result = await envelope(await ipc({ request: request() }));
  expect(result.status).toBe(403); expect(result.body.ok).toBe(false);
});

it.each([{ username: " ", pin: "1234" }, { username: "cashier", pin: "😀".repeat(20) }])(
  "keeps early core validation typed and private without consuming attempts: %j", async input => {
    const result = await cashierLoginServer(input);
    expect(result).toMatchObject({ ok: false, code: "invalid_input" });
    expect(h.rest).not.toHaveBeenCalled(); expect(h.finish).not.toHaveBeenCalled();
    expect(h.accountFail).not.toHaveBeenCalled(); expect(h.start).not.toHaveBeenCalled();
    expect(await envelope(publicCashierLoginResponse(result, 401))).toEqual({ status: 401, body: refusal });
  },
);

it("does not carry private diagnostic fields or attempt metadata into a refusal", async () => {
  const privateResult = { ok: false, code: "credential_unavailable", error: "private verifier detail",
    account: { user_id: "private-account" }, attempts: 2, locked_until: "private-lock-time" } as const;
  expect(await envelope(publicCashierLoginResponse(privateResult, 429))).toEqual({ status: 401, body: refusal });
});

it.each([
  ["central_unavailable", 503], ["session_prepare_failed", 503],
  ["identity_mismatch", 409], ["activation_denied", 401],
] as const)("preserves the existing %s transport contract", async (code, status) => {
  const result = { ok: false, code, error: "Existing diagnostic" } as const;
  expect(await envelope(publicCashierLoginResponse(result, status))).toEqual({ status, body: result });
});
