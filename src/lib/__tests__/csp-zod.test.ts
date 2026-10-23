import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { runInNewContext } from "node:vm";
import { readFileSync } from "node:fs";
import { zodCspBootScript } from "../csp-zod-boot";
afterEach(() => vi.unstubAllGlobals());
it("validates objects without dynamic code generation under strict CSP", () => {
  const forbidden = vi.fn(() => { throw new EvalError("CSP blocks dynamic code"); });
  vi.stubGlobal("Function", forbidden);
  const schema = z.object({ name: z.string().min(1), count: z.number().int().nonnegative() });
  expect(schema.safeParse({ name: "Item", count: 3 }).success).toBe(true);
  expect(schema.safeParse({ name: "", count: -1 }).success).toBe(false);
  expect(forbidden).not.toHaveBeenCalled();
});

it("configures Zod before the root emits module scripts", () => {
  const globalConfig = { existing: "kept" };
  runInNewContext(zodCspBootScript, { globalThis: { __zod_globalConfig: globalConfig } });
  expect(globalConfig).toMatchObject({ existing: "kept", jitless: true });
  const root = readFileSync("src/routes/__root.tsx", "utf8");
  expect(root.indexOf("__html: zodCspBootScript")).toBeLessThan(root.indexOf("<HeadContent />"));
});

it("keeps the Electron renderer policy free of unsafe eval", () => {
  const main = readFileSync("electron/main.cjs", "utf8");
  expect(main).not.toContain("'unsafe-eval'");
});
