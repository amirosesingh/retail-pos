import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { validateManifest, newer, fetchManifest, inRollout, type Trust } from "../manifest";
import { IosOtaService, type Dependencies } from "../service";
const keys = generateKeyPairSync("ed25519");
const trust: Trust = {
  publicKey: Buffer.from(keys.publicKey.export({ format: "jwk" }).x!, "base64url").toString(
    "base64",
  ),
  appId: "com.luckycharms.pos.beta",
  channel: "staging",
  build: "1",
  nativeVersion: "1.4.74",
  origin: "https://updatecms.luckycharmsdnbhd.com",
  endpoint: "https://updatecms.luckycharmsdnbhd.com/pos-app/ios-ota/staging/manifest.json",
};
const make = () => ({
  schema: 1 as const,
  version: "1.4.75-beta.100",
  appId: trust.appId,
  platform: "ios" as const,
  channel: "staging" as const,
  url: `${trust.origin}/pos-app/ios-ota/releases/1.4.75-beta.100/bundle.zip`,
  checksum: "a".repeat(64),
  size: 100,
  notes: "Test",
  minBuild: 1,
  maxBuild: 1,
  issuedAt: Date.now(),
  expiresAt: Date.now() + 100000,
  rollout: { percent: 100, salt: "test", stopped: false },
});
const envelope = (value: unknown) => {
  const payload = Buffer.from(JSON.stringify(value));
  return JSON.stringify({
    payload: payload.toString("base64"),
    signature: sign(null, payload, keys.privateKey).toString("base64"),
  });
};
describe("signed manifest", () => {
  it("compares semantic prerelease versions numerically", () => {
    expect(newer("1.4.75-beta.10", "1.4.75-beta.9")).toBe(true);
    expect(newer("1.4.75-beta.10", "1.4.75")).toBe(false);
    expect(newer("invalid", "1.0.0")).toBe(false);
  });
  it("accepts a valid signed compatible release", async () => {
    expect((await validateManifest(envelope(make()), trust, "1.4.74", "1.4.74")).version).toBe(
      "1.4.75-beta.100",
    );
  });
  it.each([
    { platform: "android" },
    { channel: "production" },
    { minBuild: 2 },
    { maxBuild: 0 },
    { expiresAt: 1 },
    { version: "not-a-version" },
    { url: "http://evil.test/bundle.zip" },
    { checksum: "bad" },
    { size: 100000001 },
  ])("rejects invalid or incompatible metadata %o", async (change) => {
    await expect(
      validateManifest(envelope({ ...make(), ...change }), trust, "1.4.74", "1.4.74"),
    ).rejects.toThrow();
  });
  it("rejects a forged signature", async () => {
    const bad = JSON.parse(envelope(make()));
    bad.signature = Buffer.alloc(64).toString("base64");
    await expect(validateManifest(JSON.stringify(bad), trust, "1.4.74", "1.4.74")).rejects.toThrow(
      /signature/,
    );
  });
  it("rejects downgrade after restoring the built-in bundle", async () => {
    await expect(validateManifest(envelope(make()), trust, "1.4.74", "1.4.76")).rejects.toThrow(
      /Downgrade/,
    );
  });
  it("rejects oversized streamed response without Content-Length", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("x".repeat(40000)));
    await expect(fetchManifest(trust.endpoint, trust.origin, fetcher)).rejects.toThrow(/large/);
  });
  it("honours rollout and emergency stop", async () => {
    const m = make();
    expect(await inRollout(m, "device")).toBe(true);
    m.rollout.stopped = true;
    expect(await inRollout(m, "device")).toBe(false);
  });
});
describe("controlled updater", () => {
  let updater: Dependencies["updater"];
  let deps: Dependencies;
  let service: IosOtaService;
  beforeEach(() => {
    const b = {
      id: "bundle-id",
      version: make().version,
      checksum: "a".repeat(64),
      status: "pending",
      downloaded: "today",
    };
    updater = {
      notifyAppReady: vi.fn().mockResolvedValue({}),
      current: vi.fn().mockResolvedValue({ bundle: { ...b, id: "builtin" }, native: "1.4.74" }),
      getFailedUpdate: vi.fn().mockResolvedValue(null),
      download: vi.fn().mockResolvedValue(b),
      set: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn().mockResolvedValue(undefined),
      addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }),
    } as unknown as Dependencies["updater"];
    deps = {
      updater,
      trust: vi.fn().mockResolvedValue(trust),
      load: vi.fn().mockResolvedValue({
        highest: "1.4.74", failed: [], device: "test", silentDownload: false,
        autoInstall: false, downloadPreferenceSet: true,
      }),
      save: vi.fn().mockResolvedValue(undefined),
      safe: () => true,
      preserve: vi.fn().mockResolvedValue(undefined),
      online: () => true,
      fetch: vi.fn().mockImplementation(() => Promise.resolve(new Response(envelope(make())))),
      delay: vi.fn().mockResolvedValue(undefined),
    };
    service = new IosOtaService(deps);
  });
  it("acknowledges startup before network checks", async () => {
    await service.boot();
    expect(updater.notifyAppReady).toHaveBeenCalledOnce();
    expect(deps.fetch).not.toHaveBeenCalled();
  });
  it("reports the paired beta bundle version instead of the native marketing version", async () => {
    deps.builtinVersion = "1.4.75-beta.16";
    await service.boot();
    expect(service.state.installed).toBe("1.4.75-beta.16");
    await service.restore(true, true);
    expect(vi.mocked(deps.save).mock.lastCall?.[0].failed).not.toContain("1.4.75-beta.16");
  });
  it("reports the active OTA version after replacing the built-in interface", async () => {
    deps.builtinVersion = "1.4.75-beta.16";
    vi.mocked(updater.current).mockResolvedValue({
      bundle: { id: "ota", version: "1.4.75-beta.17", checksum: "", status: "success", downloaded: "" },
      native: "1.4.74",
    });
    await service.boot();
    expect(service.state.installed).toBe("1.4.75-beta.17");
  });
  it("checks, verifies and installs using set once", async () => {
    await service.check(true);
    await service.download();
    expect(service.state.phase).toBe("ready");
    await service.install();
    expect(deps.preserve).toHaveBeenCalledOnce();
    expect(updater.set).toHaveBeenCalledWith({ id: "bundle-id" });
  });
  it.each(["Invalid ZIP archive", "Checksum mismatch", "No storage space"])(
    "rejects %s without retry or activation",
    async (error) => {
      vi.mocked(updater.download).mockRejectedValue(new Error(error));
      await service.check(true);
      await service.download();
      expect(service.state.phase).toBe("error");
      expect(updater.download).toHaveBeenCalledOnce();
      expect(updater.set).not.toHaveBeenCalled();
    },
  );
  it("rejects mismatching returned checksum", async () => {
    vi.mocked(updater.download).mockResolvedValue({
      id: "x",
      version: make().version,
      checksum: "b".repeat(64),
      status: "pending",
      downloaded: "",
    });
    await service.check(true);
    await service.download();
    expect(service.state.phase).toBe("error");
    expect(updater.set).not.toHaveBeenCalled();
  });
  it("handles offline without attempting download", async () => {
    deps.online = () => false;
    await service.check(true);
    expect(service.state.error).toMatch(/Offline/);
    expect(updater.download).not.toHaveBeenCalled();
  });
  it("retries interrupted downloads with a limit", async () => {
    vi.mocked(updater.download).mockRejectedValue(new Error("Connection interrupted"));
    await service.check(true);
    await service.download();
    expect(updater.download).toHaveBeenCalledTimes(3);
    expect(service.state.phase).toBe("error");
  });
  it("defers install while unsaved work is active", async () => {
    deps.safe = () => false;
    await service.check(true);
    await service.download();
    await service.install();
    expect(service.state.phase).toBe("ready");
    expect(updater.set).not.toHaveBeenCalled();
  });
  it("records startup rollback and avoids failed version loops", async () => {
    vi.mocked(updater.getFailedUpdate).mockResolvedValue({
      bundle: { id: "bad", version: make().version, checksum: "", downloaded: "", status: "error" },
    });
    await service.check(true);
    expect(service.state.error).toMatch(/previously failed/);
    expect(updater.download).not.toHaveBeenCalled();
    expect(deps.save).toHaveBeenCalledWith(expect.objectContaining({ failed: [make().version] }));
  });
  it("prevents concurrent checks", async () => {
    await Promise.all([service.check(true), service.check(true)]);
    expect(deps.fetch).toHaveBeenCalledOnce();
  });
  it("rechecks emergency stop before activation", async () => {
    await service.check(true);
    await service.download();
    vi.mocked(deps.fetch!).mockImplementation(
      async () =>
        new Response(envelope({ ...make(), rollout: { ...make().rollout, stopped: true } })),
    );
    await service.install();
    expect(updater.set).not.toHaveBeenCalled();
  });
  it("requires confirmation for built-in restore", async () => {
    await service.restore(true, false);
    expect(updater.reset).not.toHaveBeenCalled();
    await service.restore(true, true);
    expect(updater.reset).toHaveBeenCalledWith({ toLastSuccessful: false });
  });
  it("never activates when saving an active draft fails", async () => {
    await service.check(true);
    await service.download();
    vi.mocked(deps.preserve).mockRejectedValue(new Error("Draft save failed"));
    await service.install();
    expect(updater.set).not.toHaveBeenCalled();
    expect(service.state.error).toMatch(/Draft save failed/);
  });
  it("rechecks the active screen after asynchronous preservation", async () => {
    await service.check(true);
    await service.download();
    vi.mocked(deps.preserve).mockImplementation(async () => {
      deps.safe = () => false;
    });
    await service.install();
    expect(updater.set).not.toHaveBeenCalled();
    expect(service.state.error).toMatch(/screen changed/);
  });
  it("debounces foreground checks while allowing explicit checks", async () => {
    await service.check();
    await service.check();
    expect(deps.fetch).toHaveBeenCalledOnce();
    await service.check(true);
    expect(deps.fetch).toHaveBeenCalledTimes(2);
  });
  it("silent download still defers automatic activation during work", async () => {
    await service.preferences(true, true);
    deps.safe = () => false;
    await service.check(true);
    expect(updater.download).toHaveBeenCalledOnce();
    expect(service.state.phase).toBe("ready");
    expect(service.state.deferred).toBeTruthy();
    expect(updater.set).not.toHaveBeenCalled();
  });
  it("downloads automatically on a fresh installation but waits for the install tap", async () => {
    vi.mocked(deps.load).mockResolvedValue(null);
    await service.check(true);
    expect(updater.download).toHaveBeenCalledOnce();
    expect(service.state.phase).toBe("ready");
    expect(updater.set).not.toHaveBeenCalled();
    expect(service.settings().silentDownload).toBe(true);
  });
  it("moves the legacy download default once without overriding a later opt-out", async () => {
    vi.mocked(deps.load).mockResolvedValue({
      highest: "1.4.74", failed: [], device: "test", silentDownload: false, autoInstall: false,
    });
    await service.check(true);
    expect(updater.download).toHaveBeenCalledOnce();
    await service.preferences(false, false);
    expect(service.settings().silentDownload).toBe(false);
    expect(deps.save).toHaveBeenCalledWith(expect.objectContaining({ downloadPreferenceSet: true }));
  });
  it("detects rollback from persisted pending activation even without a native event", async () => {
    vi.mocked(deps.load).mockResolvedValue({
      highest: "1.4.74",
      failed: [],
      pending: make().version,
      device: "test",
      silentDownload: false,
      autoInstall: false,
    });
    await service.check(true);
    expect(service.state.error).toMatch(/previously failed/);
    expect(updater.download).not.toHaveBeenCalled();
  });
});
