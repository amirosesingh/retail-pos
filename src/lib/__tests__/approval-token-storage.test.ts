import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  values: new Map<string, string>(),
  proof: "session-a",
  terminal: "11111111-1111-4111-8111-111111111111",
  project: "https://project.test",
  mobile: true,
  windows: false,
  management: false,
  receiver: false,
  registerReceiver: vi.fn(),
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
  readTerminalConfig: () => ({ tokenId: fixture.terminal,
    deviceUse: fixture.management ? "management" : "operations", locationId: fixture.management ? "" : "branch-a" }),
}));
vi.mock("../external-supabase-config", () => ({
  supabaseConfig: () => ({ url: fixture.project }),
}));
vi.mock("../pos-caller-auth", () => ({
  getPosCallerAuth: async () => ({ sessionToken: fixture.proof, terminalToken: fixture.terminal }),
}));
vi.mock("@/platform-config/features", () => ({ isMobileShell: () => fixture.mobile, isWindowsShell: () => fixture.windows }));
vi.mock("../secure-cloud-config", () => ({
  isMissingSecureValue: (error: Error) => error.message === "not found",
}));
vi.mock("@/core/local-db/local-db", () => ({ localDb: () => fixture.receiver ? { enrollApprovalVerifier: fixture.registerReceiver } : null }));
import {
  enrollOwnApprovalToken,
  loadApprovalToken,
  clearApprovalToken, setupOfflineApprovalToken, unlockOfflineApprovalToken, offlineTokenOwner,
  revalidateOfflineApprovalToken,
} from "../approval-token-client";
beforeEach(() => {
  fixture.values.clear();
  fixture.proof = "session-a";
  fixture.project = "https://project.test";
  fixture.mobile = true;
  fixture.windows = false;
  fixture.management = false;
  fixture.receiver = false;
  fixture.registerReceiver.mockReset().mockResolvedValue({ ok: true });
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
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
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

it("retains only a locked token on logout, unlocks offline without signing in, and clears on unpair", async () => {
  await enrollOwnApprovalToken("manager");
  await setupOfflineApprovalToken("874392");
  const raw = fixture.values.get("pos.approval-token.locked.v1")!;
  expect(raw).not.toContain(Buffer.from("12345678901234567890").toString("base64"));
  await clearApprovalToken(); fixture.proof = "";
  Object.assign(navigator, { onLine: false });
  expect(await loadApprovalToken()).toBeNull();
  expect((await offlineTokenOwner())?.userId).toBe("manager");
  expect((await unlockOfflineApprovalToken("874392")).userId).toBe("manager");
  expect(fixture.proof).toBe("");
  await clearApprovalToken(true);
  expect(await offlineTokenOwner()).toBeNull();
});
it("keeps a device-bound token offline for 30 days and then requires online renewal", async () => {
  const enrolledAt = Date.now();
  await enrollOwnApprovalToken("manager"); await setupOfflineApprovalToken("874392");
  await clearApprovalToken(); fixture.proof = "";
  Object.assign(navigator, { onLine: false });
  vi.spyOn(Date, "now").mockReturnValue(enrolledAt + 25 * 86400000);
  expect((await offlineTokenOwner())?.userId).toBe("manager");
  expect((await unlockOfflineApprovalToken("874392")).userId).toBe("manager");
  vi.spyOn(Date, "now").mockReturnValue(enrolledAt + 31 * 86400000);
  expect(await offlineTokenOwner()).toMatchObject({ userId: "manager", expired: true });
  await expect(unlockOfflineApprovalToken("874392")).rejects.toThrow("Connect to the internet to renew the soft token");
});
it("renews the saved device token after a successful online permission check", async () => {
  const enrolledAt = Date.now();
  await enrollOwnApprovalToken("manager"); await setupOfflineApprovalToken("874392");
  vi.spyOn(Date, "now").mockReturnValue(enrolledAt + 25 * 86400000);
  fixture.fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true, active: true }) });
  await revalidateOfflineApprovalToken();
  expect((await offlineTokenOwner())?.validUntil).toBeGreaterThan(enrolledAt + 30 * 86400000);
  await clearApprovalToken(); fixture.proof = "";
  Object.assign(navigator, { onLine: false });
  vi.spyOn(Date, "now").mockReturnValue(enrolledAt + 31 * 86400000);
  expect((await offlineTokenOwner())?.userId).toBe("manager");
});
it("removes an offline token when its device enrollment is revoked online", async () => {
  await enrollOwnApprovalToken("manager"); await setupOfflineApprovalToken("874392");
  await clearApprovalToken(); fixture.proof = "";
  fixture.fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true, active: false }) });
  await revalidateOfflineApprovalToken();
  expect(await offlineTokenOwner()).toBeNull();
});
it("does not renew or delete a saved token when the status service is unreachable", async () => {
  await enrollOwnApprovalToken("manager"); await setupOfflineApprovalToken("874392");
  const lease = (await offlineTokenOwner())!.validUntil;
  fixture.fetch.mockRejectedValue(new Error("network unavailable"));
  await expect(revalidateOfflineApprovalToken()).rejects.toThrow("network unavailable");
  expect((await offlineTokenOwner())?.validUntil).toBe(lease);
});
it("persists failed unlock attempts and checks the device, project and permission", async () => {
  await enrollOwnApprovalToken("manager"); await setupOfflineApprovalToken("874392");
  await expect(unlockOfflineApprovalToken("111111")).rejects.toThrow("Incorrect");
  await expect(unlockOfflineApprovalToken("874392")).rejects.toThrow("Too many");
  fixture.project = "https://wrong.test";
  expect(await offlineTokenOwner()).toBeNull();
  fixture.project = "https://project.test";
  fixture.fetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true, credential: null }) });
  await enrollOwnApprovalToken("manager");
  expect(await offlineTokenOwner()).toBeNull();
});
it("deduplicates concurrent enrollment requests", async () => {
  await Promise.all([enrollOwnApprovalToken("manager"), enrollOwnApprovalToken("manager")]);
  expect(fixture.fetch).toHaveBeenCalledTimes(1);
});

it("management Windows can provision and unlock its own token without a local SQL bridge", async () => {
 fixture.windows = true; fixture.mobile = false; fixture.management = true;
 await enrollOwnApprovalToken("manager");
 expect((await loadApprovalToken())?.userId).toBe("manager");
 await setupOfflineApprovalToken("874392");
 await clearApprovalToken(); fixture.proof = "";
 expect((await unlockOfflineApprovalToken("874392")).userId).toBe("manager");
 expect(await loadApprovalToken()).toBeNull();
 await clearApprovalToken(true); expect(await offlineTokenOwner()).toBeNull();
});

it("keeps branch-PC approval receiving while suppressing token issuance and saved-token visibility", async () => {
  await enrollOwnApprovalToken("manager");
  await setupOfflineApprovalToken("874392");
  fixture.windows = true; fixture.mobile = false; fixture.management = false; fixture.receiver = true;
  fixture.fetch.mockClear();
  await enrollOwnApprovalToken("manager");
  expect(fixture.registerReceiver).toHaveBeenCalledOnce();
  expect(fixture.fetch).not.toHaveBeenCalled();
  expect(await loadApprovalToken()).toBeNull();
  expect(await offlineTokenOwner()).toBeNull();
  await expect(unlockOfflineApprovalToken("874392")).rejects.toThrow("not available on this device");
  await revalidateOfflineApprovalToken();
  expect(fixture.fetch).not.toHaveBeenCalled();
});
