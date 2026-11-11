import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TerminalConfig } from "@/core/activation/terminal-tokens";
import type { RevocationState } from "../use-revocation-check";

const source = ts.transpileModule(readFileSync("src/lib/use-revocation-check.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const terminal = (tokenId = "terminal-a"): TerminalConfig => ({
  tokenId, locationId: "store-a", locationName: "Store A", activatedAt: "2026-11-01T00:00:00Z",
  supabaseUrl: "https://registered.example.test", supabaseKey: "public-a",
});
const used = { status: "used", locationId: "store-a", locationName: "Store A", isClaimed: true, expiresAt: null };
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

/** Runs the real hook/effects without starting an app or contacting a tenant. */
function fixture() {
  const original = terminal();
  const state = {
    config: original as TerminalConfig | null,
    source: { url: original.supabaseUrl, key: original.supabaseKey } as { url: string; key: string } | null,
    client: { name: "registered-client" },
    lookup: async (_tokenId: string, _client: unknown): Promise<typeof used | null> => used,
    mobile: false,
    hydrated: true,
    restore: async (): Promise<TerminalConfig | null> => state.config,
  };
  const terminalListeners = new Set<() => void>();
  const resetListeners = new Set<() => void>();
  const windowListeners = new Map<string, Set<() => void>>();
  const local = new Map<string, string>();
  const slots: unknown[] = [];
  const effects: Array<{ deps?: readonly unknown[]; cleanup?: () => void }> = [];
  let cursor = 0, effectCursor = 0;
  const pending: Array<() => void> = [];
  const changeTerminal = (config: TerminalConfig | null) => {
    state.config = config;
    for (const listener of terminalListeners) listener();
  };
  const clear = vi.fn(async (_expected: unknown) => { changeTerminal(null); });
  const unpair = vi.fn(async (_expected: unknown) => { changeTerminal(null); });
  const fetchStatus = vi.fn((id: string, client: unknown) => state.lookup(id, client));
  const heartbeat = vi.fn(async () => {});
  const writeRecord = vi.fn(async () => {});
  const clearRecord = vi.fn();
  const hydrate = vi.fn(() => state.restore());
  const modules: Record<string, unknown> = {
    react: {
      useState(initial: unknown) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
        return [slots[index], (next: unknown) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
      },
      useEffect(effect: () => undefined | (() => void), deps?: readonly unknown[]) {
        const index = effectCursor++, previous = effects[index];
        if (previous && deps && previous.deps && deps.length === previous.deps.length && deps.every((v, i) => Object.is(v, previous.deps![i]))) return;
        effects[index] = { ...previous, deps };
        pending.push(() => { previous?.cleanup?.(); effects[index].cleanup = effect() ?? undefined; });
      },
    },
    "@/platform-config/features": { isMobileShell: () => state.mobile },
    "@/lib/sync-status": { syncState: () => ({ lastSyncAt: null }) },
    "@/lib/external-supabase-config": { supabaseConfig: () => {
      if (!state.source) throw new Error("Connection unavailable");
      return state.source;
    } },
    "@/integrations/supabase/external-client": {
      externalClientSnapshot: () => state.client,
      subscribeExternalClientReset: (listener: () => void) => { resetListeners.add(listener); return () => resetListeners.delete(listener); },
    },
    "@/core/activation/terminal-tokens": {
      readTerminalConfig: () => state.config,
      hydrateTerminalConfig: hydrate,
      isTerminalConfigHydrated: () => state.hydrated,
      restoreTerminalConfigFromDisk: async () => state.config,
      subscribeTerminalConfig: (listener: () => void) => { terminalListeners.add(listener); return () => terminalListeners.delete(listener); },
      clearTerminalConfig: clear, unpairTerminal: unpair,
      fetchTokenStatus: fetchStatus, stampHeartbeat: heartbeat,
    },
    "@/core/activation/activation-record": { writeActivationRecord: writeRecord, clearActivationRecord: clearRecord },
  };
  const module = { exports: {} as { useRevocationCheck: () => RevocationState; isTerminalRevoked: () => boolean; clearRevocation: () => void } };
  runInNewContext(source, {
    module, exports: module.exports, require: (name: string) => {
      if (!(name in modules)) throw new Error(`Unexpected dependency ${name}`);
      return modules[name];
    },
    setTimeout, clearTimeout, navigator: { onLine: true },
    window: {
      localStorage: { getItem: (key: string) => local.get(key) ?? null, setItem: (key: string, value: string) => local.set(key, value), removeItem: (key: string) => local.delete(key) },
      addEventListener(name: string, listener: () => void) {
        if (!windowListeners.has(name)) windowListeners.set(name, new Set());
        windowListeners.get(name)!.add(listener);
      },
      removeEventListener(name: string, listener: () => void) { windowListeners.get(name)?.delete(listener); },
      setInterval: () => 1, clearInterval() {},
    },
    document: { visibilityState: "visible", addEventListener() {}, removeEventListener() {} },
  });
  return {
    state, original, clear, unpair, fetchStatus, heartbeat, writeRecord, clearRecord, hydrate,
    ...module.exports,
    changeTerminal,
    fire(name: string) { for (const listener of windowListeners.get(name) ?? []) listener(); },
    changeSource(source: typeof state.source, client = { name: "replacement-client" }) {
      state.source = source; state.client = client;
      for (const listener of resetListeners) listener();
    },
    render(instances = 1) {
      cursor = 0; effectCursor = 0;
      const values = Array.from({ length: instances }, () => module.exports.useRevocationCheck());
      pending.splice(0).forEach(effect => effect());
      return values[0];
    },
    cleanup() { effects.forEach(effect => effect.cleanup?.()); },
  };
}

