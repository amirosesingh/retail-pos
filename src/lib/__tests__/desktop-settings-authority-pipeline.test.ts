import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ status: vi.fn(), adopt: vi.fn(), credentials: vi.fn(), proof: vi.fn(), query: vi.fn(), cloud: vi.fn(), writes: vi.fn(), mode: "local" }));
vi.mock("@/core/api/pos-db", () => ({ commitOps: mocks.writes, commitLabel: vi.fn() }));
vi.mock("@/core/activation/connection-health", () => ({ checkHealth: vi.fn() }));
vi.mock("@/core/local-db/db-mode", () => ({ effectiveDatabaseMode: () => mocks.mode, isCloudDirect: () => false, isConnectionError: () => false, AllTargetsFailed: class extends Error {} }));
vi.mock("@/core/local-db/local-db", () => ({ localDb: () => ({ query: mocks.query }) }));
vi.mock("@/integrations/supabase/external-client", () => ({ supabaseExternal: {}, authenticatedExternalClientSnapshot: mocks.cloud }));
vi.mock("@/lib/pos-credentials", () => ({ readCredentials: mocks.credentials }));
vi.mock("@/lib/native-terminal-proof", () => ({ readNativeTerminalProof: mocks.proof }));
vi.mock("@/core/activation/terminal-tokens", () => ({ readTerminalConfig: () => ({ tokenId: "fixture-terminal", locationId: "A" }) }));
vi.mock("@/lib/session-presence", () => ({ hasCentralAuthSession: () => false }));
vi.mock("@/lib/row-versions", () => ({ noteVersions: vi.fn() }));

import { routedQuery } from "@/core/api/db-query";
import { loadBranchSettings } from "../branch-settings";
import { createScopedSettingsReader, type ScopedSettingsReadStatus } from "../scoped-settings-read";
import { desktopAuthorityFailure } from "../desktop-authority-error";
import { ensureDesktopPosSession } from "../desktop-pos-session";
import { bumpSessionEpoch } from "../session-epoch";

const require = createRequire(import.meta.url);
const privilege = require("../../../electron/ipc-privilege.cjs");
const session = require("../../../electron/admin-session.cjs");
const ids = { CLUSTER: "cluster-a", BRANCH: "A", TERMINAL: "fixture-terminal" };
const grants = { can_process_sale: true, can_access_pos_settings: false };
function reader() {
  const accept = vi.fn(), states: ScopedSettingsReadStatus[] = [];
  const controller = createScopedSettingsReader({ read: () => loadBranchSettings(ids, true), writes: { pending: false, revision: 0 }, isCurrent: () => true, accept, status: next => states.push(next) });
  return { controller, accept, states };
}
beforeEach(() => {
  bumpSessionEpoch(); session.clear(); mocks.mode = "local";
  for (const key of ["status", "adopt", "credentials", "proof", "query", "cloud", "writes"] as const) mocks[key].mockReset();
  mocks.status.mockImplementation(async () => session.status());
  mocks.credentials.mockResolvedValue({ sessionToken: "fixture-session" });
  mocks.proof.mockResolvedValue({ terminalToken: "fixture-terminal" });
  mocks.adopt.mockImplementation(async () => { session.grant("staff", "fixture-cashier", grants, "pos", "A"); return { ok: true, level: "staff" }; });
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipc = { handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler) };
  privilege.install(ipc, { isFirstRun: () => false, isManagementDevice: () => false });
  ipc.handle("business:query", (...args: unknown[]) => {
    const [, table, options] = args as [unknown, string, { match?: { scope?: string } }];
    return { ok: true, rows: table === "settings_locks" ? [{ section: "tax", locked: true }] : options.match?.scope === "BRANCH" ? [{ section: "tax", patch: '{"tax":{"rate":6}}' }] : [] };
  });
  mocks.query.mockImplementation(async (table, options) => handlers.get("business:query")!({}, table, options));
  vi.stubGlobal("window", { sqlAdmin: { adminStatus: mocks.status, adoptSession: mocks.adopt } });
});
afterEach(() => { bumpSessionEpoch(); session.clear(); vi.unstubAllGlobals(); });

