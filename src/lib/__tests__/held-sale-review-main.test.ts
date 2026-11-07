import { afterEach, describe, expect, it, vi } from "vitest";

const { CloudClient } = require("../../../electron/sync/cloud-client.cjs");
const { CHANNELS, installHeldSaleReviewIpc } = require("../../../electron/sync/held-sale-review-ipc.cjs");
const adminSession = require("../../../electron/admin-session.cjs");
const privilege = require("../../../electron/ipc-privilege.cjs");
const { WriteBarrier } = require("../../../electron/sync/write-barrier.cjs");
const branch = "11111111-1111-4111-8111-111111111111";
const terminal = "22222222-2222-4222-8222-222222222222";
const shiftId = "33333333-3333-4333-8333-333333333333";
const actorId = "44444444-4444-4444-8444-444444444444";
const billNo = "FIXTURE-20261107-0001";
const ticketId = `D:${branch}:${billNo}`;
const reviewToken = "55555555-5555-4555-8555-555555555555";
const review = { branchId: branch, ticketId, billNo, shiftId };
const reply = { ok: true, version: 1, organizationId: "default", ...review, terminalId: terminal,
  actorId, proof: "cleaned_hold", graphJson: '{"total":9007199254740993.1234567}' };

function transport() {
  const config = { tokenId: terminal, deviceUse: "operations", deviceType: "pc", locationId: branch,
    deviceBindingProof: "a".repeat(64) };
  const client = new CloudClient({ connectionManager: { pool: {} }, configStore: { get: () => "https://fixture.invalid" },
    terminalStore: { read: () => config } });
  return { client, config };
}

afterEach(() => {
  vi.unstubAllGlobals();
  adminSession.clear();
});

