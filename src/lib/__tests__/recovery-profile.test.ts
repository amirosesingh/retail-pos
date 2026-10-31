import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalConfig } from "@/core/activation/terminal-tokens";

const f = vi.hoisted(() => ({
  states: [] as unknown[], cursor: 0, effectCursor: 0,
  effects: [] as { deps: unknown[]; cleanup?: () => void }[], pending: [] as (() => void)[],
  hydrate: vi.fn(), cloud: vi.fn(), config: null as TerminalConfig | null,
  terminalChanged: null as null | (() => void), cloudChanged: null as null | (() => void),
}));
vi.mock("react", () => ({
  useState: (initial: unknown) => {
    const index = f.cursor++;
    if (!(index in f.states)) f.states[index] = typeof initial === "function" ? initial() : initial;
    return [f.states[index], (next: unknown) => { f.states[index] = typeof next === "function" ? next(f.states[index]) : next; }];
  },
  useEffect: (fn: () => void | (() => void), deps: unknown[]) => {
    const index = f.effectCursor++;
    const old = f.effects[index];
    if (old && deps.length === old.deps.length && deps.every((value, i) => Object.is(value, old.deps[i]))) return;
    f.pending.push(() => { old?.cleanup?.(); f.effects[index] = { deps, cleanup: fn() || undefined }; });
  },
}));
vi.mock("../connection-profile", () => ({ hydrateConnectionProfile: () => f.hydrate() }));
vi.mock("@/core/activation/terminal-tokens", () => ({
  readTerminalConfig: () => f.config,
  subscribeTerminalConfig: (callback: () => void) => { f.terminalChanged = callback; return () => { f.terminalChanged = null; }; },
}));
vi.mock("../secure-cloud-config", () => ({
  cloudKeyStatus: () => f.cloud(),
  subscribeCloudKeys: (callback: () => void) => { f.cloudChanged = callback; return () => { f.cloudChanged = null; }; },
}));
vi.mock("@/core/activation/connection-health", () => ({ APP_RESUME_EVENT: "resume" }));
vi.mock("../session-presence", () => ({ hasSignedInIdentity: () => false }));
import { useRecoveryProfile } from "../use-recovery-profile";

function render(flush = true) {
  f.cursor = 0; f.effectCursor = 0;
  // eslint-disable-next-line react-hooks/rules-of-hooks -- Deterministic render/effect separation tests the real recovery hook.
  const result = useRecoveryProfile();
  if (flush) f.pending.splice(0).forEach(effect => effect());
  return result;
}
const saved = { tokenId: "saved-terminal", deviceUse: "operations", locationId: "a", locationName: "Branch A" } as TerminalConfig;
beforeEach(() => {
  f.states = []; f.effects = []; f.pending = []; f.config = saved;
  f.terminalChanged = null; f.cloudChanged = null;
  f.hydrate.mockReset().mockResolvedValue(undefined);
  f.cloud.mockReset().mockResolvedValue({ configured: true });
});
afterEach(() => f.effects.forEach(effect => effect.cleanup?.()));

describe("recovery reads saved native configuration before deciding setup status", () => {
  it("keeps pending restoration unknown and joins it before reading cloud settings", async () => {
    let resolve!: () => void;
    f.hydrate.mockReturnValue(new Promise<void>(done => { resolve = done; }));
    expect(render(false)).toMatchObject({ loading: true, error: false, config: null, cloud: null });
    f.pending.splice(0).forEach(effect => effect());
    f.terminalChanged?.(); f.cloudChanged?.();
    expect(f.cloud).not.toHaveBeenCalled();
    resolve();
    await vi.waitFor(() => expect(render()).toMatchObject({ loading: false, error: false, config: saved, cloud: true }));
    expect(f.hydrate).toHaveBeenCalledOnce();
    expect(f.cloud).toHaveBeenCalledOnce();
  });
  it("reports real absence only after storage restoration succeeds", async () => {
    f.config = null; f.cloud.mockResolvedValue({ configured: false });
    render();
    await vi.waitFor(() => expect(render()).toMatchObject({ loading: false, error: false, config: null, cloud: false }));
  });
  it("retains unknown on a failed activation restore and permits explicit retry", async () => {
    f.hydrate.mockRejectedValueOnce(new Error("Private decryption diagnostic"));
    render();
    await vi.waitFor(() => expect(render()).toMatchObject({ loading: false, error: true, config: null, cloud: null }));
    expect(f.cloud).not.toHaveBeenCalled();
    render().retry(); render();
    await vi.waitFor(() => expect(render()).toMatchObject({ loading: false, error: false, config: saved, cloud: true }));
  });
  it("does not translate unreadable cloud settings into missing credentials", async () => {
    f.cloud.mockRejectedValueOnce(new Error("Vault unavailable"));
    render();
    await vi.waitFor(() => expect(render()).toMatchObject({ loading: false, error: true, cloud: null }));
    render().retry(); render();
    await vi.waitFor(() => expect(render().cloud).toBe(true));
  });
  it("updates saved registration and cloud status after explicit configuration changes", async () => {
    render(); await vi.waitFor(() => expect(render().loading).toBe(false));
    f.config = { ...saved, deviceUse: "management", locationId: "", locationName: "" };
    f.terminalChanged?.();
    await vi.waitFor(() => expect(render().config?.deviceUse).toBe("management"));
    f.cloud.mockResolvedValue({ configured: false }); f.cloudChanged?.();
    await vi.waitFor(() => expect(render().cloud).toBe(false));
    expect(f.hydrate).toHaveBeenCalledTimes(3);
  });
  it("rereads a registration change received while the first cloud status is pending", async () => {
    let resolve!: (status: { configured: boolean }) => void;
    f.cloud.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    render();
    await vi.waitFor(() => expect(f.cloud).toHaveBeenCalledOnce());
    const management = { ...saved, tokenId: "management-terminal", deviceUse: "management", locationId: "", locationName: "" } as TerminalConfig;
    f.config = management;
    f.terminalChanged?.();
    resolve({ configured: true });
    await vi.waitFor(() => expect(render()).toMatchObject({ loading: false, error: false, config: management }));
    expect(f.cloud).toHaveBeenCalledTimes(2);
  });
  it("accepts a new local change hint after the first cloud read fails", async () => {
    f.cloud.mockRejectedValueOnce(new Error("OS vault temporarily unavailable"));
    render();
    await vi.waitFor(() => expect(render()).toMatchObject({ loading: false, error: true, cloud: null }));
    f.cloudChanged?.();
    await vi.waitFor(() => expect(render()).toMatchObject({ loading: false, error: false, config: saved, cloud: true }));
    expect(f.cloud).toHaveBeenCalledTimes(2);
  });
  it("preserves the last readable snapshot when a later local read fails", async () => {
    render(); await vi.waitFor(() => expect(render().loading).toBe(false));
    f.cloud.mockRejectedValueOnce(new Error("OS vault locked")); f.cloudChanged?.();
    await vi.waitFor(() => expect(render()).toMatchObject({ error: true, config: saved, cloud: true }));
  });
  it("unsubscribes and ignores pending results after leaving recovery", async () => {
    let resolve!: () => void;
    f.hydrate.mockReturnValue(new Promise<void>(done => { resolve = done; }));
    render(); const before = [...f.states];
    f.effects.forEach(effect => effect.cleanup?.()); resolve();
    await vi.waitFor(() => expect(f.cloud).toHaveBeenCalledOnce());
    expect(f.states).toEqual(before);
    expect(f.terminalChanged).toBeNull(); expect(f.cloudChanged).toBeNull();
  });
});
