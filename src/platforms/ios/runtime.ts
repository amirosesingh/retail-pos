import { iosInstallSafe } from "./install-safety";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { CapacitorUpdater } from "@capgo/capacitor-updater";
import { Preferences } from "@capacitor/preferences";
import { App } from "@capacitor/app";
import { APP_VERSION } from "@/version";
import { updateRestartSafe } from "@/lib/update-safety";
import { flushTicketDrafts } from "@/lib/session-draft";
import { flushNativeStorage } from "@/platforms/mobile/mobile-storage";
import { IosOtaService } from "./service";
import type { Trust } from "./manifest";
const nativeTrust = registerPlugin<{ configuration(): Promise<Trust> }>("RetailOtaTrust");
const key = "retail.ios.ota.v1";
let edited = false;
let manualInstallPath: string | null = null;
const safe = () => iosInstallSafe({
  pathname: location.pathname,
  confirmedPath: manualInstallPath,
  transactionSafe: updateRestartSafe(),
  visible: document.visibilityState === "visible",
  edited,
  blocked: Boolean(document.querySelector('[role="dialog"], [role="alertdialog"], [aria-busy="true"]')),
});
export const iosOta = new IosOtaService({
  builtinVersion: APP_VERSION,
  updater: CapacitorUpdater,
  trust: () => nativeTrust.configuration(),
  load: async () => {
    const { value } = await Preferences.get({ key });
    return value ? JSON.parse(value) : null;
  },
  save: async (state) => {
    await Preferences.set({ key, value: JSON.stringify(state) });
  },
  safe,
  online: () => navigator.onLine,
  preserve: async () => {
    await flushTicketDrafts();
    await flushNativeStorage();
    await Preferences.set({ key: "retail.ios.ota.lastRoute", value: location.pathname });
  },
});
let started: Promise<void> | undefined;
export function startIosOta() {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "ios") return Promise.resolve();
  return (started ??= (async () => {
    await iosOta.boot();
    // Conservative: do not auto-reload after any form edit in this launch.
    document.addEventListener(
      "input",
      () => {
        edited = true;
      },
      true,
    );
    document.addEventListener(
      "change",
      () => {
        edited = true;
      },
      true,
    );
    await App.addListener("appStateChange", (state) => {
      if (state.isActive) void iosOta.check().catch(() => {});
    });
    window.addEventListener("error", () => iosOta.reportHealthIssue());
    window.addEventListener("unhandledrejection", () => iosOta.reportHealthIssue());
    window.addEventListener("online", () => {
      void iosOta.check().catch(() => {});
    });
    void iosOta.check().catch(() => {});
  })());
}
export function allowManualInstall() {
  // Call only after explicit confirmation. Navigation, new edits, active
  // checkout operations and open dialogs still prevent the reload.
  manualInstallPath = location.pathname;
  edited = false;
}
