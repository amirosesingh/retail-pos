import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const { install } = require("../../../electron/ipc-privilege.cjs");
it("blocks local business IPC in management mode while retaining printing", async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipc = { handle: (name: string, listener: (...args: unknown[]) => unknown) => handlers.set(name, listener) };
  install(ipc, { isManagementDevice: () => true });
  const business = vi.fn();
  for (const name of ["business:snapshot", "business:query", "business:commit-aggregate", "pos:write-batch", "staff:sign-in", "sync:run-now"] ) {
    ipc.handle(name, business);
    expect(await handlers.get(name)!({})).toMatchObject({ ok: false, code: "MANAGEMENT_ONLINE_ONLY" });
  }
  expect(business).not.toHaveBeenCalled();
  const print = vi.fn(() => ({ ok: true }));
  ipc.handle("print:list", print);
  expect(await handlers.get("print:list")!({})).toEqual({ ok: true });
  expect(print).toHaveBeenCalledOnce();
});
it("keeps the existing operations-device IPC path", async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipc = { handle: (name: string, listener: (...args: unknown[]) => unknown) => handlers.set(name, listener) };
  install(ipc, { isManagementDevice: () => false });
  const read = vi.fn(() => ({ ok: true }));
  ipc.handle("business:snapshot", read);
  expect(await handlers.get("business:snapshot")!({})).toEqual({ ok: true });
});
