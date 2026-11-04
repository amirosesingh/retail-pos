import { createServer } from "vite";
import { expect, it } from "vitest";
it("loads exact graph helper through actual Vite SSR without CommonJS require/module errors", async () => {
  const server = await createServer({
    configFile: false,
    root: process.cwd(),
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false, watch: null },
  });
  try {
    const helper = await server.ssrLoadModule("/src/lib/shift-graph-exact-download.server.ts");
    expect(
      helper.exactShiftGraphJson(
        '{"tables":[{"table":"shifts","rows":[{"amount":648.00000000000000000001}]}]}',
        false,
      ),
    ).toContain("648.00000000000000000001");
  } finally {
    await server.close();
  }
}, 30000);
