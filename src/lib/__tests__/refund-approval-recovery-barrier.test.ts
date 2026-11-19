import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const session = require("../../../electron/admin-session.cjs");
const privilege = require("../../../electron/ipc-privilege.cjs");
const { WriteBarrier } = require("../../../electron/sync/write-barrier.cjs");

function fixture() {
  const handlers = new Map<string, (event: object) => Promise<unknown>>();
  const ipc = { handle: (name: string, handler: (event: object) => Promise<unknown>) => handlers.set(name, handler) };
  const barrier = new WriteBarrier(), metadata = vi.fn((work: () => unknown) => work());
  privilege.install(ipc, { writeBarrier: { run: (work: () => unknown) => metadata(() => barrier.run(work)) } });
  const attach = vi.fn(async () => ({ ok: true })), status = vi.fn(async () => ({ ok: true, pending: false }));
  ipc.handle("receipts:recover-refund-approval", attach); ipc.handle("receipts:refund-approval-status", status);
  return { barrier, metadata, attach, status, recover: async () => handlers.get("receipts:recover-refund-approval")!({}),
    read: async () => handlers.get("receipts:refund-approval-status")!({}) };
}
afterEach(() => session.clear());
describe("refund approval attachment uses the installed write lifecycle", () => {
  it("denies signed-out, emergency and unpermitted people before reaching storage", async () => {
    const f = fixture();
    await expect(f.recover()).resolves.toMatchObject({ ok: false });
    session.grant("admin", "emergency", { can_process_refund: true }, "manual");
    await expect(f.recover()).resolves.toMatchObject({ ok: false });
    session.grant("staff", "cashier", {}, "pos");
    await expect(f.read()).resolves.toMatchObject({ ok: false });
    await expect(f.recover()).resolves.toMatchObject({ ok: false });
    expect(f.attach).not.toHaveBeenCalled(); expect(f.status).not.toHaveBeenCalled();
  });
  it("gates attachment on recovery readiness and drains accepted saves before close", async () => {
    session.grant("staff", "cashier", { can_process_refund: true }, "pos");
    const f = fixture(); let finish!: (value: { ok: boolean }) => void;
    f.attach.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const accepted = f.recover(); await Promise.resolve();
    let drained = false; const closing = f.barrier.sealAndDrain().then(() => { drained = true; });
    await Promise.resolve(); expect(drained).toBe(false); expect(f.attach).toHaveBeenCalledOnce();
    await expect(f.recover()).resolves.toMatchObject({ ok: false, code: "EAPP_CLOSING" });
    finish({ ok: true }); await accepted; await closing; expect(drained).toBe(true);
    expect(f.attach).toHaveBeenCalledOnce(); expect(f.metadata).toHaveBeenCalledTimes(2);
    await expect(f.read()).resolves.toMatchObject({ pending: false });
  });
});
