import { defineConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default defineConfig({
  testDir: "./e2e",
  outputDir: join(tmpdir(), "retail-pos-playwright"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 10 * 60_000,
  reporter: "line",
  use: {
    baseURL: process.env.POS_E2E_BASE_URL ?? "https://pos.luckycharmsdnbhd.com",
    browserName: "chromium",
    channel: "chrome",
    headless: true,
    screenshot: "off",
    trace: "off",
    video: "off",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
});
