import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), status: vi.fn(), adopt: vi.fn() }));
vi.mock("../pos-credentials", () => ({ readCredentials: mocks.read }));
vi.mock("@/core/activation/terminal-tokens", () => ({ readTerminalConfig: () => null }));
import { ensureDesktopPosSession } from "../desktop-pos-session";
import { bumpSessionEpoch } from "../session-epoch";

beforeEach(() => {
  bumpSessionEpoch();
  mocks.read.mockReset().mockResolvedValue({ sessionToken: "test-proof" });
  mocks.status.mockReset().mockResolvedValue({ unlocked: false });
  mocks.adopt.mockReset().mockResolvedValue({ ok: true, level: "staff" });
  vi.stubGlobal("window", { sqlAdmin: { adminStatus: mocks.status, adoptSession: mocks.adopt } });
});
afterEach(() => vi.unstubAllGlobals());

describe("desktop POS authority handoff", () => {
  it("shares one verification between reports, startup and permission refresh", async () => {
    const results = await Promise.all([ensureDesktopPosSession(), ensureDesktopPosSession(), ensureDesktopPosSession(true)]);
    expect(results.every(result => result.ok)).toBe(true);
    expect(mocks.adopt).toHaveBeenCalledTimes(1);
  });
  it("uses a verified local PIN session offline without contacting the cloud", async () => {
    mocks.status.mockResolvedValue({ unlocked: true, source: "pos", level: "staff" });
    expect(await ensureDesktopPosSession()).toMatchObject({ ok: true });
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.adopt).not.toHaveBeenCalled();
  });
  it("does not accept a maintenance PIN as a signed-in operator", async () => {
    mocks.status.mockResolvedValue({ unlocked: true, source: "manual", level: "admin" });
    mocks.adopt.mockResolvedValue({ ok: false, error: "Session revoked" });
    expect(await ensureDesktopPosSession()).toEqual({ ok: false, error: "Session revoked" });
  });
  it("rejects a handoff that finishes after logout or user switching", async () => {
    let finish!: (value: unknown) => void;
    mocks.adopt.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const result = ensureDesktopPosSession();
    await vi.waitFor(() => expect(mocks.adopt).toHaveBeenCalledTimes(1));
    bumpSessionEpoch();
    finish({ ok: true });
    expect(await result).toMatchObject({ ok: false, error: "The signed-in user changed." });
  });
});
