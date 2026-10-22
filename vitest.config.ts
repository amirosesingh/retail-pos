import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: { alias: [{ find: /^zod$/, replacement: resolve(import.meta.dirname, "./src/lib/csp-zod.ts") }, { find: "@", replacement: resolve(import.meta.dirname, "./src") }] },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // A cold run transpiles the Electron driver modules before the first test
    // body starts, which alone can eat the default 5s and fail a test that
    // does no real work. The suite is fully faked, so a generous ceiling costs
    // nothing and removes the false red.
    testTimeout: 20000,
    hookTimeout: 20000,
  },

});
