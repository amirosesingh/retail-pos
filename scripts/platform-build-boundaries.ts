import { resolve } from "node:path";
import type { Plugin } from "vite";

export type BuildPlatform = "web" | "android" | "windows";
const androidOnly = [
  "platforms/mobile/components/NativeBoot",
  "platforms/mobile/components/AndroidPushAgent",
  "platforms/mobile/components/AndroidUpdateBanner",
  "platforms/mobile/use-native-back",
  "platforms/mobile/android-updates",
];
const windowsOnly = [
  "platforms/windows/components/PrivilegeGate",
  "platforms/windows/components/DesktopUpdateBanner",
  "platforms/windows/components/LocalDatabaseWizard",
  "platforms/windows/components/LocalDatabaseOperations",
];

export function excludedShellModules(platform: BuildPlatform) {
  return [...(platform === "android" ? [] : androidOnly), ...(platform === "windows" ? [] : windowsOnly)];
}

export function shellAliases(platform: BuildPlatform) {
  return excludedShellModules(platform).map(path => ({
    find: new RegExp(`^.*(?:^|/)${path}(?:\\.tsx?)?$`),
    replacement: resolve(path.endsWith("android-updates")
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
      const excluded = [...excludedShellModules(platform), ...(platform === "android" ? [] : [
        "platforms/mobile/components/OfflineInterface",
        "platforms/mobile/update-download",
      ])];
      for (const id of this.getModuleIds()) {
        const normalized = id.replaceAll("\\", "/").split("?")[0];
        if (excluded.some(path => normalized.endsWith(`/src/${path}.tsx`) || normalized.endsWith(`/src/${path}.ts`))) {
          this.error(`The ${platform} build included another platform's shell implementation: ${id}`);
        }
      }
    },
  };
}
