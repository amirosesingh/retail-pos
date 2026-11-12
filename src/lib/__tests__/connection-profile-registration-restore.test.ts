import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
  terminal: vi.fn(), cloud: vi.fn(), backend: vi.fn(), order: [] as string[],
  project: "", backendUrl: "", savedProject: "https://current.example", savedBackend: "https://current-pos.example",
}));
vi.mock("@/platform-config/platform", () => ({ isTerminalApp: () => true }));
vi.mock("@/platforms/mobile/mobile-storage", () => ({ hydrateNativeStorage: async () => {}, flushNativeStorage: async () => {} }));
vi.mock("@/core/activation/terminal-tokens", () => ({ hydrateTerminalConfig: f.terminal }));
vi.mock("../secure-cloud-config", () => ({ initCloudConfigFromShell: f.cloud }));
vi.mock("../backend-config", () => ({ hydrateBackendUrl: f.backend }));
import { __resetProfileHydrationForTests, hydrateConnectionProfile, isConnectionProfileHydrated, RegistrationRestoreError, registrationRestoreMessage } from "../connection-profile";

beforeEach(() => {
  __resetProfileHydrationForTests();
  f.order = []; f.project = ""; f.backendUrl = "";
  f.savedProject = "https://current.example"; f.savedBackend = "https://current-pos.example";
  f.terminal.mockReset().mockImplementation(async () => { f.order.push("registration"); });
  f.cloud.mockReset().mockImplementation(async () => { f.order.push("cloud"); f.project = f.savedProject; });
  f.backend.mockReset().mockImplementation(async () => { f.order.push("backend"); f.backendUrl = f.savedBackend; });
});
afterEach(() => vi.useRealTimers());

describe("real connection profile coordinator with failed registration recovery", () => {
  it("reads saved connection values despite registration failure while keeping ordinary boot closed", async () => {
    f.terminal.mockRejectedValueOnce(new Error("Original proof could not be verified"));
    await expect(hydrateConnectionProfile()).rejects.toBeInstanceOf(RegistrationRestoreError);
    expect(f.cloud).toHaveBeenCalledOnce(); expect(f.backend).toHaveBeenCalledOnce();
    expect(f.project).toBe(f.savedProject); expect(f.backendUrl).toBe(f.savedBackend);
    expect(isConnectionProfileHydrated()).toBe(false);
  });

  it("does not certify connection readiness when its actual vault read also fails", async () => {
    vi.useFakeTimers();
    f.terminal.mockRejectedValueOnce(new Error("Registration pending"));
    f.cloud.mockRejectedValue(new Error("Cloud vault unreadable"));
    const restore = hydrateConnectionProfile().catch(error => error);
    await vi.advanceTimersByTimeAsync(600);
    expect(await restore).toMatchObject({ message: "Cloud vault unreadable" });
    expect(await restore).not.toBeInstanceOf(RegistrationRestoreError);
    expect(f.cloud).toHaveBeenCalledTimes(3); expect(f.backend).toHaveBeenCalledTimes(3);
    expect(isConnectionProfileHydrated()).toBe(false);
  });

  it("does not certify connection readiness when the saved backend cannot be read", async () => {
    vi.useFakeTimers();
    f.backend.mockRejectedValue(new Error("Backend vault unreadable"));
    const restore = hydrateConnectionProfile().catch(error => error);
    await vi.advanceTimersByTimeAsync(600);
    expect(await restore).not.toBeInstanceOf(RegistrationRestoreError);
    expect(isConnectionProfileHydrated()).toBe(false);
  });

  it("recognizes genuine registration absence only after both connection reads finish", async () => {
    f.terminal.mockResolvedValueOnce(null);
    await hydrateConnectionProfile();
    expect(f.order).toEqual(["cloud", "backend"]);
    expect(isConnectionProfileHydrated()).toBe(true);
  });

  it("reapplies the current operator connection after an older activation is restored", async () => {
    f.terminal.mockImplementationOnce(async () => { f.order.push("registration"); f.project = "https://previous.example"; f.backendUrl = "https://previous-pos.example"; });
    await hydrateConnectionProfile();
    expect(f.order).toEqual(["registration", "cloud", "backend"]);
    expect(f.project).toBe(f.savedProject); expect(f.backendUrl).toBe(f.savedBackend);
  });

  it("retries the same registration after a saved connection correction without resetting state", async () => {
    f.terminal.mockRejectedValueOnce(new Error("Registration pending"));
    await expect(hydrateConnectionProfile()).rejects.toBeInstanceOf(RegistrationRestoreError);
    f.savedProject = "https://corrected.example"; f.savedBackend = "https://corrected-pos.example";
    await hydrateConnectionProfile();
    expect(f.terminal).toHaveBeenCalledTimes(2);
    expect(f.project).toBe(f.savedProject); expect(f.backendUrl).toBe(f.savedBackend);
    expect(isConnectionProfileHydrated()).toBe(true);
  });

  it.each([
    ["EACTIVATION_RECOVERY_BINDING", "previous terminal binding"],
    ["EACTIVATION_RECOVERY_PROOF", "original saved registration proof"],
    ["EACTIVATION_RECOVERY_VERIFY", "POS website could not verify"],
    ["EACTIVATION_RECOVERY_PROJECT", "different database connection"],
    ["EACTIVATION_CONTEXT_CHANGED", "changed during recovery"],
    ["EACTIVATION_STORE", "Windows could not read"],
  ])("preserves safe registration reason %s without forwarding private details", async (code, text) => {
    f.terminal.mockRejectedValueOnce(Object.assign(new Error("private-proof secret https://private.example"), { code }));
    const error = await hydrateConnectionProfile().catch(cause => cause);
    expect(error).toBeInstanceOf(RegistrationRestoreError);
    expect(error).toMatchObject({ code: "EREGISTRATION_RESTORE", registrationCode: code });
    expect(error.message).toContain(text);
    expect(error.message).not.toMatch(/private-proof|secret|https:\/\/private/);
    expect(f.cloud).toHaveBeenCalledOnce(); expect(f.backend).toHaveBeenCalledOnce();
    expect(isConnectionProfileHydrated()).toBe(false);
  });

  it("uses a fixed generic registration reason for unknown native details", () => {
    const error = new RegistrationRestoreError({ code: "private-secret-value", message: "https://private.example" });
    expect(error.registrationCode).toBe("EREGISTRATION_UNKNOWN");
    expect(error.message).toBe(registrationRestoreMessage("EREGISTRATION_UNKNOWN"));
    expect(error.message).not.toMatch(/private-secret|https:/);
  });
});