describe("held sale review transport", () => {
  it("uses current native person proof and retains the exact cloud graph", async () => {
    const { client } = transport();
    client.setAuthorizationProof({ sessionToken: "fixture-admin-session" });
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => Response.json(reply));
    vi.stubGlobal("fetch", fetch);

    expect(await client.heldSaleReview(review)).toEqual(reply);
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetch.mock.calls[0]![1].body))).toEqual({
      sqlServerHeldSaleReview: { organizationId: "default", ...review },
      terminalToken: terminal, deviceBindingProof: "a".repeat(64), sessionToken: "fixture-admin-session",
    });
  });

  it("rejects a missing person proof or a foreign branch before HTTP", async () => {
    const { client } = transport();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(client.heldSaleReview(review)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    client.setAuthorizationProof({ sessionToken: "fixture-admin-session" });
    await expect(client.heldSaleReview({ ...review, branchId: actorId })).rejects.toMatchObject({ code: "SYNC_BRANCH_FORBIDDEN" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects an exact graph arriving after the person proof changes", async () => {
    const { client } = transport();
    client.setAuthorizationProof({ sessionToken: "fixture-admin-session" });
    vi.stubGlobal("fetch", vi.fn(async () => {
      client.clearAuthorizationProof();
      return Response.json(reply);
    }));
    await expect(client.heldSaleReview(review)).rejects.toMatchObject({ code: "ESYNC_REQUEST_CONTEXT_CHANGED" });
  });
});

function bridge() {
  type Handler = (event: object, value?: unknown) => Promise<unknown>;
  const handlers = new Map<string, Handler>();
  const mainFrame = {};
  const state = { source: "pos", level: "admin", epoch: 1, ready: true };
  const service = {
    list: vi.fn(async () => ({ items: [], nextAfterId: null })),
    preview: vi.fn(async () => ({ canAdopt: false, reviewToken: null })),
    resolve: vi.fn(async () => ({ state: "ADOPTED", ticketId })),
  };
  const onCommitted = vi.fn();
  const runExclusive = vi.fn(async (work: () => Promise<unknown>) => work());
  installHeldSaleReviewIpc({
    ipcMain: { handle: (name: string, handler: Handler) => handlers.set(name, handler) },
    session: { identity: () => state, epoch: () => state.epoch, touch() {} },
    service, runExclusive, onCommitted, isPosSender: (event: object) => event === mainFrame,
    canResolve: () => state.ready,
  });
  const call = (channel: string, value?: unknown, event: object = mainFrame) => handlers.get(channel)!(event, value);
  return { call, service, state, onCommitted, runExclusive };
}

describe("held sale review Main IPC", () => {
  it("requires a trusted frame and real POS Administrator", async () => {
    const f = bridge();
    await expect(f.call(CHANNELS.list, undefined, {})).resolves.toMatchObject({ code: "PERMISSION_DENIED" });
    f.state.level = "staff";
    await expect(f.call(CHANNELS.preview, ticketId)).resolves.toMatchObject({ code: "PERMISSION_DENIED" });
    f.state.level = "admin";
    f.state.source = "emergency";
    await expect(f.call(CHANNELS.resolve, { reviewToken, reason: "Fixture decision" })).resolves.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(f.service.list).not.toHaveBeenCalled();
    expect(f.service.preview).not.toHaveBeenCalled();
    expect(f.service.resolve).not.toHaveBeenCalled();
  });

  it("does not take a renderer-supplied branch or operator", async () => {
    const f = bridge();
    await expect(f.call(CHANNELS.list, { branchId: actorId })).resolves.toMatchObject({ code: "EBADARG" });
    await expect(f.call(CHANNELS.resolve, { reviewToken, reason: "Fixture decision", actorId }))
      .resolves.toMatchObject({ code: "EBADARG" });
    expect(f.service.list).not.toHaveBeenCalled();
    expect(f.service.resolve).not.toHaveBeenCalled();
  });

  it("rechecks the session in the coordinator lane and publishes only committed adoption", async () => {
    const f = bridge();
    const decision = { reviewToken, reason: "Fixture decision" };
    f.runExclusive.mockImplementationOnce(async work => {
      f.state.epoch++;
      return work();
    });
    await expect(f.call(CHANNELS.resolve, decision)).resolves.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(f.service.resolve).not.toHaveBeenCalled();
    f.state.ready = false;
    await expect(f.call(CHANNELS.resolve, decision)).resolves.toMatchObject({ code: "EHELD_SALE_REVIEW_BUSY" });
    expect(f.onCommitted).not.toHaveBeenCalled();
    f.state.ready = true;
    await expect(f.call(CHANNELS.resolve, decision)).resolves.toMatchObject({ ok: true, state: "ADOPTED" });
    expect(f.service.resolve).toHaveBeenCalledExactlyOnceWith(decision);
    expect(f.onCommitted).toHaveBeenCalledOnce();
  });

  it("reports held work without exposing raw SQL failures or publishing progress", async () => {
    const f = bridge();
    f.service.resolve.mockRejectedValueOnce(Object.assign(new Error("Private fixture row details"), {
      code: "EHELD_SALE_RECOVERY_PENDING",
    }));
    const result = await f.call(CHANNELS.resolve, { reviewToken, reason: "Fixture decision" });
    expect(result).toMatchObject({ ok: false, code: "ELOCAL_UPLOAD_PENDING" });
    expect(JSON.stringify(result)).not.toContain("Private fixture row details");
    expect(f.onCommitted).not.toHaveBeenCalled();
  });

  it("drains a started review decision and refuses new writes during shutdown", async () => {
    type Handler = (event: object, value?: unknown) => Promise<unknown>;
    const handlers = new Map<string, Handler>();
    const ipcMain = { handle: (name: string, handler: Handler) => handlers.set(name, handler) };
    const barrier = new WriteBarrier();
    const frame = {};
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const resolve = vi.fn(async () => {
      enter();
      await held;
      return { state: "ADOPTED" };
    });
    privilege.install(ipcMain, { writeBarrier: barrier });
    adminSession.grant("admin", "fixture", {}, "pos");
    installHeldSaleReviewIpc({
      ipcMain, service: { resolve }, session: adminSession,
      isPosSender: (event: object) => event === frame,
      runExclusive: (work: () => Promise<unknown>) => work(),
      canResolve: () => !barrier.sealed, onCommitted: vi.fn(),
    });
    const call = () => handlers.get(CHANNELS.resolve)!(frame, { reviewToken, reason: "Fixture decision" });
    const accepted = call();
    await entered;
    let drained = false;
    const drain = barrier.sealAndDrain().then(() => { drained = true; });
    try {
      await expect(call()).resolves.toMatchObject({ code: "EAPP_CLOSING" });
      expect(drained).toBe(false);
      expect(resolve).toHaveBeenCalledOnce();
    } finally {
      release();
      await drain;
    }
    await expect(accepted).resolves.toMatchObject({ ok: true, state: "ADOPTED" });
  });
});
