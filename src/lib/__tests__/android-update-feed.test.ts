import { beforeEach, describe, expect, it, vi } from "vitest";
const { manifest, exists, json } = vi.hoisted(() => ({ manifest: vi.fn(), exists: vi.fn(), json: vi.fn() }));
vi.mock("@/lib/app-updates", () => ({ APP_VERSION: "1.4.70" }));
vi.mock("@/platforms/mobile/native-http", () => ({ describeNetworkError: String, firstReachableUrl: vi.fn(), httpGetBase64: vi.fn(), httpGetJson: json, httpExists: exists }));
vi.mock("@/lib/update-manifest", async (original) => ({ ...await original<typeof import("../update-manifest")>(), fetchManifest: manifest }));
import { fetchLatest } from "@/platforms/mobile/android-updates";
const apkUrl = "https://updatecms.luckycharmsdnbhd.com/pos-app/latest/android/Retail-1.4.72.apk";
beforeEach(() => { vi.resetAllMocks(); manifest.mockResolvedValue({ version: "1.4.72", apkUrl }); json.mockResolvedValue({ version: "1.4.71", file: "Retail-1.4.71.apk" }); });
describe("Android update feed recovery", () => {
  it("uses a verified advertised APK", async () => {
    exists.mockResolvedValue(true);
    expect(await fetchLatest()).toMatchObject({ version: "1.4.72", url: apkUrl });
    expect(json).not.toHaveBeenCalled();
  });
  it("uses the completed platform feed when the shared APK is missing", async () => {
    exists.mockResolvedValue(false);
    expect(await fetchLatest()).toMatchObject({ version: "1.4.71", file: "Retail-1.4.71.apk", url: null });
  });
  it("does not invent an APK URL when a manifest has only Windows", async () => {
    manifest.mockResolvedValue({ version: "1.4.72", windowsUrl: "https://example.invalid/setup.exe" });
    expect(await fetchLatest()).toMatchObject({ version: "1.4.71" });
    expect(exists).not.toHaveBeenCalled();
  });
});
