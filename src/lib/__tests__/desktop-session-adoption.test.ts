import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const session = require("../../../electron/admin-session.cjs");
const guard = require("../../../electron/ipc-guard.cjs");
const activation = require("../../../electron/verified-activation.cjs");
const { install } = require("../../../electron/ipc-privilege.cjs");
const source = readFileSync(new URL("../../../electron/main.cjs", import.meta.url), "utf8");
const start = source.indexOf('  ipcMain.handle("admin:adopt-session",');
const body = source.slice(start, source.indexOf('  ipcMain.handle("admin:unlock",', start));
const registration = { tokenId: "terminal-a", deviceType: "pc", deviceUse: "operations", locationId: "A", backendUrl: "https://operator.test", supabaseUrl: "https://operator-db.test", deviceClaimProof: "fixture-replica-secret" };
const descriptor = { id: "terminal-a", platform: "pc", mode: "operations", branchId: "A" };
const success = { ok: true, level: "staff", subject: "cashier", branchId: "A", permissions: { can_process_sale: true }, terminal: descriptor };
beforeEach(() => session.clear());
afterEach(() => { vi.restoreAllMocks(); session.clear(); });
function harness(payload: unknown = success, status = 200, saved: unknown = registration) {
  let sealed = saved;
  const handlers = new Map<string, (...args: unknown[]) => Promise<Record<string, unknown>>>();
  const ipc = { handle: (name: string, listener: (...args: unknown[]) => Promise<Record<string, unknown>>) => handlers.set(name, listener) };
  install(ipc, { isManagementDevice: () => false, isFirstRun: () => false });
  const write = vi.fn(() => ({ ok: true }));
  const fetch = vi.fn(async () => Response.json(payload, { status }));
  const grant = vi.spyOn(session, "grant");
  const proof = vi.fn(), audit = vi.fn(), safeChange = vi.fn<() => Promise<void>>(async () => {});
  const invalidate = new Function("ipcMain", "guard", "adminSession", "terminalStore", "activationBoundary", "fetch", "authorizationServerUrl", "syncCloud", "rememberVerifiedBranch", "assertSafeRegistrationChange", "recordRegistrationChange", `let sessionAdoptionRevision=0;${body};return()=>{sessionAdoptionRevision++};`)(
    ipc, guard, session, { read: () => sealed, write, lastBinding: () => saved }, activation, fetch, () => "https://operator.test", { setAuthorizationProof: proof }, vi.fn(), safeChange, audit,
  );
  const call = (provided: unknown = { cashierToken: "fixture-session", deviceBindingProof: "a".repeat(64) }, candidate?: unknown) => handlers.get("admin:adopt-session")!({}, provided, candidate);
  return { call, write, fetch, grant, proof, audit, safeChange, invalidate, setSealed: (value: unknown) => { sealed = value; } };
}
function noMutation(app: ReturnType<typeof harness>) { expect(app.write).not.toHaveBeenCalled(); expect(app.grant).not.toHaveBeenCalled(); expect(app.proof).not.toHaveBeenCalled(); }
describe("installed Main session adoption protocol", () => {
  it.each([undefined, null, {}, { id: 1 }, { ...descriptor, platform: undefined }, { ...descriptor, mode: undefined }, { ...descriptor, branchId: 7 }, { ...descriptor, branchId: null }])("reports missing/malformed registration descriptor %j as an upgrade requirement", async terminal => {
    const app = harness({ ...success, terminal });
    expect(await app.call()).toMatchObject({ ok: false, code: "EBACKEND_UPGRADE_REQUIRED", status: 426 }); noMutation(app);
  });
  it.each([{ ...descriptor, id: "foreign" }, { ...descriptor, platform: "mobile" }, { ...descriptor, mode: "management", branchId: null }, { ...descriptor, branchId: "B" }])("preserves real binding denial %j", async terminal => {
    const app = harness({ ...success, terminal });
    expect(await app.call()).toMatchObject({ ok: false, code: "EACTIVATION_BINDING", status: 403 }); noMutation(app);
  });
  it.each([401, 403])("keeps a failed/missing device proof or denied account response denied (%s)", async status => {
    const app = harness({ ok: false, code: "EAUTH_DENIED", error: "PRIVATE proof/account details" }, status);
    const result = await app.call({ cashierToken: "fixture-session" });
    expect(result).toMatchObject({ ok: false, code: "EAUTH_DENIED", status }); expect(JSON.stringify(result)).not.toContain("PRIVATE"); noMutation(app);
  });
  it.each([500, 503, 504])("preserves temporary backend failure %s without turning it into a permissions failure", async status => {
    const app = harness({ ok: false, code: "EAUTH_UNAVAILABLE", error: "PRIVATE SQL details" }, status);
    const result = await app.call(); expect(result).toMatchObject({ ok: false, code: "EAUTH_UNAVAILABLE", status: 503 }); expect(JSON.stringify(result)).not.toContain("PRIVATE"); noMutation(app);
  });
  it.each(["AbortError", "TimeoutError", "TypeError"])("returns safe typed unavailability for network %s", async name => {
    const app = harness(); app.fetch.mockRejectedValueOnce(Object.assign(new Error("PRIVATE backend URL/key"), { name }));
    const result = await app.call(); expect(result).toMatchObject({ ok: false, code: "EAUTH_UNAVAILABLE", status: 503 }); expect(JSON.stringify(result)).not.toContain("PRIVATE"); noMutation(app);
  });
  it("keeps malformed successful authority from writing a registration before grant validation", async () => {
    const app = harness({ ...success, level: "unknown" });
    expect(await app.call()).toMatchObject({ ok: false, code: "EBACKEND_UPGRADE_REQUIRED", status: 426 }); noMutation(app);
  });
  it("keeps malformed arguments and absent person credentials outside authorization", async () => {
    const app = harness();
    expect(await app.call({ cashierToken: "fixture", unexpected: "PRIVATE" })).toMatchObject({ ok: false, code: "EBADARG" });
    expect(await app.call({ deviceBindingProof: "a".repeat(64) })).toMatchObject({ ok: false, code: "EAUTH_DENIED", status: 401 });
    expect(app.fetch).not.toHaveBeenCalled(); noMutation(app);
  });
  it.each([200, 503])("does not expose a malformed backend body (%s)", async status => {
    const app = harness(); app.fetch.mockResolvedValueOnce(new Response("PRIVATE backend body", { status }));
    const result = await app.call(); expect(result).toMatchObject({ ok: false, code: "EAUTH_UNAVAILABLE", status: 503 }); expect(JSON.stringify(result)).not.toContain("PRIVATE"); noMutation(app);
  });
  it("preserves an explicit backend upgrade response without granting authority", async () => {
    const app = harness({ ok: false, code: "EBACKEND_UPGRADE_REQUIRED", error: "PRIVATE descriptor" }, 426);
    const result = await app.call(); expect(result).toMatchObject({ ok: false, code: "EBACKEND_UPGRADE_REQUIRED", status: 426 }); expect(JSON.stringify(result)).not.toContain("PRIVATE"); noMutation(app);
  });
  it("adopts an ordinary cashier and verifies a legacy recovered proof without editing connection settings", async () => {
    const legacy = { ...registration, deviceUse: null };
    const app = harness(success, 200, legacy);
    expect(await app.call()).toMatchObject({ ok: true, level: "staff" });
    expect(app.write).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ ...registration, deviceBindingProof: "a".repeat(64) }));
    expect(session.hasPermission("can_process_sale")).toBe(true); expect(session.hasPermission("can_access_pos_settings")).toBe(false); expect(session.hasPermission("can_manage_sync_backup")).toBe(false);
    expect(app.proof).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ terminalToken: "terminal-a", deviceBindingProof: "a".repeat(64) }));
  });
  it("does not accept a renderer branch change or expose its raw exception", async () => {
    const app = harness(); expect(await app.call(undefined, { ...registration, locationId: "B" })).toMatchObject({ ok: false, code: "EACTIVATION_BINDING", status: 403 });
    expect(app.fetch).not.toHaveBeenCalled(); noMutation(app);
  });
  it.each(["user", "revision", "activation", "branch", "permissions"])("rejects a late response after %s change", async change => {
    if (change === "branch" || change === "permissions") session.grant("staff", "cashier", { can_process_sale: true }, "pos", "A");
    const app = harness(); let finish!: (value: Response) => void;
    app.fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = app.call(); expect(app.fetch).toHaveBeenCalledOnce();
    if (change === "user") { session.grant("staff", "other", {}, "pos", "A"); app.grant.mockClear(); }
    if (change === "revision") app.invalidate();
    if (change === "activation") app.setSealed({ ...registration, locationId: "B" });
    if (change === "branch") { session.grant("staff", "cashier", {}, "pos", "B"); app.grant.mockClear(); }
    if (change === "permissions") { session.grant("staff", "cashier", { can_process_sale: false }, "pos", "A"); app.grant.mockClear(); }
    finish(Response.json(success)); const result = await pending;
    expect(result.ok).toBe(false); noMutation(app); if (change === "user") expect(session.identity().subject).toBe("other");
    if (change === "permissions") expect(session.hasPermission("can_process_sale")).toBe(false);
  });
  it("rechecks the person after an asynchronous first-registration safety check", async () => {
    const app = harness(success, 200, null); let finish!: () => void;
    app.safeChange.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const pending = app.call(undefined, registration); await vi.waitFor(() => expect(app.safeChange).toHaveBeenCalledOnce());
    session.grant("staff", "other", {}, "pos", "A"); app.grant.mockClear(); finish();
    expect(await pending).toMatchObject({ ok: false, code: "EAUTH_DENIED", status: 401 }); noMutation(app); expect(session.identity().subject).toBe("other");
  });
});
