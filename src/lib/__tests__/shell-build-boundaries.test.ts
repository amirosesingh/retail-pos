import { describe, expect, it, vi } from "vitest";
import { excludedShellModules, shellAliases, enforceShellBoundary } from "../../../scripts/platform-build-boundaries";
import { readFileSync } from "node:fs";

for (const target of ["web", "android", "windows"] as const) {
  describe(`${target} shell build`, () => {
    it("excludes only unsupported implementations and preserves its own", () => {
      const excluded = excludedShellModules(target);
      expect(excluded.some(path => path.includes("mobile"))).toBe(target !== "android");
      expect(excluded.some(path => path.includes("windows"))).toBe(target !== "windows");
      for (const path of excluded) {
        const alias = shellAliases(target).find(item => item.find.test(`@/${path}`))!;
        expect(alias).toBeDefined();
        for (const source of [`@/${path}`, `../${path}`, `/repo/src/${path}.tsx`])
          expect(source.replace(alias.find, alias.replacement)).toBe(alias.replacement);
      }
    });
    it("rejects alternate imports that bypass shell aliases", () => {
      const path = excludedShellModules(target)[0]!;
      const error = vi.fn();
      const hook = enforceShellBoundary(target).generateBundle as (...args: unknown[]) => void;
      hook.call({ getModuleIds: () => [`/repo/src/${path}.tsx`], error });
      expect(error).toHaveBeenCalledOnce();
      error.mockClear();
      hook.call({ getModuleIds: () => ["/repo/src/lib/pos-store.tsx", "/repo/src/lib/external-supabase-config.ts"], error });
      expect(error).not.toHaveBeenCalled();
    });
  });
}

it("keeps update notices outside connection and staff gates with one mount each", () => {
  const root = readFileSync("src/routes/__root.tsx", "utf8");
  for (const name of ["AndroidUpdateBanner", "DesktopUpdateBanner"]) {
    expect(root.match(new RegExp(`<${name} />`, "g"))).toHaveLength(1);
  }
  expect(root).toContain('RELEASE_CHANNEL === "beta" && <AppUpdateNotices />');
  expect(root).toContain('RELEASE_CHANNEL !== "beta" && <AppUpdateNotices />');
  expect(root.indexOf('RELEASE_CHANNEL === "beta" && <AppUpdateNotices />')).toBeLessThan(root.indexOf("<NativeBoot>"));
  expect(root.indexOf("<NativeBoot>")).toBeLessThan(root.indexOf("<OfflineGate"));
});
