import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ registration: vi.fn(), proof: vi.fn(), native: vi.fn() }));
vi.mock("@/core/activation/terminal-tokens", () => ({ readTerminalConfig: h.registration }));
vi.mock("@/core/activation/device-proof", () => ({ deviceProofHash: h.proof }));
import { readNativeTerminalProof } from "../native-terminal-proof";

beforeEach(() => {
  h.registration.mockReset().mockReturnValue(null);
  h.proof.mockReset().mockResolvedValue(null);
  h.native.mockReset();
});
afterEach(() => vi.unstubAllGlobals());
const registered = { tokenId: "terminal-a", locationId: "branch-a", deviceUse: "operations", deviceBindingProof: "aa".repeat(32) };
function windows() { vi.stubGlobal("window", { pos: { readTerminalConfig: h.native } }); h.registration.mockReturnValue({ ...registered }); }

describe("native registration proof handoff", () => {
  it("keeps web management unregistered without creating a device proof", async () => {
    expect(await readNativeTerminalProof()).toEqual({});
    expect(h.proof).not.toHaveBeenCalled();
  });

  it("uses the saved claim proof without requesting another key or exposing replica credentials", async () => {
    h.registration.mockReturnValue({
      tokenId: "terminal-a", deviceBindingProof: "AB".repeat(32),
      deviceClaimProof: "replica-secret", supabaseKey: "connection-key", locationId: "branch-a",
    });
    expect(await readNativeTerminalProof()).toEqual({ terminalToken: "terminal-a", deviceBindingProof: "ab".repeat(32) });
    expect(h.proof).not.toHaveBeenCalled();
  });

  it("recovers the existing device proof for a legacy registration without a stored copy", async () => {
    h.registration.mockReturnValue({ tokenId: "terminal-a" });
    h.proof.mockResolvedValue("cd".repeat(32));
    expect(await readNativeTerminalProof()).toEqual({ terminalToken: "terminal-a", deviceBindingProof: "cd".repeat(32) });
    expect(h.proof).toHaveBeenCalledOnce();
  });

  it("retains terminal identity when a proof is unavailable so the server can refuse registration verification", async () => {
    h.registration.mockReturnValue({ tokenId: "terminal-a" });
    expect(await readNativeTerminalProof()).toEqual({ terminalToken: "terminal-a" });
  });

  it("uses fresh same-binding Main proof instead of the stale renderer proof without writes or key generation", async () => {
    windows(); h.native.mockResolvedValue({ ok: true, config: { ...registered, deviceBindingProof: "BC".repeat(32), deviceClaimProof: "private-replica", supabaseKey: "private-key" } });
    expect(await readNativeTerminalProof()).toEqual({ terminalToken: "terminal-a", deviceBindingProof: "bc".repeat(32) });
    expect(h.native).toHaveBeenCalledOnce(); expect(h.proof).not.toHaveBeenCalled();
    expect(h.registration()).toEqual(registered);
  });

  it("waits for the native read and rejects binding changes while it is pending", async () => {
    windows(); let finish!: (value: unknown) => void;
    h.native.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const pending = readNativeTerminalProof();
    expect(h.proof).not.toHaveBeenCalled();
    h.registration.mockReturnValue({ ...registered, locationId: "branch-b" });
    finish({ ok: true, config: registered });
    await expect(pending).rejects.toMatchObject({ code: "EACTIVATION_BINDING", status: 403 });
  });

  it.each([
    null, {}, { ...registered, tokenId: "terminal-b" }, { ...registered, locationId: "branch-b" },
    { ...registered, branchId: "branch-b" }, { ...registered, deviceUse: "management" },
    { ...registered, deviceType: "mobile" }, { ...registered, deviceType: "unexpected" },
    { ...registered, deviceBindingProof: "malformed-private-proof" },
  ])("rejects missing or mismatched native registration %j", async config => {
    windows(); h.native.mockResolvedValue({ ok: true, config });
    await expect(readNativeTerminalProof()).rejects.toMatchObject({ code: "EACTIVATION_BINDING", status: 403 });
    expect(h.proof).not.toHaveBeenCalled();
  });

  it.each([null, [], {}, { ok: false, config: registered, error: "private-native-error" }])("fails unavailable when native storage cannot be read: %j", async result => {
    windows(); h.native.mockResolvedValue(result);
    await expect(readNativeTerminalProof()).rejects.toMatchObject({ code: "EAUTH_UNAVAILABLE", status: 503 });
    expect(h.proof).not.toHaveBeenCalled();
  });

  it("sanitizes native read exceptions and never derives a replacement proof", async () => {
    windows(); h.native.mockRejectedValue(new Error("private-native-error"));
    await expect(readNativeTerminalProof()).rejects.toMatchObject({ code: "EAUTH_UNAVAILABLE", status: 503 });
    await expect(readNativeTerminalProof()).rejects.not.toThrow("private-native-error");
    expect(h.proof).not.toHaveBeenCalled();
  });

  it("accepts equivalent UUID casing and legacy branch aliases without changing the renderer", async () => {
    windows(); const token = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", branch = "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB";
    h.registration.mockReturnValue({ ...registered, tokenId: token, locationId: branch });
    h.native.mockResolvedValue({ ok: true, config: { tokenId: token.toLowerCase(), branchId: branch.toLowerCase(), deviceBindingProof: "cc".repeat(32) } });
    expect(await readNativeTerminalProof()).toEqual({ terminalToken: token, deviceBindingProof: "cc".repeat(32) });
  });

  it("retains same-binding legacy Main missing-proof behavior", async () => {
    windows(); h.native.mockResolvedValue({ ok: true, config: { tokenId: "terminal-a", locationId: "branch-a" } });
    expect(await readNativeTerminalProof()).toEqual({ terminalToken: "terminal-a", deviceBindingProof: registered.deviceBindingProof });
    expect(h.proof).not.toHaveBeenCalled();
    h.registration.mockReturnValue({ tokenId: "terminal-a", locationId: "branch-a" }); h.proof.mockResolvedValue("dd".repeat(32));
    expect(await readNativeTerminalProof()).toEqual({ terminalToken: "terminal-a", deviceBindingProof: "dd".repeat(32) });
  });

  it("retains mobile behavior even with a window.pos shim", async () => {
    windows(); vi.stubGlobal("window", { pos: { readTerminalConfig: h.native }, Capacitor: { isNativePlatform: () => true, getPlatform: () => "android" } });
    expect(await readNativeTerminalProof()).toEqual({ terminalToken: "terminal-a", deviceBindingProof: registered.deviceBindingProof });
    expect(h.native).not.toHaveBeenCalled();
  });

  it("keeps old Windows bridges without a native read method on the existing path", async () => {
    windows(); vi.stubGlobal("window", { pos: {} });
    expect(await readNativeTerminalProof()).toEqual({ terminalToken: "terminal-a", deviceBindingProof: registered.deviceBindingProof });
  });

  it("rejects a renderer platform change while the native read is pending", async () => {
    windows(); let finish!: (value: unknown) => void;
    h.native.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const pending = readNativeTerminalProof();
    h.registration.mockReturnValue({ ...registered, deviceType: "mobile" });
    finish({ ok: true, config: { ...registered, deviceType: "pc" } });
    await expect(pending).rejects.toMatchObject({ code: "EACTIVATION_BINDING", status: 403 });
    expect(h.proof).not.toHaveBeenCalled();
  });

  it("rejects a mobile renderer binding on Electron even if the native identity matches it", async () => {
    windows(); h.registration.mockReturnValue({ ...registered, deviceType: "mobile" });
    h.native.mockResolvedValue({ ok: true, config: { ...registered, deviceType: "mobile" } });
    await expect(readNativeTerminalProof()).rejects.toMatchObject({ code: "EACTIVATION_BINDING", status: 403 });
    expect(h.native).not.toHaveBeenCalled(); expect(h.proof).not.toHaveBeenCalled();
  });
});
