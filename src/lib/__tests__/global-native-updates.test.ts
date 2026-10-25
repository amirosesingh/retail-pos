import { createElement as h, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NativeUpdateOrb } from "@/components/ui/native-update-orb";
import { readFileSync } from "node:fs";

const mocks = vi.hoisted(() => ({
  native: true,
  platform: "ios",
  orb: undefined as ComponentProps<typeof NativeUpdateOrb> | undefined,
  desktop: { supported: true, state: { status: "idle", percent: 0 }, installing: false,
    check: vi.fn(), download: vi.fn(), install: vi.fn() },
  android: { available: false, state: { supported: true, latest: null as string | null,
    checking: false, downloading: false, percent: 0, readyUri: null as string | null, error: null as string | null },
    check: vi.fn(), download: vi.fn(), installDownloaded: vi.fn() },
  iosState: { phase: "idle", installed: "1.0.0", latest: undefined as { version: string } | undefined },
  ios: { check: vi.fn().mockResolvedValue(undefined), download: vi.fn().mockResolvedValue(undefined),
    install: vi.fn().mockResolvedValue(undefined) },
  allow: vi.fn(),
}));
vi.mock("@/components/ui/native-update-orb", async importOriginal => {
  const original = await importOriginal<typeof import("@/components/ui/native-update-orb")>();
  return { NativeUpdateOrb: (props: ComponentProps<typeof NativeUpdateOrb>) => {
    mocks.orb = props;
    return h(original.NativeUpdateOrb, props);
  } };
});
vi.mock("@/lib/app-updates", () => ({ useAppUpdates: () => mocks.desktop, updateBridge: () => null }));
vi.mock("@/platform-config/platform", () => ({ isElectron: () => mocks.native }));
vi.mock("@/platforms/mobile/android-updates", () => ({ useAndroidUpdates: () => mocks.android }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => mocks.native, getPlatform: () => mocks.platform } }));
vi.mock("@capgo/capacitor-updater", () => ({ CapacitorUpdater: {} }));
vi.mock("@/platforms/ios/runtime", () => ({ iosOta: { ...mocks.ios,
  subscribe: () => () => {}, snapshot: () => mocks.iosState }, allowManualInstall: mocks.allow, startIosOta: vi.fn() }));
vi.mock("@/platforms/ios/appearance", () => ({ syncIosAppearance: vi.fn() }));
import { DesktopUpdateBanner } from "@/platforms/windows/components/DesktopUpdateBanner";
import { AndroidUpdateBanner } from "@/platforms/mobile/components/AndroidUpdateBanner";
import { IosUpdateBanner } from "@/platforms/ios/ui";

beforeEach(() => { vi.clearAllMocks(); mocks.native = true; mocks.platform = "ios"; mocks.orb = undefined; });
describe("global native update controls without an authenticated session", () => {
  it("keeps Windows checking available before sign-in and after a successful check", () => {
    for (const status of ["idle", "current", "error", "checking", "downloading", "available", "ready"]) {
      mocks.desktop.state.status = status;
      const html = renderToStaticMarkup(h(DesktopUpdateBanner));
      expect(html).toContain("Application update");
      expect(mocks.orb?.busy).toBe(["checking", "downloading"].includes(status));
      if (!["checking", "downloading"].includes(status)) mocks.orb?.onClick();
    }
    expect(mocks.desktop.check).toHaveBeenCalledTimes(3);
    expect(mocks.desktop.download).toHaveBeenCalledOnce();
    expect(mocks.desktop.install).toHaveBeenCalledOnce();
  });
  it("lets Android check without an available version and download/install when ready", () => {
    mocks.android.available = false;
    expect(renderToStaticMarkup(h(AndroidUpdateBanner))).toContain("Tap to check for updates");
    mocks.orb?.onClick();
    expect(mocks.android.check).toHaveBeenCalledOnce();
    mocks.android.available = true; mocks.android.state.latest = "1.0.1";
    renderToStaticMarkup(h(AndroidUpdateBanner)); mocks.orb?.onClick();
    expect(mocks.android.download).toHaveBeenCalledOnce();
    mocks.android.state.readyUri = "file://update.apk";
    renderToStaticMarkup(h(AndroidUpdateBanner)); mocks.orb?.onClick();
    expect(mocks.android.installDownloaded).toHaveBeenCalledOnce();
    mocks.android.state.readyUri = null; mocks.android.state.checking = true;
    expect(renderToStaticMarkup(h(AndroidUpdateBanner))).toContain('disabled=""');
    mocks.android.state.checking = false;
  });
  it("lets iOS check before any manifest is loaded and requires confirmation to restart", () => {
    mocks.iosState.phase = "idle"; mocks.iosState.latest = undefined;
    expect(renderToStaticMarkup(h(IosUpdateBanner))).toContain("Tap to check for updates");
    mocks.orb?.onClick(); expect(mocks.ios.check).toHaveBeenCalledWith(true);
    mocks.iosState.phase = "ready"; mocks.iosState.latest = { version: "1.0.1" };
    const confirm = vi.fn().mockReturnValue(false);
    vi.stubGlobal("window", { confirm });
    try {
      renderToStaticMarkup(h(IosUpdateBanner)); mocks.orb?.onClick();
      expect(mocks.ios.install).not.toHaveBeenCalled();
      confirm.mockReturnValue(true); mocks.orb?.onClick();
      expect(mocks.allow).toHaveBeenCalledOnce(); expect(mocks.ios.install).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
  });
  it("keeps desktop/iOS browser builds inert", () => {
    mocks.native = false;
    expect(renderToStaticMarkup(h(DesktopUpdateBanner))).toBe("");
    expect(renderToStaticMarkup(h(IosUpdateBanner))).toBe("");
    mocks.android.state.supported = false;
    expect(renderToStaticMarkup(h(AndroidUpdateBanner))).toBe("");
    mocks.android.state.supported = true;
  });
  it("mounts the controls once before setup and authentication gates", () => {
    const root = readFileSync("src/routes/__root.tsx", "utf8");
    expect(root.match(/<AppUpdateNotices \/>/g)).toHaveLength(1);
    expect(root.indexOf("<AppUpdateNotices />")).toBeLessThan(root.indexOf("<NativeBoot>"));
  });
});
