import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ start: vi.fn(), status: vi.fn(), open: vi.fn() }));
vi.mock("@capacitor/core", async original => ({ ...await original<typeof import("@capacitor/core")>(),
  registerPlugin: () => ({ start: mocks.start, status: mocks.status }) }));
vi.mock("@capacitor-community/file-opener", () => ({ FileOpener: { open: mocks.open } }));
import { downloadAndInstall } from "@/platforms/mobile/android-updates";
import { downloadPercent } from "@/platforms/mobile/update-download";
const url = "https://updatecms.luckycharmsdnbhd.com/pos-app/latest/android/Retail-1.4.76.apk";
const file = "Retail-1.4.76.apk";
const pending = { status: "downloading", url, file, bytes: 45, total: 100 };
const complete = { ...pending, status: "complete", bytes: 100, uri: "file:///external/Download/Retail-1.4.76.apk" };
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers();
  mocks.open.mockResolvedValue(undefined);
  mocks.start.mockResolvedValue(pending);
  mocks.status.mockResolvedValue(complete);
});
afterEach(() => { vi.useRealTimers(); });

describe("Android background APK download", () => {
  it("reattaches at saved progress and opens only the completed APK", async () => {
    const progress = vi.fn();
    const download = downloadAndInstall(url, file, progress);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await download).toMatchObject({ opened: true, uri: complete.uri });
    expect(mocks.start).toHaveBeenCalledExactlyOnceWith({ url, file });
    expect(progress.mock.calls.flat()).toEqual([45, 100]);
    expect(mocks.open).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ filePath: complete.uri }));
  });
  it("keeps paused network jobs instead of restarting their bytes", async () => {
    mocks.status.mockResolvedValueOnce({ ...pending, status: "paused" });
    const progress = vi.fn();
    const download = downloadAndInstall(url, file, progress);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await download).toMatchObject({ opened: true });
    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(progress.mock.calls.flat()).toEqual([45, 45, 100]);
  });
  it("recovers an already completed download without downloading again", async () => {
    mocks.start.mockResolvedValue(complete);
    expect(await downloadAndInstall(url, file, vi.fn())).toMatchObject({ opened: true });
    expect(mocks.status).not.toHaveBeenCalled();
  });
  it("never installs failed or replaced jobs", async () => {
    mocks.start.mockResolvedValueOnce({ ...pending, status: "failed", error: "Not enough storage" });
    await expect(downloadAndInstall(url, file, vi.fn())).rejects.toThrow("Not enough storage");
    mocks.start.mockResolvedValueOnce({ ...pending, file: "another.apk" });
    await expect(downloadAndInstall(url, file, vi.fn())).rejects.toThrow("has changed");
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it("keeps the complete file available if installer permission is denied", async () => {
    mocks.start.mockResolvedValue(complete);
    mocks.open.mockRejectedValueOnce(new Error("Permission needed"));
    expect(await downloadAndInstall(url, file, vi.fn())).toMatchObject({ opened: false, uri: complete.uri, error: "Permission needed" });
  });
  it("does not report completion before Android confirms it", () => {
    expect(downloadPercent({ ...pending, status: "downloading", bytes: 100 })).toBe(99);
    expect(downloadPercent({ status: "downloading", bytes: 100, total: -1 })).toBe(0);
  });
});