afterEach(() => vi.useRealTimers());

describe("terminal revocation connection ownership", () => {
  it("keeps activation hidden after secure restore fails and retries on focus", async () => {
    const f = fixture();
    f.state.config = null; f.state.hydrated = false;
    f.state.restore = vi.fn().mockRejectedValueOnce(new Error("Vault unavailable")).mockImplementationOnce(async () => {
      f.state.config = f.original; f.state.hydrated = true;
      return f.original;
    });
    expect(f.render().hydrating).toBe(true); await settle();
    expect(f.render().hydrating).toBe(true);
    expect(f.hydrate).toHaveBeenCalledOnce();
    expect(f.clear).not.toHaveBeenCalled();
    f.fire("focus"); await settle();
    expect(f.render()).toMatchObject({ hydrating: false, config: f.original });
    expect(f.hydrate).toHaveBeenCalledTimes(2);
    f.cleanup();
  });

  it("releases hydration when storage confirms there is no saved registration", async () => {
    const f = fixture(); f.state.config = null; f.state.hydrated = false;
    f.render(); await settle();
    expect(f.render()).toMatchObject({ hydrating: false, config: null });
    expect(f.hydrate).toHaveBeenCalledOnce();
    f.cleanup();
  });

  it("does not delete registration when Settings points at a different project", async () => {
    const f = fixture();
    f.state.source = { url: "https://new-project.example.test", key: "public-b" };
    f.render(); await settle();
    expect(f.render().verified).toBe(true);
    expect(f.fetchStatus).not.toHaveBeenCalled();
    expect(f.clear).not.toHaveBeenCalled();
    expect(f.state.config).toBe(f.original);
    f.cleanup();
  });

  it("keeps saved registration when the connection is unavailable", async () => {
    const f = fixture(); f.state.source = null;
    f.render(); await settle();
    expect(f.render().verified).toBe(true);
    expect(f.clear).not.toHaveBeenCalled();
    f.cleanup();
  });

  it("never confirms a missing terminal across a tenant change", async () => {
    vi.useFakeTimers();
    const f = fixture(), answer = deferred<null>();
    const firstClient = f.state.client;
    f.state.lookup = () => answer.promise;
    f.render();
    f.changeSource({ url: "https://new-project.example.test", key: "public-b" });
    answer.resolve(null); await settle(); await vi.advanceTimersByTimeAsync(8000);
    expect(f.fetchStatus).toHaveBeenCalledExactlyOnceWith(f.original.tokenId, firstClient);
    expect(f.clear).not.toHaveBeenCalled();
    expect(f.isTerminalRevoked()).toBe(false);
    expect(f.state.config).toBe(f.original);
    f.cleanup();
  });

  it("rejects a retired request even if the profile changes away and back", async () => {
    const f = fixture(), answer = deferred<typeof used>();
    const source = f.state.source!, client = f.state.client;
    f.state.lookup = () => answer.promise;
    f.render();
    f.changeSource({ url: "https://other.example.test", key: "public-b" });
    f.changeSource(source, client);
    answer.resolve({ ...used, status: "revoked" }); await settle();
    expect(f.clear).not.toHaveBeenCalled();
    expect(f.isTerminalRevoked()).toBe(false);
    f.cleanup();
  });

  it("ignores an old revoked response before React re-renders the new activation", async () => {
    const f = fixture(), answer = deferred<typeof used>();
    f.state.lookup = () => answer.promise;
    f.render(); f.changeTerminal(terminal("terminal-b"));
    answer.resolve({ ...used, status: "revoked" }); await settle();
    expect(f.clear).not.toHaveBeenCalled();
    expect(f.isTerminalRevoked()).toBe(false);
    expect(f.state.config?.tokenId).toBe("terminal-b");
    f.cleanup();
  });

  it("still locks and clears a revoked terminal verified by its registered project", async () => {
    const f = fixture(); f.state.lookup = async () => ({ ...used, status: "revoked" });
    f.render(); await settle();
    expect(f.isTerminalRevoked()).toBe(true);
    expect(f.clear).toHaveBeenCalledExactlyOnceWith({ config: f.original, reason: "revoked", verificationProjectUrl: f.original.supabaseUrl });
    expect(f.state.config).toBeNull();
    // Shared contextual clear owns receipt removal; a hook continuation must
    // never erase a receipt created during the native clear await.
    expect(f.clearRecord).not.toHaveBeenCalled();
    f.cleanup();
  });

  it("still confirms a genuine deletion twice on the same concrete client", async () => {
    vi.useFakeTimers();
    const f = fixture(); f.state.lookup = async () => null;
    const client = f.state.client;
    f.render(); await settle(); await vi.advanceTimersByTimeAsync(8000); await settle();
    expect(f.fetchStatus).toHaveBeenCalledTimes(2);
    expect(f.fetchStatus.mock.calls.every(([, calledClient]) => calledClient === client)).toBe(true);
    expect(f.clear).toHaveBeenCalledExactlyOnceWith({ config: f.original, reason: "missing", verificationProjectUrl: f.original.supabaseUrl });
    expect(f.isTerminalRevoked()).toBe(true);
    f.cleanup();
  });

  it("releases only its own lock when native clear refuses a replaced activation", async () => {
    const f = fixture(), clear = deferred<void>();
    f.state.lookup = async () => ({ ...used, status: "revoked" });
    f.clear.mockImplementation(() => clear.promise);
    f.render(); await settle();
    expect(f.isTerminalRevoked()).toBe(true);
    f.changeTerminal(terminal("terminal-b"));
    clear.reject(Object.assign(new Error("Registration changed"), { code: "EACTIVATION_CONTEXT_CHANGED" }));
    await settle();
    expect(f.isTerminalRevoked()).toBe(false);
    expect(f.state.config?.tokenId).toBe("terminal-b");
    expect(f.clearRecord).not.toHaveBeenCalled();
    f.cleanup();
  });

  it("does not refresh an old receipt after activation changes during heartbeat", async () => {
    const f = fixture(), heartbeat = deferred<void>();
    f.heartbeat.mockImplementation(() => heartbeat.promise);
    f.render(); await settle();
    expect(f.heartbeat).toHaveBeenCalledWith(f.original.tokenId, { synced: false }, f.state.client);
    f.changeTerminal(terminal("terminal-b")); heartbeat.resolve(); await settle();
    expect(f.writeRecord).not.toHaveBeenCalled();
    f.cleanup();
  });

  it("shares a refused clear across shell and Settings without leaving a false revocation lock", async () => {
    const f = fixture(), clearing = deferred<void>();
    f.state.lookup = async () => ({ ...used, status: "revoked" });
    f.clear.mockImplementation(() => clearing.promise);
    f.render(2); await settle();
    expect(f.isTerminalRevoked()).toBe(true);
    expect(f.clear).toHaveBeenCalledOnce();
    clearing.reject(Object.assign(new Error("Database changed"), { code: "EACTIVATION_CONTEXT_CHANGED" }));
    await settle();
    expect(f.isTerminalRevoked()).toBe(false);
    expect(f.state.config).toBe(f.original);
    expect(f.render(2).revoked).toBe(false);
    f.cleanup();
  });

  it("keeps the revocation lock after both screens share a genuine native clear", async () => {
    const f = fixture(), clearing = deferred<void>();
    f.state.lookup = async () => ({ ...used, status: "revoked" });
    f.clear.mockImplementation(async () => { await clearing.promise; f.changeTerminal(null); });
    f.render(2); await settle();
    expect(f.fetchStatus).toHaveBeenCalledTimes(2);
    expect(f.clear).toHaveBeenCalledOnce();
    clearing.resolve(); await settle();
    expect(f.isTerminalRevoked()).toBe(true);
    expect(f.state.config).toBeNull();
    f.cleanup();
  });

  it("ignores another screen's older healthy response while native revocation clearing is pending", async () => {
    const f = fixture(), clearing = deferred<void>(), healthy = deferred<typeof used>();
    let lookups = 0;
    f.state.lookup = async () => ++lookups === 1 ? { ...used, status: "revoked" } : healthy.promise;
    f.clear.mockImplementation(async () => { await clearing.promise; f.changeTerminal(null); });
    f.render(2); await settle();
    expect(f.isTerminalRevoked()).toBe(true);
    expect(f.clear).toHaveBeenCalledOnce();
    healthy.resolve(used); await settle();
    expect(f.isTerminalRevoked()).toBe(true);
    expect(f.heartbeat).not.toHaveBeenCalled();
    expect(f.writeRecord).not.toHaveBeenCalled();
    clearing.resolve(); await settle();
    expect(f.isTerminalRevoked()).toBe(true);
    expect(f.state.config).toBeNull();
    f.cleanup();
  });

  it("ignores another screen's older healthy response after native revocation clearing fails", async () => {
    const f = fixture(), clearing = deferred<void>(), healthy = deferred<typeof used>();
    let lookups = 0;
    f.state.lookup = async () => ++lookups === 1 ? { ...used, status: "revoked" } : healthy.promise;
    f.clear.mockImplementation(() => clearing.promise);
    f.render(2); await settle();
    expect(f.isTerminalRevoked()).toBe(true);
    expect(f.clear).toHaveBeenCalledOnce();
    clearing.reject(new Error("Vault unavailable")); await settle();
    expect(f.state.config).toBe(f.original);
    healthy.resolve(used); await settle();
    expect(f.isTerminalRevoked()).toBe(true);
    expect(f.heartbeat).not.toHaveBeenCalled();
    expect(f.writeRecord).not.toHaveBeenCalled();
    f.cleanup();
  });
});
