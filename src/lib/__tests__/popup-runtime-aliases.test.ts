import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { popupRuntimeAliases, SHARED_POPUP_RUNTIME_MODULES } from "../../../scripts/popup-runtime-aliases.mjs";

const fromDialog = createRequire(import.meta.resolve("@radix-ui/react-dialog"));

describe("shared popup document lifecycle modules", () => {
  it("selects the installed Dialog-compatible ESM copies without changing packages", () => {
    const aliases = popupRuntimeAliases();
    expect(aliases).toHaveLength(2);
    for (const name of SHARED_POPUP_RUNTIME_MODULES) {
      const alias = aliases.find(item => item.find.test(name))!;
      const packageRoot = resolve(dirname(fromDialog.resolve(name)), "..");
      const manifest = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8"));
      expect(alias.replacement).toBe(resolve(packageRoot, manifest.module));
      expect(existsSync(alias.replacement)).toBe(true);
      expect(alias.find.test(`${name}/unrelated-subpath`)).toBe(false);
    }
  });

  it("keeps the canonical ESM modules importable during server rendering", async () => {
    const modules = await Promise.all(popupRuntimeAliases().map(alias => import(pathToFileURL(alias.replacement).href)));
    expect(modules[0].DismissableLayer).toBeDefined();
    expect(modules[1].FocusScope).toBeDefined();
    expect(modules[1].FocusScopeBranchProvider).toBeDefined();
    expect(renderToStaticMarkup(createElement(modules[0].DismissableLayer, null, "SSR layer"))).toContain("SSR layer");
    expect(renderToStaticMarkup(createElement(modules[1].FocusScope, null, "SSR focus"))).toContain("SSR focus");
  });

  it("uses the same unconditional aliases in all app build targets and the isolated browser", () => {
    const config = readFileSync("vite.config.ts", "utf8");
    const fixture = readFileSync("scripts/test-offline-gate-portals.cjs", "utf8");
    expect(config).toContain("alias: [...popupRuntimeAliases(),");
    expect(config).toContain('const buildPlatform = isIos ? "ios" : isMobile ? "android" : isDesktop ? "windows" : "web"');
    expect(fixture).toContain("...popupRuntimeAliases(),");
  });
});
