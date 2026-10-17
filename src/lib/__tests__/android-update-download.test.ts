import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ download: vi.fn(), stat: vi.fn(), remove: vi.fn(), deleteFile: vi.fn(), open: vi.fn(), progress: null as null | ((event: {url: string; bytes: number; contentLength: number}) => void) }));
vi.mock("@capacitor/filesystem", () => ({ Directory: { ExternalCache: "EXTERNAL_CACHE" }, Filesystem: {
  addListener: vi.fn(async (_event, listener) => { mocks.progress = listener; return { remove: mocks.remove }; }),
  downloadFile: mocks.download, stat: mocks.stat, deleteFile: mocks.deleteFile,
  getUri: vi.fn(async () => ({ uri: "file:///cache/update.apk" })),
} }));
vi.mock("@capacitor-community/file-opener", () => ({ FileOpener: { open: mocks.open } }));
import { downloadAndInstall } from "@/platforms/mobile/android-updates";
const url = "https://updatecms.luckycharmsdnbhd.com/update.apk";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.remove.mockResolvedValue(undefined); mocks.deleteFile.mockResolvedValue(undefined); mocks.open.mockResolvedValue(undefined);
  mocks.stat.mockResolvedValue({size: 100});
  mocks.download.mockImplementation(async () => {
    mocks.progress?.({url, bytes: 45, contentLength: 100});
    mocks.progress?.({url, bytes: 100, contentLength: 100});
  });
});
describe("Android native APK download", () => {
  it("streams directly to external cache and reports real progress before installation", async () => {
    const progress = vi.fn();
    expect(await downloadAndInstall(url, "update.apk", progress)).toMatchObject({opened: true});
    expect(mocks.download).toHaveBeenCalledWith(expect.objectContaining({url, path: "update.apk", directory: "EXTERNAL_CACHE", progress: true, readTimeout: 60000}));
    expect(progress.mock.calls.flat()).toEqual([0,45,99,100]);
    expect(mocks.open).toHaveBeenCalledOnce(); expect(mocks.remove).toHaveBeenCalledOnce();
  });
  it("removes partial files and listeners on network failure without opening installer", async () => {
    mocks.download.mockRejectedValueOnce(new Error("HTTP 403"));
    await expect(downloadAndInstall(url, "update.apk", vi.fn())).rejects.toThrow("HTTP 403");
    expect(mocks.deleteFile).toHaveBeenCalledOnce(); expect(mocks.remove).toHaveBeenCalledOnce(); expect(mocks.open).not.toHaveBeenCalled();
  });
  it("retries a software connection abort from a clean file", async () => {
    mocks.download.mockRejectedValueOnce(new Error("Software caused connection abort"));
    expect(await downloadAndInstall(url, "update.apk", vi.fn())).toMatchObject({opened: true});
    expect(mocks.download).toHaveBeenCalledTimes(2);
    expect(mocks.deleteFile).toHaveBeenCalledOnce();
  });
  it("stops after three aborted attempts and never opens installer", async () => {
    mocks.download.mockRejectedValue(new Error("Software caused connection abort"));
    await expect(downloadAndInstall(url, "update.apk", vi.fn())).rejects.toThrow("connection abort");
    expect(mocks.download).toHaveBeenCalledTimes(3);
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it("refuses incomplete downloaded files", async () => {
    mocks.stat.mockResolvedValue({size: 45});
    await expect(downloadAndInstall(url, "update.apk", vi.fn())).rejects.toThrow("did not finish saving");
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it("keeps a complete APK available when Android declines the installer", async () => {
    mocks.open.mockRejectedValueOnce(new Error("Permission needed"));
    expect(await downloadAndInstall(url, "update.apk", vi.fn())).toMatchObject({opened: false, uri: "file:///cache/update.apk", error: "Permission needed"});
    expect(mocks.deleteFile).not.toHaveBeenCalled();
  });
});
