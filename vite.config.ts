import { execFileSync } from "node:child_process";
import { disconnectedRequestRecovery } from "./scripts/dev-request-abort";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, searchForWorkspaceRoot } from "vite";
import type { Plugin } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { shellAliases, enforceShellBoundary } from "./scripts/platform-build-boundaries";
import { popupRuntimeAliases } from "./scripts/popup-runtime-aliases.mjs";
import webOnlyEnv from "./scripts/web-only-env-names.json" with { type: "json" };

// Managed checkouts can resolve dependencies from a parent node_modules.
// Allow that exact directory while keeping Vite's filesystem guard enabled.
const runtimeDependencies = resolve(dirname(fileURLToPath(import.meta.resolve("nitro/vite"))), "../..");

/**
 * `use client` is an RSC package-boundary marker, not a runtime directive.
 * This application uses TanStack Start rather than React Server Components,
 * and its client/server boundaries are already compiled by TanStack before
 * Rolldown runs. Remove the inert marker from known UI dependencies so it is
 * not carried into ordinary browser/SSR chunks as an unknown directive.
 */
function stripThirdPartyRscMarkers(): Plugin {
  const clientPackages =
    /node_modules\/(?:@tanstack\/react-(?:query|router)|@radix-ui\/react-[^/]+|lucide-react|sonner)\//;
  return {
    name: "strip-inert-third-party-rsc-markers",
    enforce: "pre",
    transform(code, id) {
      if (!clientPackages.test(id) || !/^\s*["']use client["'];?/m.test(code)) return null;
      return {
        code: code.replace(/^\s*["']use client["'];?\s*/m, ""),
        map: null,
      };
    },
  };
}

/**
 * Nitro currently supplies both Rollup's legacy `inlineDynamicImports` flag
 * and Rolldown's chunk-group configuration. Keep the intentional chunk groups
 * and remove only the obsolete Rollup flag before Rolldown validates options.
 */
function alignNitroRolldownOutput(): Plugin {
  return {
    name: "align-nitro-rolldown-output",
    enforce: "post",
    configEnvironment(name, config) {
      if (name !== "nitro") return;
      const output = config.build?.rolldownOptions?.output;
      if (output && !Array.isArray(output)) delete output.inlineDynamicImports;
    },
  };
}

const isDesktop = Boolean(process.env["DESKTOP_BUILD"]);
/**
 * Android build: the whole POS is packaged inside the APK, so the phone needs
 * a static client bundle with an SPA fallback rather than a running server.
 */
const isMobile = Boolean(process.env["MOBILE_BUILD"]);
const isIos = isMobile && process.env.POS_MOBILE_TARGET === "ios";
/**
 * Cloudflare Workers build (GitHub Actions -> wrangler deploy). Pins the same
 * preset and output layout that wrangler.jsonc points at, so CI never falls
 * back to a Node target.
 */
/**
 * Android and Windows are shipped artifacts handed to other shops, so no web
 * deployment value may end up inside them. Two guards, both build-time:
 *
 *  1. `envDir` points at an empty folder, so Vite loads none of the repo's
 *     .env / .env.production / .env.local files.
 *  2. every web configuration name is defined as `undefined`, so a static
 *     `import.meta.env.VITE_...` read inlines to nothing even if the CI runner
 *     happens to export the value.
 *
 * The browser/Cloudflare build is untouched and keeps its own environment.
 */
export const WEB_ONLY_ENV_NAMES = webOnlyEnv.webOnly.filter((name) => name.startsWith("VITE_"));

if (isMobile && isDesktop) throw new Error("Choose one build target: Android or Windows.");
const buildPlatform = isIos ? "ios" : isMobile ? "android" : isDesktop ? "windows" : "web";
const isTerminalBuild = isMobile || isDesktop;
const isBetaBuild = process.env.POS_RELEASE_CHANNEL === "beta" || process.env.WORKERS_CI_BRANCH === "beta";

const blankWebEnv = Object.fromEntries(
  WEB_ONLY_ENV_NAMES.map((name) => [`import.meta.env.${name}`, "undefined"]),
);

export default defineConfig({
  // The browser and Electron previews can run beside each other. Separate
  // dependency optimizer caches so a desktop reoptimization cannot invalidate
  // modules already loaded by the browser preview (or vice versa).
  cacheDir: resolve("node_modules", `.vite-${buildPlatform}`),
  define: { "import.meta.env.VITE_POS_RELEASE_CHANNEL": JSON.stringify(isBetaBuild ? "beta" : "stable") },
  server: {
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), runtimeDependencies] },
    host: "::",
    port: 8080,
    // Release/package jobs may run beside the development server. Their
    // generated Electron DLLs and Android outputs are not source inputs;
    // watching them can crash Windows with EBUSY while a packager signs or
    // replaces a file.
    watch: {
      ignored: [
        "**/release/**",
        "**/dist/**",
        "**/dist-desktop/**",
        "**/capacitor-shell/**",
        "**/android/app/build/**",
      ],
    },
  },
  css: { transformer: "lightningcss" },
  resolve: {
    // Native approval UI/Keystore enrollment never enter website client chunks.
    alias: [...popupRuntimeAliases(), { find: /^zod$/, replacement: resolve("src/lib/csp-zod.ts") }, ...(isDesktop ? [{ find: "@/platform-config/approval-token-store", replacement: resolve("src/platforms/windows/approval-token-store.ts") }] : []),...(isIos ? [{ find: "@/platform-config/ios-ota", replacement: resolve("src/platforms/ios/ui.tsx") }] : []), ...shellAliases(buildPlatform), ...(!isTerminalBuild ? [
      { find: /^\.\/routeTree\.gen(?:\.tsx?)?$/, replacement: resolve("src/routeTree.web.gen.ts") },
    ] : [
      { find: "@/platform-config/update-settings", replacement: resolve("src/platform-config/native-update-settings.tsx") },
    ]), ...(isMobile ? [
      { find: "@/platform-config/password-manager", replacement: resolve("src/platforms/mobile/password-manager.ts") },
      { find: "@/platform-config/clipboard", replacement: resolve("src/platforms/mobile/clipboard.ts") },
      { find: "@/platform-config/offline-interface", replacement: resolve("src/platforms/mobile/components/OfflineInterface.tsx") },
      { find: "@/platform-config/viewport", replacement: resolve("src/platforms/mobile/viewport.ts") },
    ] : []), ...(isTerminalBuild ? [
      { find: "@/platform-config/approval-token", replacement: resolve("src/platforms/mobile/components/ApprovalToken.tsx") },
      { find: "@/platform-config/approval-token-client", replacement: resolve("src/lib/approval-token-client.ts") },
      { find: "@/platform-config/approval-methods", replacement: resolve("src/platforms/mobile/components/NativeApprovalMethods.tsx") },
    ] : [])],
    tsconfigPaths: true,
    dedupe: [
      "react",
      "react-dom",
      "@tanstack/react-router",
      "@tanstack/react-query",
      "@supabase/supabase-js",
    ],
  },
  plugins: [
    {
      name: "refresh-bundled-logic-report",
      apply: "build",
      configResolved(config) {
        // Scan the source used by this build, never ship a report from an older release.
        execFileSync(process.execPath, [resolve(config.root, "scripts/logic-scan.cjs")], { cwd: config.root, stdio: "inherit" });
      },
    },
    enforceShellBoundary(buildPlatform),
    stripThirdPartyRscMarkers(),
    tanstackStart({
      server: { entry: "server" },
      router: !isTerminalBuild ? {
        generatedRouteTree: "./routeTree.web.gen.ts",
        routeFileIgnorePattern: "settings\\.updates\\.tsx$",
      } : {},
    }),
    nitro(
      isDesktop
        ? {
            preset: "node-server",
            output: {
              dir: "dist-desktop",
              serverDir: "dist-desktop/server",
              publicDir: "dist-desktop/public",
            },
          }
        : isMobile
          ? {
              preset: "node-server",
              output: {
                dir: "dist",
                serverDir: "dist/server",
                publicDir: "dist/client",
              },
            }
          : {
              preset: "cloudflare-module",
              output: {
                dir: "dist",
                serverDir: "dist/server",
                publicDir: "dist/client",
              },
              cloudflare: { nodeCompat: true },
            },
    ),
    alignNitroRolldownOutput(),
    tailwindcss(),
    viteReact(),
    disconnectedRequestRecovery(),
  ],
  ...(isTerminalBuild
    ? {
        // No repository or CI web environment value is visible to a device build.
        envDir: "scripts/no-env",
        define: { ...blankWebEnv, "import.meta.env.VITE_POS_RELEASE_CHANNEL": JSON.stringify(isBetaBuild ? "beta" : "stable") },
      }
    : {}),
});
