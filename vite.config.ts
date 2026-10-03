import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import type { Plugin } from "vite";
import webOnlyEnv from "./scripts/web-only-env-names.json" with { type: "json" };

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

const isTerminalBuild = isMobile || isDesktop;

const blankWebEnv = Object.fromEntries(
  WEB_ONLY_ENV_NAMES.map((name) => [`import.meta.env.${name}`, "undefined"]),
);

export default defineConfig({
  server: {
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
    tsconfigPaths: true,
    dedupe: ["react", "react-dom", "@tanstack/react-router", "@tanstack/react-query"],
  },
  plugins: [
    stripThirdPartyRscMarkers(),
    tanstackStart({ server: { entry: "server" } }),
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
  ],
  ...(isTerminalBuild
    ? {
        // No repository or CI web environment value is visible to a device build.
        envDir: "scripts/no-env",
        define: blankWebEnv,
      }
    : {}),
});
