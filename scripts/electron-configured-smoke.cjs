#!/usr/bin/env node

// Launches the packaged Windows till against its normal (configured) profile.
// This is deliberately separate from electron-runtime-smoke.cjs, whose fresh
// temporary profile proves bootstrap behavior but cannot prove local SQL.
const { _electron: electron } = require("@playwright/test");
const path = require("node:path");

const sourceMode = process.argv.includes("--source");
const packageArg = process.argv.find((arg) => !arg.startsWith("--") && arg !== process.argv[0] && arg !== process.argv[1]);
const executablePath = sourceMode
  ? require("electron")
  : path.resolve(packageArg || path.join("release", "win-unpacked", "Retail.exe"));

async function bounded(label, work, timeoutMs = 20_000) {
  return Promise.race([
    Promise.resolve().then(work),
    new Promise((_, reject) =>
      setTimeout(() => reject(Object.assign(new Error(`${label} timed out`), { code: "ETIMEDOUT" })), timeoutMs),
    ),
  ]);
}

async function main() {
  const consoleErrors = [];
  const pageErrors = [];
  const app = await electron.launch({
    executablePath,
    args: sourceMode ? [".", "--disable-gpu", "--no-sandbox"] : ["--disable-gpu"],
    cwd: process.cwd(),
    env: sourceMode
      ? { ...process.env, VITE_DEV_SERVER_URL: "http://127.0.0.1:8080" }
      : process.env,
  });
  try {
    const page = await bounded("first window", () => app.firstWindow({ timeout: 30_000 }), 35_000);
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.waitForLoadState("domcontentloaded");
    await page.waitForFunction(() => Boolean(window.pos), null, { timeout: 30_000 });
    await page.waitForTimeout(8_000);

    const bridge = await page.evaluate(async () => {
      const pos = window.pos;
      await pos.reportReady();
      const [version, terminal, database, cloud, sync, sales] = await Promise.all([
        pos.appVersion(),
        pos.readTerminalConfig(),
        pos.database.getState(),
        pos.cloudKeyStatus(),
        pos.sync.getStatus(),
        pos.query("sales", {
          columns: "id,receipt_no,total,status,created_at,sync_status",
          order: "created_at.desc",
          limit: 3,
        }),
      ]);
      return {
        version,
        terminal: {
          terminalId: terminal?.terminalId ?? null,
          branchId: terminal?.storeId ?? terminal?.branchId ?? null,
          status: terminal?.status ?? null,
        },
        database: {
          enabled: database?.enabled ?? false,
          connected: database?.connected ?? false,
          tradingReady: database?.tradingReady ?? false,
          state: database?.state ?? null,
          code: database?.code ?? null,
          error: database?.error ?? null,
        },
        cloud: { configured: cloud?.configured ?? false, encrypted: cloud?.encrypted ?? false },
        sync: {
          connected: sync?.connected ?? false,
          paused: sync?.paused ?? false,
          errorCode: sync?.errorCode ?? sync?.code ?? null,
          pending: sync?.pending ?? sync?.pendingCount ?? null,
        },
        recentSales: sales?.rows ?? [],
      };
    });
    const body = (await page.locator("body").innerText()).slice(0, 8_000);
    console.log(JSON.stringify({ ok: true, bridge, body, consoleErrors, pageErrors }, null, 2));
    if (!bridge.database.connected || !bridge.database.tradingReady || consoleErrors.length || pageErrors.length) {
      process.exitCode = 1;
    }
  } finally {
    const closed = await Promise.race([
      app.close().then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 10_000)),
    ]);
    if (!closed) app.process().kill();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, code: error?.code ?? "EFAILED", error: error?.message ?? String(error) }));
  process.exitCode = 1;
});
