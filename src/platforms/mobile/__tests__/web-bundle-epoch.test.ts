import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Filesystem } from "@capacitor/filesystem";
import { BUNDLE_EPOCH, isBundleEpochCompatible } from "@/lib/bundle-epoch";
import {
  bundleDecision,
  legacyBundleStoragePath,
  purgeStoredBundle,
} from "@/platforms/mobile/web-bundle-updates";

vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA" },
  Filesystem: { rmdir: vi.fn() },
}));

describe("OTA bundle compatibility", () => {
  it("rejects a bundle that declares no epoch (published before the fix)", () => {
    expect(isBundleEpochCompatible(undefined)).toBe(false);
    expect(isBundleEpochCompatible(BUNDLE_EPOCH - 1)).toBe(false);
    expect(isBundleEpochCompatible(BUNDLE_EPOCH)).toBe(true);
    expect(isBundleEpochCompatible(BUNDLE_EPOCH + 5)).toBe(true);
  });

  it("purges an old contaminated bundle left over from before an APK upgrade", () => {
    // Higher version than the shell, but from before the epoch existed.
    expect(bundleDecision({ version: "9.9.9", path: "/data/web/9.9.9" }, "1.3.93")).toBe("purge");
  });

  it("purges even a newer compatible bundle because it is not APK-signed", () => {
    expect(
      bundleDecision({ version: "1.3.94", path: "/data/web/1.3.94", epoch: BUNDLE_EPOCH }, "1.3.93"),
    ).toBe("purge");
  });

  it("purges a compatible bundle that is not newer than the shell", () => {
    expect(
      bundleDecision({ version: "1.3.90", path: "/data/web/1.3.90", epoch: BUNDLE_EPOCH }, "1.3.93"),
    ).toBe("purge");
  });

  it("does nothing when the device has no stored bundle", () => {
    expect(bundleDecision(null)).toBe("none");
  });

  it("never turns attacker-controlled legacy state into a traversal path", () => {
    expect(legacyBundleStoragePath("1.4.5")).toBe("web/1.4.5");
    expect(legacyBundleStoragePath("../../files")).toBeNull();
    expect(legacyBundleStoragePath("1.4.5/../../files")).toBeNull();
  });

  it("retains the cleanup pointer after a filesystem failure and clears it after retry", async () => {
    const removeItem = vi.fn();
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage: { removeItem } },
    });
    const rmdir = vi.mocked(Filesystem.rmdir);
    rmdir.mockRejectedValueOnce(new Error("storage temporarily unavailable"));

    await purgeStoredBundle({ version: "1.4.4", path: "web/1.4.4" });
    expect(removeItem).not.toHaveBeenCalled();

    rmdir.mockResolvedValueOnce(undefined);
    await purgeStoredBundle({ version: "1.4.4", path: "web/1.4.4" });
    expect(removeItem).toHaveBeenCalledWith("pos.ui.webBundle");

    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });

  it("purges the legacy bundle before generic startup cleanup removes its pointer", () => {
    const boot = fs.readFileSync(
      path.resolve(process.cwd(), "src/platforms/mobile/components/NativeBoot.tsx"),
      "utf8",
    );
    expect(boot.indexOf(".then(() => applyPendingWebBundle())")).toBeGreaterThan(-1);
    expect(boot.indexOf(".then(() => applyPendingWebBundle())")).toBeLessThan(
      boot.indexOf(".then(() => runDeviceCleanup())"),
    );
  });

  it("describes Android updates as signed APKs without legacy bundle claims", () => {
    const settings = fs.readFileSync(
      path.resolve(process.cwd(), "src/platforms/web/components/pos/AppUpdateSettings.tsx"),
      "utf8",
    );
    expect(settings).toContain("Updates are delivered as Android-signed APK files");
    expect(settings).not.toContain('label="Interface update"');
    expect(settings).not.toContain("Interface fixes arrive automatically");
  });
});
