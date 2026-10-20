import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  values: new Map<string, string>(),
  proof: "session-a",
  terminal: "11111111-1111-4111-8111-111111111111",
  project: "https://project.test",
  mobile: true,
  fetch: vi.fn(),
}));
vi.mock("capacitor-secure-storage-plugin", () => ({
  SecureStoragePlugin: {
    get: async ({ key }: { key: string }) => {
      if (!fixture.values.has(key)) throw new Error("not found");
      return { value: fixture.values.get(key) };
    },
    set: async ({ key, value }: { key: string; value: string }) => {
      fixture.values.set(key, value);
      return { value: true };
    },
    remove: async ({ key }: { key: string }) => {
      fixture.values.delete(key);
      return { value: true };
    },
  },
}));
vi.mock("../server-origin", () => ({ posFetch: (...args: unknown[]) => fixture.fetch(...args) }));
vi.mock("@/core/activation/terminal-tokens", () => ({
  readTerminalConfig: () => ({ tokenId: fixture.terminal }),
}));
vi.mock("../external-supabase-config", () => ({
  supabaseConfig: () => ({ url: fixture.project }),
}));
vi.mock("../pos-caller-auth", () => ({
  getPosCallerAuth: async () => ({ sessionToken: fixture.proof, terminalToken: fixture.terminal }),
}));
vi.mock("@/platform-config/features", () => ({ isMobileShell: () => fixture.mobile, isWindowsShell: () => false }));
vi.mock("../secure-cloud-config", () => ({
  isMissingSecureValue: (error: Error) => error.message === "not found",
}));
import {
  enrollOwnApprovalToken,
  loadApprovalToken,
  clearApprovalToken,
} from "../approval-token-client";
beforeEach(() => {
  fixture.values.clear();
  fixture.proof = "session-a";
  fixture.project = "https://project.test";
  fixture.mobile = true;
  fixture.terminal = "11111111-1111-4111-8111-111111111111";
  fixture.fetch.mockReset();
  fixture.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      ok: true,
      credential: {
        id: "credential-a",
        userId: "manager",
        name: "Manager",
        terminalId: fixture.terminal,
        branchId: "branch-a",
        secret: Buffer.from("12345678901234567890").toString("base64"),
        validUntil: Date.now() + 86400000,
      },
    }),
  });
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", { onLine: true });
});
afterEach(() => vi.unstubAllGlobals());
describe("native phone approval enrollment (Android Keystore / iOS Keychain)", () => {
  it("uses secure enrollment offline with the same registered user session", async () => {
    await enrollOwnApprovalToken("manager");
    Object.assign(navigator, { onLine: false });
    expect((await loadApprovalToken())?.userId).toBe("manager");
    expect(fixture.fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects another session, device or project and clears enrollment on logout", async () => {
    await enrollOwnApprovalToken("manager");
    fixture.proof = "session-b";
    expect(await loadApprovalToken()).toBe(null);
    fixture.proof = "session-a";
    fixture.project = "https://other.test";
    expect(await loadApprovalToken()).toBe(null);
    fixture.project = "https://project.test";
    fixture.terminal = "22222222-2222-4222-8222-222222222222";
    expect(await loadApprovalToken()).toBe(null);
    await clearApprovalToken();
    expect(fixture.values.size).toBe(0);
  });
  it("never enrolls an identity different from the signed-in user", async () => {
    await expect(enrollOwnApprovalToken("cashier")).rejects.toThrow("identity changed");
    expect(fixture.values.size).toBe(0);
  });
  it("keeps browsers out of offline token storage", async () => {
    fixture.mobile = false;
    await enrollOwnApprovalToken("manager");
    expect(await loadApprovalToken()).toBe(null);
    expect(fixture.fetch).not.toHaveBeenCalled();
  });
  it("removes cached enrollment when the server disables this user's token permission", async () => {
    await enrollOwnApprovalToken("manager");
    fixture.fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true, credential: null }) });
    await enrollOwnApprovalToken("manager");
    expect(await loadApprovalToken()).toBeNull();
    expect(fixture.values.size).toBe(0);
  });
  it("refuses an expired offline enrollment", async () => {
    await enrollOwnApprovalToken("manager");
    for (const [key, raw] of fixture.values) {
      fixture.values.set(key, JSON.stringify({ ...JSON.parse(raw), validUntil: Date.now() - 1 }));
    }
    expect(await loadApprovalToken()).toBeNull();
  });
});
