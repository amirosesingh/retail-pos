const { _electron: electron } = require("@playwright/test");
const os = require("node:os");
const path = require("node:path");

const devServerUrl = process.argv[2] || process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:8080";
const smokeUserData = path.join(os.tmpdir(), "retail-pos-electron-runtime-smoke");

async function main() {
  const consoleErrors = [];
  const pageErrors = [];
  let phase = "launch";
  let app;
  const watchdog = setTimeout(() => {
    console.error(JSON.stringify({ ok: false, code: "ETIMEDOUT", phase }));
    try {
      app?.process()?.kill();
    } catch {
      // The main process may already be exiting.
    }
    process.exitCode = 1;
  }, 90_000);
  app = await electron.launch({
    executablePath: require("electron"),
    // Codex's managed Windows session cannot launch Chromium's child-process
    // sandbox (renderer exit 49). This flag is confined to the isolated smoke
    // profile; packaged Electron continues to use its normal sandbox.
    args: [".", `--user-data-dir=${smokeUserData}`, "--disable-gpu", "--no-sandbox"],
    cwd: process.cwd(),
    env: { ...process.env, VITE_DEV_SERVER_URL: devServerUrl },
  });
  try {
    phase = "first-window";
    const window = await app.firstWindow({ timeout: 30_000 });
    window.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    window.on("pageerror", (error) => pageErrors.push(error.message));
    phase = "dom-content-loaded";
    await window.waitForLoadState("domcontentloaded");
    await window.waitForFunction(() => Boolean(window.pos), null, { timeout: 30_000 });
    phase = "bridge-checks";
    const result = await window.evaluate(async () => {
      const bridge = window.pos;
      if (!bridge) return { bridge: false };
      const bounded = (label, work, timeoutMs = 15_000) =>
        Promise.race([
          Promise.resolve()
            .then(work)
            .then((value) => ({ ok: true, value }))
            .catch((error) => ({ ok: false, code: error?.code ?? "EFAILED", error: String(error?.message ?? error) })),
          new Promise((resolve) =>
            setTimeout(() => resolve({ ok: false, code: "ETIMEDOUT", error: `${label} timed out.` }), timeoutMs),
          ),
        ]);
      // Closing a smoke-test window before the renderer reports readiness
      // looks like a failed production launch to Electron's rollback guard.
      // Mark this inspected build healthy before the test exits.
      const readyCall = await bounded("reportReady", () => bridge.reportReady(), 10_000);
      const [versionCall, terminalCall, databaseCall, cloudCall, syncCall, staffCall, readCall] = await Promise.all([
        bounded("appVersion", () => bridge.appVersion()),
        bounded("readTerminalConfig", () => bridge.readTerminalConfig()),
        bounded("database.getState", () => bridge.database.getState()),
        bounded("cloudKeyStatus", () => bridge.cloudKeyStatus()),
        bounded("sync.getStatus", () => bridge.sync.getStatus()),
        bounded("staffRoster", () => bridge.staffRoster(null)),
        bounded("query stores", () => bridge.query("stores", { columns: "id,name", limit: 1 })),
      ]);
      const version = versionCall.value;
      const terminal = terminalCall.value;
      const database = databaseCall.value;
      const cloud = cloudCall.value;
      const sync = syncCall.value;
      const staff = staffCall.value;
      const safeUnassignedRead = readCall.value;
      const reconciliation = terminal?.terminalId
        ? (await bounded("sync.reconcile", () => bridge.sync.reconcile({ deep: false }), 30_000)).value ??
          { ok: false, matched: false, code: "ETIMEDOUT", differences: [] }
        : { ok: false, skipped: true, code: "ETERMINAL" };
      return {
        bridge: true,
        version,
        terminal: {
          configured: Boolean(terminal?.terminalId),
          branchConfigured: Boolean(terminal?.storeId || terminal?.branchId),
          status: terminal?.status ?? null,
        },
        database: {
          enabled: database?.enabled ?? false,
          connected: database?.connected ?? false,
          tradingReady: database?.tradingReady ?? false,
          state: database?.state ?? null,
        },
        cloud: {
          configured: cloud?.configured ?? false,
          encrypted: cloud?.encrypted ?? false,
        },
        sync: {
          connected: sync?.connected ?? false,
          paused: sync?.paused ?? false,
          errorCode: sync?.errorCode ?? sync?.code ?? null,
        },
        reconciliation: {
          ok: reconciliation?.ok ?? false,
          matched: reconciliation?.matched ?? false,
          differenceCount: reconciliation?.differences?.length ?? 0,
          differences: reconciliation?.differences ?? [],
          code: reconciliation?.code ?? null,
        },
        staff: { ok: staff?.ok ?? false, count: staff?.rows?.length ?? 0 },
        safeUnassignedRead,
        calls: Object.fromEntries(
          Object.entries({ readyCall, versionCall, terminalCall, databaseCall, cloudCall, syncCall, staffCall, readCall }).map(
            ([name, call]) => [name, { ok: call.ok, code: call.code ?? null, error: call.error ?? null }],
          ),
        ),
      };
    });
    phase = "report";
    console.log(JSON.stringify({ ok: true, result, consoleErrors, pageErrors }, null, 2));
    if (consoleErrors.length || pageErrors.length || !result.bridge) process.exitCode = 1;
  } finally {
    phase = "close";
    const closed = await Promise.race([
      app.close().then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 10_000)),
    ]);
    if (!closed) app.process().kill();
    clearTimeout(watchdog);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