describe("actual desktop authority → routed settings → readiness pipeline", () => {
  it("loads all local scope reads for a cashier without granting settings-edit access", async () => {
    const app = reader(); await app.controller.refresh();
    expect(mocks.adopt).toHaveBeenCalledTimes(1); expect(mocks.query).toHaveBeenCalledTimes(4);
    expect(session.hasPermission("can_access_pos_settings")).toBe(false);
    expect(app.accept).toHaveBeenCalledExactlyOnceWith({ overrides: { CLUSTER: {}, BRANCH: { tax: { tax: { rate: 6 } } }, TERMINAL: {} }, locks: { tax: true } });
    expect(app.states.at(-1)).toEqual({ phase: "ready", error: null });
    expect(mocks.cloud).not.toHaveBeenCalled(); expect(mocks.writes).not.toHaveBeenCalled();
  });
  it.each([
    ["EBACKEND_UPGRADE_REQUIRED", 426, "backend needs an update"],
    ["EACTIVATION_BINDING", 403, "saved registration does not match"],
    ["EAUTH_UNAVAILABLE", 503, "backend is temporarily unavailable"],
    ["EAUTH_DENIED", 401, "sign-in or access could not be verified"],
    ["EAUTH_DENIED", 403, "sign-in or access could not be verified"],
  ] as const)("preserves safe %s/%i without replacing saved settings or querying SQL", async (code, status, message) => {
    mocks.adopt.mockResolvedValue({ ok: false, code, status, error: "PRIVATE server SQL token diagnostics", details: "PRIVATE" });
    const result = await ensureDesktopPosSession();
    expect(result).toMatchObject({ ok: false, code, status, error: expect.stringContaining(message) });
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
    await expect(routedQuery("settings_locks")).rejects.toMatchObject({ code, status, message: expect.stringContaining(message) });
    const app = reader(); await app.controller.refresh();
    expect(app.states.at(-1)).toMatchObject({ phase: "failed", error: expect.stringContaining(message) });
    expect(app.states.at(-1)?.error).toContain("saved settings have not been replaced");
    expect(JSON.stringify(app.states)).not.toContain("PRIVATE");
    expect(app.accept).not.toHaveBeenCalled(); expect(mocks.query).not.toHaveBeenCalled(); expect(mocks.cloud).not.toHaveBeenCalled(); expect(mocks.writes).not.toHaveBeenCalled();
  });
  it("keeps unknown native and SQL errors generic instead of exposing diagnostics", async () => {
    mocks.adopt.mockResolvedValue({ ok: false, code: "UNRECOGNIZED", status: 500, error: "PRIVATE native details" });
    const unknownNative = reader(); await unknownNative.controller.refresh();
    expect(unknownNative.states.at(-1)?.error).toBe("Store settings could not be loaded. Check the connection and try again; saved settings have not been replaced.");
    expect(unknownNative.accept).not.toHaveBeenCalled(); expect(mocks.query).not.toHaveBeenCalled();
    session.grant("staff", "fixture-cashier", grants, "pos", "A");
    mocks.query.mockResolvedValue({ ok: false, code: "ESQL", error: "PRIVATE SQL server details" });
    const unknownSql = reader(); await unknownSql.controller.refresh();
    expect(unknownSql.states.at(-1)?.error).toBe(unknownNative.states.at(-1)?.error);
    expect(unknownSql.accept).not.toHaveBeenCalled(); expect(JSON.stringify(unknownSql.states)).not.toContain("PRIVATE");
  });
  it("preserves a safe typed denial returned by the local query boundary too", async () => {
    mocks.query.mockResolvedValue({ ok: false, code: "EAUTH_DENIED", status: 401, error: "PRIVATE query authorization details" });
    await expect(routedQuery("settings_locks")).rejects.toMatchObject({ code: "EAUTH_DENIED", status: 401, message: expect.stringContaining("sign-in or access") });
    const app = reader(); await app.controller.refresh();
    expect(app.states.at(-1)).toMatchObject({ phase: "failed", error: expect.stringContaining("sign-in or access") });
    expect(app.accept).not.toHaveBeenCalled(); expect(JSON.stringify(app.states)).not.toContain("PRIVATE"); expect(mocks.writes).not.toHaveBeenCalled();
  });
  it("continues verified offline PIN authority without a backend request", async () => {
    session.grant("staff", "fixture-cashier", grants, "pos", "A");
    mocks.adopt.mockRejectedValue(new Error("PRIVATE backend is offline"));
    const app = reader(); await app.controller.refresh();
    expect(app.states.at(-1)?.phase).toBe("ready"); expect(mocks.adopt).not.toHaveBeenCalled(); expect(mocks.credentials).not.toHaveBeenCalled(); expect(mocks.proof).not.toHaveBeenCalled();
  });
  it("does not treat a manual maintenance unlock as operator authority", async () => {
    session.grant("admin", "maintenance", {}, "manual", null);
    mocks.adopt.mockResolvedValue({ ok: false, code: "EAUTH_DENIED", status: 403, error: "PRIVATE denial" });
    const app = reader(); await app.controller.refresh();
    expect(app.states.at(-1)?.phase).toBe("failed"); expect(app.accept).not.toHaveBeenCalled(); expect(mocks.query).not.toHaveBeenCalled(); expect(mocks.adopt).toHaveBeenCalledTimes(1);
  });
  it("rejects a late authority result after identity change before SQL or state acceptance", async () => {
    let finish!: (value: unknown) => void;
    mocks.adopt.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const app = reader(), pending = app.controller.refresh();
    await vi.waitFor(() => expect(mocks.adopt).toHaveBeenCalledTimes(1));
    bumpSessionEpoch(); finish({ ok: true, level: "staff" }); await pending;
    expect(mocks.query).not.toHaveBeenCalled(); expect(app.accept).not.toHaveBeenCalled(); expect(app.states).toEqual([{ phase: "loading", error: null }]);
  });
  it("recovers from a temporary authority failure only after a successful verified retry", async () => {
    mocks.adopt.mockResolvedValueOnce({ ok: false, code: "EAUTH_UNAVAILABLE", status: 503 });
    const app = reader(); await app.controller.refresh(); expect(app.accept).not.toHaveBeenCalled();
    await app.controller.refresh(); expect(app.states.at(-1)?.phase).toBe("ready"); expect(app.accept).toHaveBeenCalledTimes(1); expect(mocks.query).toHaveBeenCalledTimes(4);
  });
  it("recognizes no arbitrary error code, message or inherited map property", () => {
    for (const value of [null, "EAUTH_DENIED", { code: "__proto__" }, { error: "EAUTH_UNAVAILABLE" }, { code: "23514", error: "PRIVATE" }]) expect(desktopAuthorityFailure(value)).toBeNull();
    expect(desktopAuthorityFailure({ code: "EAUTH_DENIED", status: 500, error: "PRIVATE" })).toMatchObject({ status: 403 });
  });
});
