import { build } from "esbuild";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("keeps framework initialization outside the emitted Worker login import graph", async () => {
  // Build the real local modules without writing artifacts. Package imports
  // remain external so their eager/lazy boundaries are visible in the graph;
  // this tests the boundary, not a hosted CPU budget or production bundle size.
  const result = await build({
    absWorkingDir: process.cwd(), entryPoints: ["src/server.ts"], bundle: true,
    format: "esm", platform: "browser", packages: "external",
    alias: { "@": resolve(process.cwd(), "src") }, splitting: true,
    outdir: ".unused-login-import-test-output", write: false, metafile: true,
    logLevel: "silent",
  });
  const outputs = Object.values(result.metafile.outputs);
  expect(outputs.some(output => output.entryPoint === "src/lib/cashier-login-endpoint.server.ts")).toBe(true);
  expect(Object.keys(result.metafile.inputs).some(file => file.startsWith("src/routes/"))).toBe(false);
  const frameworkImports = outputs.flatMap(output => output.imports)
    .filter(dependency => dependency.path.startsWith("@tanstack/"));
  expect(frameworkImports).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: "@tanstack/react-start/server-entry", kind: "dynamic-import" }),
    expect.objectContaining({ path: "@tanstack/react-start/server", kind: "dynamic-import" }),
  ]));
  expect(frameworkImports.every(dependency => dependency.kind === "dynamic-import")).toBe(true);
});
