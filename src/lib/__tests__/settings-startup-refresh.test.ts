import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const hints = vi.hoisted(() => ({
  receive: null as null | ((change: { table: string; reason: string }) => void),
}));
vi.mock("../sync-engine", () => ({
  subscribeSettingsChange: (receive: typeof hints.receive) => {
    hints.receive = receive;
    return () => { hints.receive = null; };
  },
}));
vi.mock("../session-presence", () => ({ hasSignedInIdentity: () => true }));
vi.mock("@/core/activation/connection-health", () => ({ APP_RESUME_EVENT: "resume" }));

import { createSettingsStartupRefresh } from "../settings-startup-refresh";
import { subscribeSettingsRefresh } from "../settings-refresh";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  hints.receive = null;
});

describe("settings refresh during startup", () => {
  it("uses the bootstrap settings without an extra read when there is no change hint", async () => {
    const read = vi.fn(async () => undefined);
    const reader = createSettingsStartupRefresh(read);
    await reader.setReady(true);
    await reader.setReady(true);
    expect(read).not.toHaveBeenCalled();
    reader.stop();
  });

  it("retains startup hints and coalesces them into one catch-up after readiness", async () => {
    const read = vi.fn(async () => undefined);
    const reader = createSettingsStartupRefresh(read);
    await Promise.all([reader.refresh(), reader.refresh(), reader.refresh()]);
    expect(read).not.toHaveBeenCalled();
    await reader.setReady(true);
    expect(read).toHaveBeenCalledOnce();
    await reader.setReady(true);
    expect(read).toHaveBeenCalledOnce();
    await reader.refresh();
    expect(read).toHaveBeenCalledTimes(2);
    reader.stop();
  });

  it("defers both realtime startup joins but preserves later reconnect and actual edits", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
    vi.stubGlobal("window", Object.assign(new EventTarget(), { setInterval, clearInterval }));
    vi.stubGlobal("navigator", { onLine: true });
    const read = vi.fn(async () => undefined);
    const reader = createSettingsStartupRefresh(read);
    const stop = subscribeSettingsRefresh(reader.refresh);

    hints.receive!({ table: "", reason: "realtime:subscribed" });
    await vi.advanceTimersByTimeAsync(100);
    hints.receive!({ table: "", reason: "realtime:subscribed" });
    await vi.advanceTimersByTimeAsync(100);
    hints.receive!({ table: "pos_settings", reason: "live:pos_settings" });
    await vi.advanceTimersByTimeAsync(100);
    expect(read).not.toHaveBeenCalled();

    await reader.setReady(true);
    expect(read).toHaveBeenCalledOnce();
    hints.receive!({ table: "", reason: "reconnect" });
    await vi.advanceTimersByTimeAsync(100);
    expect(read).toHaveBeenCalledTimes(2);
    hints.receive!({ table: "settings_scoped", reason: "live:settings_scoped" });
    await vi.advanceTimersByTimeAsync(100);
    expect(read).toHaveBeenCalledTimes(3);
    stop();
    reader.stop();
  });

  it("keeps one trailing read when changes arrive during a ready read", async () => {
    const finish: (() => void)[] = [];
    const read = vi.fn(() => new Promise<void>(resolve => { finish.push(resolve); }));
    const reader = createSettingsStartupRefresh(read);
    await reader.setReady(true);
    const pending = reader.refresh();
    void reader.refresh();
    void reader.refresh();
    expect(read).toHaveBeenCalledOnce();
    finish[0]();
    await Promise.resolve();
    await Promise.resolve();
    expect(read).toHaveBeenCalledTimes(2);
    finish[1]();
    await pending;
    reader.stop();
  });

  it("rejects stale results after readiness is interrupted and catches up on return", async () => {
    const finish: ((value: string) => void)[] = [];
    const applied: string[] = [];
    const read = vi.fn(async (canApply: () => boolean) => {
      const result = await new Promise<string>(resolve => { finish.push(resolve); });
      if (canApply()) applied.push(result);
    });
    const reader = createSettingsStartupRefresh(read);
    await reader.setReady(true);
    const pending = reader.refresh();
    await reader.setReady(false);
    await reader.refresh();
    expect(read).toHaveBeenCalledOnce();
    await reader.setReady(true);
    finish[0]("stale");
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(applied).toEqual([]);
    finish[1]("current");
    await pending;
    expect(applied).toEqual(["current"]);
    reader.stop();
  });

  it("discards a stopped identity's pending result and leaves a new identity independent", async () => {
    let finish!: () => void;
    const apply = vi.fn();
    const previous = createSettingsStartupRefresh(async canApply => {
      await new Promise<void>(resolve => { finish = resolve; });
      if (canApply()) apply("previous");
    });
    await previous.setReady(true);
    const pending = previous.refresh();
    previous.stop();
    await previous.refresh();
    finish();
    await pending;
    expect(apply).not.toHaveBeenCalled();

    const current = createSettingsStartupRefresh(async canApply => {
      if (canApply()) apply("current");
    });
    await current.refresh();
    await current.setReady(true);
    expect(apply).toHaveBeenCalledExactlyOnceWith("current");
    current.stop();
  });

  it("allows a future change hint to recover after a failed read", async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const reader = createSettingsStartupRefresh(read);
    await reader.refresh();
    await reader.setReady(true);
    expect(read).toHaveBeenCalledOnce();
    await reader.refresh();
    expect(read).toHaveBeenCalledTimes(2);
    reader.stop();
  });
});

describe("settings provider integration guards (source contract)", () => {
  const provider = readFileSync("src/lib/pos-store.tsx", "utf8");

  it("memoizes the effective scope by scalar IDs rather than directory row references", () => {
    const memo = provider.slice(provider.indexOf("const scopeClusterId ="), provider.indexOf("const scopeIdsRef ="));
    expect(memo).toContain("state.stores.find");
    expect(memo).toContain("[scopeClusterId, scopeBranchId, scopeTerminalId]");
    expect(memo).not.toContain("[state.stores");
  });

  it("waits for the authoritative directory but permits a confirmed empty directory's global locks", () => {
    const effect = provider.slice(provider.indexOf("// Overrides follow the cluster"), provider.indexOf("// The directory may not have loaded"));
    expect(effect).toContain("if (!readsReady || !storesLoaded) return;");
    expect(effect).not.toContain("!state.stores.length");
    expect(effect).not.toContain("!scopeIds.BRANCH");
    expect(effect).toContain("[readsReady, readIdentity, storesLoaded, scopeIds, scopeReadKey, scopeReadEpoch]");
    expect(effect).toContain("scopeReadsEnabled.current && scopeReadKeyRef.current === scopeKey");
    expect(effect).toContain("epoch: scopeReadEpoch");
    expect(effect).not.toContain("scopeRetryTick");
    expect(effect).toContain("scopeRetry.current = retry");
    expect(effect).toContain("void off.retry()");
  });
});
