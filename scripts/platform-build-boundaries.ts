import { resolve } from "node:path";
import type { Plugin } from "vite";

export type BuildPlatform = "web" | "android" | "ios" | "windows";
const androidOnly = [
  "platforms/mobile/components/NativeBoot",
  "platforms/mobile/components/AndroidPushAgent",
  "platforms/mobile/components/AndroidUpdateBanner",
  "platforms/mobile/use-native-back",
  "platforms/mobile/android-updates",
];
const windowsOnly = [
  "components/shared/NativeWindowFrame",
  "platforms/windows/components/PrivilegeGate",
  "platforms/windows/components/DesktopUpdateBanner",
  "platforms/windows/components/LocalDatabaseWizard",
  "platforms/windows/components/LocalDatabaseOperations",
];
const updaterOnly = [
  "routes/settings.updates",
  "platform-config/native-update-settings",
  "platforms/web/components/pos/AppUpdateSettings",
  "platforms/web/components/pos/MinimalUpdatePanel",
  "lib/app-updates",
];
const terminalOnly = [
  "components/shared/EmergencyAccessLink",
  "platforms/web/components/pos/RecoveryHub",
  "platforms/web/components/pos/EmergencyPinGate",
  "platforms/web/components/pos/TerminalActivation",
  "platforms/web/components/pos/ConnectDatabaseScreen",
  "platforms/web/components/pos/UpdateHeaderButton",
];

export function excludedShellModules(platform: BuildPlatform) {
  return [...(platform === "android" ? [] : platform === "ios" ? androidOnly.filter(path => !path.endsWith("NativeBoot") && !path.endsWith("use-native-back")) : androidOnly), ...(platform === "windows" ? [] : windowsOnly), ...(platform === "web" ? terminalOnly : [])];
}

export function shellAliases(platform: BuildPlatform) {
  return excludedShellModules(platform).map(path => ({
    find: new RegExp(`^.*(?:^|/)${path}(?:\\.tsx?)?$`),
    replacement: resolve(path.endsWith("UpdateHeaderButton")
      ? "src/platform-config/unsupported-update-header.tsx"
      : terminalOnly.includes(path)
      ? "src/platform-config/unsupported-terminal-setup.tsx"
      : path.endsWith("NativeWindowFrame") && (platform === "android" || platform === "ios")
      ? "src/platforms/mobile/components/NativeWindowFrame.tsx"
      : path.endsWith("android-updates")
      ? "src/platform-config/unsupported-android-updates.ts"
      : path.endsWith("use-native-back")
      ? "src/platform-config/unsupported-native-back.ts"
      : "src/platform-config/unsupported-shell.tsx"),
  }));
}

/** Fail packaging if an excluded implementation gets pulled in by another path. */
export function enforceShellBoundary(platform: BuildPlatform): Plugin {
  return {
    name: "enforce-shell-build-boundary",
    generateBundle() {
      const excluded = [...excludedShellModules(platform), ...(platform === "web" ? updaterOnly : []), ...((platform === "android" || platform === "ios") ? [] : [
        "platforms/mobile/components/OfflineInterface",
        "platforms/mobile/update-download",
      ])];
      for (const id of this.getModuleIds()) {
        const normalized = id.replaceAll("\\", "/").split("?")[0];
        if (platform !== "ios" && normalized.includes("/src/platforms/ios/")) this.error(`iOS OTA code leaked into ${platform}: ${id}`);
        if (excluded.some(path => normalized.endsWith(`/src/${path}.tsx`) || normalized.endsWith(`/src/${path}.ts`))) {
          this.error(`The ${platform} build included another platform's shell implementation: ${id}`);
        }
      }
    },
  };
}
