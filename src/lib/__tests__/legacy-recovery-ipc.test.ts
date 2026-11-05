import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const session = require("../../../electron/admin-session.cjs");
const privilege = require("../../../electron/ipc-privilege.cjs");
const { WriteBarrier } = require("../../../electron/sync/write-barrier.cjs");
const { installLegacyShiftRecoveryIpc, CHANNELS } = require("../../../electron/sync/legacy-shift-recovery-ipc.cjs");
const shift = "00000000-0000-4000-8000-000000000001";
function fixture() {
  const handlers = new Map<string, (event: object, value?: unknown) => Promise<unknown>>();
  const ipcMain = { handle: (name: string, callback: (event: object, value?: unknown) => Promise<unknown>) => handlers.set(name, callback) };
  const barrier = new WriteBarrier(); privilege.install(ipcMain, { writeBarrier: barrier });
  const service = { list: vi.fn(async () => ({ available: true, items: [] })), preview: vi.fn(async () => ({ shiftId: shift, canApprove: false })),
    approve: vi.fn(async () => ({ state: "PENDING" })) };
  const sender = {}, mainFrame = {}, event = { sender, senderFrame: mainFrame };
  installLegacyShiftRecoveryIpc({ ipcMain, service, session, isPosSender: (value: typeof event) => value.sender === sender && value.senderFrame === mainFrame });
  const call = (name: string, value?: unknown, caller = event) => handlers.get(name)!(caller, value);
  return { service, call, event, barrier };
}
afterEach(() => { session.clear(); session.clearRecovery(); });
describe("installed legacy recovery IPC and existing privilege wrapper", () => {
  it.each(["staff", "supervisor"])("denies %s even with database-management permission", async level => {
    session.grant(level, "fixture", { can_manage_sync_backup: true }, "pos");
    const f = fixture();
    expect(await f.call(CHANNELS.list, {})).toMatchObject({ ok: false });
    expect(await f.call(CHANNELS.approve, {})).toMatchObject({ ok: false });
    expect(f.service.list).not.toHaveBeenCalled(); expect(f.service.approve).not.toHaveBeenCalled();
  });
  it("denies a manual emergency administrator session and no session", async () => {
    const f = fixture(); expect(await f.call(CHANNELS.list, {})).toMatchObject({ ok: false });
    session.grant("admin", "emergency", {}, "manual");
    expect(await f.call(CHANNELS.list, {})).toMatchObject({ ok: false }); expect(f.service.list).not.toHaveBeenCalled();
  });
  it("requires the trusted POS main frame even for an actual administrator", async () => {
    session.grant("admin", "fixture", {}, "pos"); const f = fixture();
    for (const caller of [{ sender: {}, senderFrame: f.event.senderFrame }, { sender: f.event.sender, senderFrame: {} }])
      expect(await f.call(CHANNELS.list, {}, caller)).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    expect(f.service.list).not.toHaveBeenCalled();
  });
  it("forwards only selected review inputs and reports a durable pending save honestly", async () => {
    session.grant("admin", "fixture", {}, "pos"); const f = fixture();
    expect(await f.call(CHANNELS.list, {})).toMatchObject({ ok: true, available: true });
    expect(f.service.list).toHaveBeenCalledExactlyOnceWith({ afterId: null, limit: 25 });
    expect(await f.call(CHANNELS.preview, shift)).toMatchObject({ ok: true, canApprove: false });
    const input = { captureKey: "a".repeat(64), recoveryId: shift, reason: "Reviewed saved closing" };
    expect(await f.call(CHANNELS.approve, input)).toEqual({ ok: true, state: "PENDING" });
    expect(f.service.approve).toHaveBeenCalledExactlyOnceWith(input);
  });
  it("rejects caller-supplied identity, proof and malformed references", async () => {
    session.grant("admin", "fixture", {}, "pos"); const f = fixture();
    for (const input of [{ branchId: shift }, { authorId: shift }, { proof: {} }, { afterId: "bad" }])
      expect(await f.call(CHANNELS.list, input)).toMatchObject({ ok: false, code: "EBADARG" });
    expect(await f.call(CHANNELS.preview, "bad")).toMatchObject({ ok: false, code: "EBADARG" });
    expect(f.service.list).not.toHaveBeenCalled(); expect(f.service.preview).not.toHaveBeenCalled();
  });
  it("holds evidence/approval writes behind the existing safe-close barrier", async () => {
    session.grant("admin", "fixture", {}, "pos"); const f = fixture(); await f.barrier.sealAndDrain();
    expect(await f.call(CHANNELS.preview, shift)).toMatchObject({ ok: false, code: "EAPP_CLOSING" });
    expect(await f.call(CHANNELS.approve, {})).toMatchObject({ ok: false, code: "EAPP_CLOSING" });
    expect(f.service.preview).not.toHaveBeenCalled(); expect(f.service.approve).not.toHaveBeenCalled();
  });
  it("sanitizes unexpected SQL failures without exposing query details", async () => {
    session.grant("admin", "fixture", {}, "pos"); const f = fixture(); f.service.list.mockRejectedValueOnce(new Error("secret fixture SQL text"));
    const result = await f.call(CHANNELS.list, {});
    expect(result).toMatchObject({ ok: false, code: "ELEGACY_RECOVERY_PENDING" }); expect(JSON.stringify(result)).not.toContain("secret");
  });
});
