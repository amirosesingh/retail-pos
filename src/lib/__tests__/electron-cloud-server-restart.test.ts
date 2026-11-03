import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

const main = readFileSync("electron/main.cjs", "utf8");
const scheduler = main.slice(main.indexOf("let cloudServerRestartTimer = null;"), main.indexOf("function stopAppServer()"));
const cloudHandlers = main.slice(main.indexOf('  ipcMain.handle("cloud:status"'), main.indexOf('  ipcMain.handle("branding:read"'));

function fixture(devUrl: string | undefined = undefined) {
  vi.useFakeTimers();
  let sealed: { url: string; key: string } | null = { url: "https://old.example", key: "old-public-key" };
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const win = (url: string, destroyed = false) => ({ isDestroyed: () => destroyed, webContents: { isDestroyed: () => false, getURL: () => url } });
  const views = [win("http://127.0.0.1:8080/settings/connection?tab=cloud#details"), win("http://127.0.0.1:8080/display"), win("https://other.example/"), win("invalid"), win("http://127.0.0.1:8080/closed", true)];
  const cloudCredentials = {
    read: vi.fn(() => sealed),
    write: vi.fn((value: { url: string; key: string }) => { sealed = { ...value }; return { ok: true }; }),
    remove: vi.fn(() => { sealed = null; return { ok: true }; }),
    status: vi.fn(() => ({ configured: !!sealed, url: sealed?.url ?? "", encrypted: true })),
  };
  const ctx = {
    DEV_URL: devUrl, setTimeout, clearTimeout, URL, quitting: false, safeMode: false,
    baseUrl: "http://127.0.0.1:8080", BrowserWindow: { getAllWindows: () => views },
    stopAppServer: vi.fn(async () => {}), startAppServer: vi.fn(async () => "http://127.0.0.1:8080"),
    load: vi.fn(async () => {}), recordFault: vi.fn(), enterSafeMode: vi.fn(), cloudCredentials,
    guard: { guarded: (fn: () => unknown) => fn() },
    ipcMain: { handle: (name: string, fn: (...args: unknown[]) => unknown) => handlers.set(name, fn) },
  };
  runInNewContext(`${scheduler}\n${cloudHandlers}`, ctx);
  const call = (name: string, value?: unknown) => handlers.get(name)!(null, value);
  return { ctx, call, views };
}

afterEach(() => vi.useRealTimers());

describe("Electron cloud configuration server ownership", () => {
  it.each([false, true])("keeps external Vite alive while saving %s changed credentials", async (changed) => {
    const { ctx, call } = fixture("http://127.0.0.1:8080");
    const next = changed ? { url: "https://next.example", key: "next-public-key" } : { url: "https://old.example", key: "old-public-key" };
    expect(call("cloud:set", next)).toMatchObject({ ok: true, configured: true, url: next.url });
    expect(call("cloud:bootstrap")).toEqual({ ok: true, ...next });
    await vi.advanceTimersByTimeAsync(2000);
    expect(ctx.cloudCredentials.write).toHaveBeenCalledWith(next);
    expect(ctx.stopAppServer).not.toHaveBeenCalled();
    expect(ctx.startAppServer).not.toHaveBeenCalled();
    expect(ctx.load).not.toHaveBeenCalled();
    expect(ctx.enterSafeMode).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("removes saved credentials in development without starting a packaged server", async () => {
    const { ctx, call } = fixture("http://127.0.0.1:8080");
    expect(call("cloud:remove")).toEqual({ ok: true });
    expect(call("cloud:bootstrap")).toEqual({ ok: false });
    await vi.advanceTimersByTimeAsync(2000);
    expect(ctx.startAppServer).not.toHaveBeenCalled();
    expect(ctx.enterSafeMode).not.toHaveBeenCalled();
  });

  it("restarts the packaged server after stop completes and preserves app routes only", async () => {
    const { ctx, call, views } = fixture();
    let stopped!: () => void;
    ctx.stopAppServer.mockImplementation(() => new Promise<void>(resolve => { stopped = resolve; }));
    call("cloud:set", { url: "https://next.example", key: "next-public-key" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(ctx.stopAppServer).toHaveBeenCalledOnce();
    expect(ctx.startAppServer).not.toHaveBeenCalled();
    stopped();
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.startAppServer).toHaveBeenCalledWith(8080);
    expect(ctx.load.mock.calls).toEqual([[views[0], "/settings/connection?tab=cloud#details"], [views[1], "/display"]]);
    expect(ctx.enterSafeMode).not.toHaveBeenCalled();
  });

  it("coalesces repeated saves and preserves the latest pair", async () => {
    const { ctx, call } = fixture();
    call("cloud:set", { url: "https://first.example", key: "first-public-key" });
    await vi.advanceTimersByTimeAsync(500);
    call("cloud:set", { url: "https://last.example", key: "last-public-key" });
    await vi.advanceTimersByTimeAsync(999);
    expect(ctx.startAppServer).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(ctx.startAppServer).toHaveBeenCalledOnce();
    expect(call("cloud:bootstrap")).toMatchObject({ url: "https://last.example", key: "last-public-key" });
  });

  it.each(["quitting", "safeMode"] as const)("does not restart while %s", async (flag) => {
    const { ctx, call } = fixture();
    call("cloud:set", { url: "https://next.example", key: "next-public-key" });
    ctx[flag] = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(ctx.stopAppServer).not.toHaveBeenCalled();
    expect(ctx.startAppServer).not.toHaveBeenCalled();
  });

  it("retains packaged recovery on restart failure", async () => {
    const { ctx, call } = fixture();
    const failure = new Error("isolated startup failure");
    ctx.startAppServer.mockRejectedValue(failure);
    call("cloud:set", { url: "https://next.example", key: "next-public-key" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(ctx.recordFault).toHaveBeenCalledWith("app-server.cloud-config-restart", failure);
    expect(ctx.enterSafeMode).toHaveBeenCalledOnce();
    expect(ctx.load).not.toHaveBeenCalled();
  });

  it("does not restart when secure persistence rejects a save", async () => {
    const { ctx, call } = fixture();
    ctx.cloudCredentials.write.mockImplementation(() => ({ ok: false }));
    expect(call("cloud:set", { url: "https://next.example", key: "next-public-key" })).toEqual({ ok: false });
    await vi.advanceTimersByTimeAsync(1000);
    expect(ctx.startAppServer).not.toHaveBeenCalled();
    expect(call("cloud:bootstrap")).toMatchObject({ url: "https://old.example" });
  });
});
