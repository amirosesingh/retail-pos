import { describe, expect, it, vi } from "vitest";
import { canStartLocally, localStartupAuthReady, observeLocalStartup, type LocalStartupState } from "../local-startup";
const ready = { enabled: true, configured: true, connected: true, tradingReady: true };
const till = { windows: true, management: false, tokenId: "registered", branchId: "branch", database: ready };
describe("local SQL startup without internet", () => {
  it("releases a registered operations till based only on validated local SQL", () => {
    expect(canStartLocally(till)).toBe(true);
  });
  it("never releases mobile, web, management, unregistered or branchless devices", () => {
    for (const patch of [{ windows: false }, { management: true }, { tokenId: "" }, { branchId: null }])
      expect(canStartLocally({ ...till, ...patch })).toBe(false);
  });
  it("requires every readiness check, including completed schema/bootstrap validation", () => {
    expect(canStartLocally({ ...till, database: null })).toBe(false);
    for (const key of Object.keys(ready)) {
      expect(canStartLocally({ ...till, database: { ...ready, [key]: false } })).toBe(false);
      expect(canStartLocally({ ...till, database: { ...ready, [key]: undefined } })).toBe(false);
    }
  });
  it("does not let an old initial read overwrite a newer database failure", async () => {
    let resolve!: (value: LocalStartupState) => void;
    let emit!: (value: LocalStartupState) => void;
    const update = vi.fn(); const off = vi.fn();
    const stop = observeLocalStartup({ getState: () => new Promise(r => { resolve = r; }),
      subscribe: cb => { emit = cb; return off; } }, update);
    emit({ ...ready, connected: false }); resolve(ready); await Promise.resolve();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenLastCalledWith({ ...ready, connected: false });
    stop(); expect(off).toHaveBeenCalledOnce();
  });
  it("handles IPC failure and ignores a snapshot after unmount", async () => {
    const update = vi.fn();
    observeLocalStartup({ getState: async () => { throw new Error("IPC unavailable"); } }, update);
    await Promise.resolve(); expect(update).toHaveBeenLastCalledWith(null);
    update.mockClear();
    const stop = observeLocalStartup({ getState: async () => ready }, update);
    stop(); await Promise.resolve(); expect(update).not.toHaveBeenCalled();
  });
});

describe("local startup authentication boundary", () => {
  it("only bypasses cloud waits for signed-out UI or a freshly verified local PIN", () => {
    expect(localStartupAuthReady(true, false, false, false)).toBe(true);
    expect(localStartupAuthReady(true, false, true, true)).toBe(true);
    expect(localStartupAuthReady(true, true, true, true)).toBe(true);
  });
  it("does not trust a cached PIN profile or unverified cloud identity", () => {
    expect(localStartupAuthReady(true, false, true, false)).toBe(false);
    expect(localStartupAuthReady(true, true, false, false)).toBe(false);
    expect(localStartupAuthReady(true, true, true, false)).toBe(false);
    expect(localStartupAuthReady(false, false, false, false)).toBe(false);
    expect(localStartupAuthReady(false, false, true, true)).toBe(false);
  });
});
