/**
 * The desktop shell exposes its bridge read-only. Wrapping it must never
 * attempt to write back into it (that crashed the whole till with
 * "Cannot assign to read only property 'write'"), and a refused call must
 * still prompt for an administrator and retry once.
 */
import { describe, expect, it, vi } from "vitest";

import { wrapBridge } from "../privilege-bridge";

const readOnlyBridge = (impl: Record<string, unknown>) => {
  const target: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(impl)) {
    Object.defineProperty(target, key, { value, writable: false, enumerable: true });
  }
  return Object.freeze(target);
};

describe("wrapBridge", () => {
  it("never writes into the read-only bridge", () => {
    const bridge = readOnlyBridge({ write: async () => ({ ok: true }) });
    const wrapped = wrapBridge(bridge, async () => true) as Record<string, unknown>;
    expect(() => {
      wrapped["write"] = () => undefined;
    }).not.toThrow();
    expect(typeof wrapped["write"]).toBe("function");
  });

  it("passes ordinary results straight through", async () => {
    const bridge = readOnlyBridge({ write: async () => ({ ok: true, rows: 1 }) });
    const unlock = vi.fn(async () => true);
    const wrapped = wrapBridge(bridge, unlock) as { write: () => Promise<unknown> };
    await expect(wrapped.write()).resolves.toEqual({ ok: true, rows: 1 });
    expect(unlock).not.toHaveBeenCalled();
  });

  it("asks for an administrator and retries a refused call", async () => {
    let calls = 0;
    const bridge = readOnlyBridge({
      write: async () => {
        calls += 1;
        return calls === 1
          ? { ok: false, code: "EPRIVILEGE", error: "Needs an admin" }
          : { ok: true };
      },
    });
    const unlock = vi.fn(async () => true);
    const wrapped = wrapBridge(bridge, unlock) as { write: () => Promise<unknown> };
    await expect(wrapped.write()).resolves.toEqual({ ok: true });
    expect(unlock).toHaveBeenCalledWith("Needs an admin", undefined);
    expect(calls).toBe(2);
  });

  it("adopts and retries privileged calls on nested database and sync bridges", async () => {
    let databaseCalls = 0;
    let syncCalls = 0;
    const subscribe = () => () => {};
    const bridge = readOnlyBridge({
      database: readOnlyBridge({
        testServer: async () =>
          ++databaseCalls === 1
            ? { ok: false, code: "EPRIVILEGE", requiredLevel: "admin", error: "Needs admin" }
            : { ok: true, version: "16" },
        subscribe,
      }),
      sync: readOnlyBridge({
        runNow: async () =>
          ++syncCalls === 1
            ? { ok: false, code: "EPRIVILEGE", requiredLevel: "admin", error: "Needs admin" }
            : { ok: true },
      }),
    });
    const adopt = vi.fn(async () => true);
    const wrapped = wrapBridge(bridge, adopt) as {
      database: { testServer: () => Promise<unknown>; subscribe: typeof subscribe };
      sync: { runNow: () => Promise<unknown> };
    };

    await expect(wrapped.database.testServer()).resolves.toMatchObject({ ok: true, version: "16" });
    await expect(wrapped.sync.runNow()).resolves.toEqual({ ok: true });
    expect(adopt).toHaveBeenCalledTimes(2);
    expect(databaseCalls).toBe(2);
    expect(syncCalls).toBe(2);
    expect(wrapped.database.subscribe).toBe(subscribe);
  });

  it("returns the refusal when the operator cancels", async () => {
    const refusal = { ok: false, code: "EPRIVILEGE", error: "Needs an admin" };
    const bridge = readOnlyBridge({ write: async () => refusal });
    const wrapped = wrapBridge(bridge, async () => false) as { write: () => Promise<unknown> };
    await expect(wrapped.write()).resolves.toEqual(refusal);
  });

  it("leaves event subscriptions and unlock untouched", () => {
    const onFatal = () => () => {};
    const unlock = async () => ({ ok: true });
    const bridge = readOnlyBridge({ onFatal, unlock });
    const wrapped = wrapBridge(bridge, async () => true) as Record<string, unknown>;
    expect(wrapped["onFatal"]).toBe(onFatal);
    expect(wrapped["unlock"]).toBe(unlock);
  });
});

it("registers a permission-refresh wrapper even when the window bridge property is read-only", async () => {
  const { registerDesktopBridge, desktopBridge } = await import("../privilege-bridge");
  let verified = false;
  const original = Object.freeze({ commitAggregate: async () => verified ? {ok:true} : {ok:false,code:"EPRIVILEGE"} });
  const fakeWindow = Object.defineProperty({}, "pos", { value:original,writable:false });
  const wrapped = wrapBridge(original, async () => { verified=true;return true; });
  const unregister = registerDesktopBridge("pos",wrapped);
  expect((fakeWindow as {pos:typeof original}).pos).toBe(original);
  await expect(desktopBridge("pos",original)!.commitAggregate()).resolves.toEqual({ok:true});
  unregister();expect(desktopBridge("pos",original)).toBe(original);
});
