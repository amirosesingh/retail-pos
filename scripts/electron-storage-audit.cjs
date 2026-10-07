#!/usr/bin/env node

// Reports storage sizes only; values and credentials never leave the renderer.
// Includes Chromium's quota estimate and Electron's profile/cache totals.
const { _electron: electron } = require("@playwright/test");

const baseURL = process.env.POS_E2E_BASE_URL || "http://127.0.0.1:8080";

(async () => {
  const app = await electron.launch({
    executablePath: require("electron"),
    args: [".", "--disable-gpu", "--no-sandbox"],
    cwd: process.cwd(),
    env: { ...process.env, VITE_DEV_SERVER_URL: baseURL },
  });
  try {
    const page = await app.firstWindow({ timeout: 30_000 });
    await page.waitForFunction(() => document.readyState !== "loading", null, { timeout: 30_000 });
    const report = await page.evaluate(async () => {
      const inspect = (storage) =>
        Array.from({ length: storage.length }, (_, index) => {
          const key = storage.key(index) || "";
          return { key, bytes: new Blob([storage.getItem(key) || ""]).size };
        }).sort((a, b) => b.bytes - a.bytes);
      const local = inspect(localStorage);
      const session = inspect(sessionStorage);
      const quota = await navigator.storage?.estimate?.().catch(() => null);
      const electron = await window.pos?.cacheStatus?.().catch(() => null);
      return {
        localBytes: local.reduce((sum, row) => sum + row.bytes, 0),
        sessionBytes: session.reduce((sum, row) => sum + row.bytes, 0),
        quotaUsageBytes: quota?.usage ?? null,
        quotaBytes: quota?.quota ?? null,
        electronProfile: electron?.ok ? electron : null,
        local,
        session,
      };
    });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await app.close().catch(() => app.process().kill());
  }
})().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
