const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { app, BrowserWindow, ipcMain, screen, dialog, session, shell, safeStorage } = require("electron");

const updater = require("./updater.cjs");
const terminalStore = require("./terminal-store.cjs");
const configStore = require("./config-store.cjs");
const brandingStore = require("./branding-store.cjs");
const health = require("./health.cjs");
const recovery = require("./recovery.cjs");
const netHttp = require("./net.cjs");
// Every channel argument arriving from the window goes through these checks.
const guard = require("./ipc-guard.cjs");
const diagnostics = require("./diagnostics.cjs");
const serverKeys = require("./server-keys.cjs");
const cloudCredentials = require("./cloud-credentials.cjs");
const storageHygiene = require("./storage-hygiene.cjs");
const { createSecureConfig } = require("./db/secure-config.cjs");
const { ConnectionManager } = require("./db/connection-manager.cjs");
const { DatabaseService } = require("./db/service.cjs");
const { BackupService } = require("./db/backup.cjs");
const { JobRepository } = require("./jobs/repository.cjs");
const { JobManager } = require("./jobs/manager.cjs");
const { LocalDataLifecycle } = require("./jobs/lifecycle.cjs");
const { loadRegistry } = require("./db/schema-registry.cjs");
const { CheckpointRepository } = require("./sync/checkpoints.cjs");
const { ChangeReader } = require("./sync/change-reader.cjs");
const { PushWorker } = require("./sync/push-worker.cjs");
const { PullWorker } = require("./sync/pull-worker.cjs");
const { ConflictRepository } = require("./sync/conflicts.cjs");
const { SyncCoordinator } = require("./sync/coordinator.cjs");
const { CloudClient } = require("./sync/cloud-client.cjs");
const { createTelemetry } = require("./telemetry.cjs");
const { OperationsRepository } = require("./db/repositories/operations.cjs");
const { AggregateRepository } = require("./db/repositories/aggregates.cjs");
const { ReceiptRepository } = require("./db/repositories/receipts.cjs");
const { applyMigrations } = require("./db/migrations.cjs");
const { discoverLocalSqlServers } = require("./db/local-server-discovery.cjs");
const ipcPrivilege = require("./ipc-privilege.cjs");
const adminSession = require("./admin-session.cjs");
const { createLocalStaffStore } = require("./local-staff-store.cjs");
const { verifySyncedStaffPin } = require("./synced-staff-login.cjs");

const databaseConfig = createSecureConfig({ app, safeStorage, configStore });
const databaseManager = new ConnectionManager();
const databaseService = new DatabaseService({
  secureConfig: databaseConfig,
  manager: databaseManager,
  publish: (state) => {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send("database:state", state);
  },
});
const backupService = new BackupService(databaseManager,databaseConfig);
const jobRepository = new JobRepository(databaseManager);
const jobManager = new JobManager(jobRepository, { publish: (job) => { for (const win of BrowserWindow.getAllWindows()) win.webContents.send("jobs:state", job); } });
const syncRegistry = loadRegistry();
const syncCheckpoints = new CheckpointRepository(databaseManager);
const syncCloud = new CloudClient({ configStore, terminalStore, connectionManager: databaseManager });
const changeReader = new ChangeReader(databaseManager, syncRegistry);
const conflictRepository = new ConflictRepository(databaseManager);
const syncCoordinator = new SyncCoordinator({
  pushWorker: new PushWorker({ reader:changeReader,cloud:syncCloud,checkpoints:syncCheckpoints,registry:syncRegistry }),
  pullWorker: new PullWorker({ connectionManager:databaseManager,cloud:syncCloud,checkpoints:syncCheckpoints,registry:syncRegistry,reader:changeReader,conflicts:conflictRepository }),
  publish: (state) => { for (const win of BrowserWindow.getAllWindows()) win.webContents.send("sync:state",state); },
});
const localDataLifecycle = new LocalDataLifecycle({ connectionManager:databaseManager,databaseService,jobManager,jobRepository,registry:syncRegistry,cloud:syncCloud,syncCoordinator,checkpoints:syncCheckpoints });
const mainTelemetry = createTelemetry({ databaseService,syncCoordinator,jobRepository,configStore,terminalStore,app });
const operationsRepository = new OperationsRepository(databaseManager, syncRegistry);
const aggregateRepository = new AggregateRepository(databaseManager, operationsRepository);
const receiptRepository = new ReceiptRepository(databaseManager, syncCloud);
const localStaffStore = createLocalStaffStore(configStore);

function publishBusinessChange(change){
  for(const win of BrowserWindow.getAllWindows()){
    try{if(!win.isDestroyed()&&!win.webContents.isDestroyed())win.webContents.send("business:changed",change);}
    catch{/* the commit remains successful if a renderer is closing */}
  }
}

function localBranchId(){
  const terminal=terminalStore.read()??{};
  return [terminal.locationId,terminal.storeId,terminal.branchId,adminSession.branchId()]
    .map(value=>String(value??"").trim()).find(Boolean)??null;
}
function rememberVerifiedBranch(branchId){
  if(!branchId)return;
  const terminal=terminalStore.read();
  if(terminal?.tokenId&&!terminal.locationId&&!terminal.storeId&&!terminal.branchId)terminalStore.write({...terminal,branchId});
}
async function prepareLocalData({force=false}={}){
  const profile=databaseConfig.profile()??{};
  try{return await localDataLifecycle.ensure({branchId:localBranchId(),historyDays:Number(profile.retentionDays)||90,force});}
  catch(error){
    // Reaching this function means SQL Server already passed validation and is
    // connected. A cloud, activation or reconciliation problem belongs to the
    // synchronization status; it must not describe the healthy local database
    // as degraded or disable offline trading.
    databaseService.markReady({phase:"sync_pending",syncReady:false,code:error?.code??"EBOOTSTRAP",error:String(error?.message??error),differences:error?.differences});
    throw error;
  }
}

const AUTO_SYNC_OK_MS = 15_000;
const AUTO_SYNC_RETRY_MS = 60_000;
const AUTO_VERIFY_MS = 15 * 60_000;
let automaticSyncTimer = null;
let lastAutomaticVerification = 0;
function scheduleAutomaticSync(delay = AUTO_SYNC_OK_MS) {
  if (quitting) return;
  if (automaticSyncTimer) clearTimeout(automaticSyncTimer);
  automaticSyncTimer = setTimeout(() => void runAutomaticSync(), Math.max(250, delay));
  automaticSyncTimer.unref?.();
}
async function runAutomaticSync() {
  automaticSyncTimer = null;
  if (!databaseManager.pool || !localBranchId() || jobManager.running || syncCoordinator.running || syncCoordinator.paused) {
    scheduleAutomaticSync();
    return;
  }
  let result = await syncCoordinator.runNow({ branchId: localBranchId(), batchSize: 500 });
  if (result.code === "ECHANGEGAP") {
    try {
      await prepareLocalData({ force: true });
      result = { ok: true };
    } catch (error) {
      result = { ok: false, error: String(error?.message ?? error) };
    }
  }
  if (result.ok && Date.now() - lastAutomaticVerification >= AUTO_VERIFY_MS) {
    lastAutomaticVerification = Date.now();
    void localDataLifecycle.reconcile(localBranchId(), Number(databaseConfig.profile()?.retentionDays)||90)
      .catch((error) => recordFault("sync.verify-counts", error));
  }
  scheduleAutomaticSync(result.ok ? AUTO_SYNC_OK_MS : AUTO_SYNC_RETRY_MS);
}
function stopAutomaticSync() {
  if (automaticSyncTimer) clearTimeout(automaticSyncTimer);
  automaticSyncTimer = null;
}

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const DEBUG = process.env.POS_DEBUG === "1";

// Must run before the first window exists, otherwise a native crash in the GPU
// or a driver leaves nothing behind to look at.
diagnostics.startCrashReporter();
diagnostics.watchApp(app);

/* ---------------------------------------------------------------------------
   Safety net.

   An unhandled error must never be the reason a shop cannot ring up a sale, so
   an ordinary fault is written to the diagnostics log and the till keeps
   trading. A fault that means the till can no longer be trusted — the local
   database file, the sealed activation or the sealed credentials — is a
   different thing: swallowing it would let the register keep taking money on a
   broken foundation. Those are logged as fatal and the window is told to stop.
   --------------------------------------------------------------------------- */

/** Faults that mean the till's own records or identity are unsound. */
const FATAL_PATTERNS = [
  /terminal-config/i,
  /safeStorage|DPAPI|decryptString/i,
  /EROFS|ENOSPC/i,
];

function isFatal(error) {
  const text = `${error?.code ?? ""} ${error?.message ?? String(error ?? "")}`;
  return FATAL_PATTERNS.some((p) => p.test(text));
}

/** Tell every window the till must stop, then leave it on screen to be read. */
function haltForFatal(detail) {
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("app:fatal", {
        message:
          "This till has stopped because its own records or identity could not be trusted. Do not take payments on it. Call support and quote the diagnostics log.",
        detail,
      });
    }
  } catch {
    /* the window may already be gone */
  }
}

function recordFault(scope, error) {
  const fatal = isFatal(error);
  const detail = {
    error: error?.message ?? String(error),
    severity: fatal ? "fatal" : "recoverable",
    stack: String(error?.stack ?? "")
      .split("\n")
      .slice(0, 4)
      .join(" | "),
  };
  try {
    diagnostics.logCrash(scope, detail);
  } catch {
    console.error(`[pos] ${scope}:`, error);
  }
  if (fatal) haltForFatal(detail);
}

process.on("uncaughtException", (error) => recordFault("main.uncaught-exception", error));
process.on("unhandledRejection", (reason) => recordFault("main.unhandled-rejection", reason));


/* ---------------------------------------------------------------------------
   One till per PC.

   Two copies of the register on the same machine would each hold their own
   bill number, drawer state and sync queue, so the second launch is refused
   outright and the window that is already open is brought to the front.
   --------------------------------------------------------------------------- */
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  dialog.showErrorBox(
    "This terminal is already running",
    "The point of sale software is already open on this PC.\n\n" +
      "Switch to the window that is already running — only one till may run " +
      "on a machine at a time.",
  );
  app.quit();
  process.exit(0);
}

/** Built Node server produced by `DESKTOP_BUILD=1 vite build`. */
const serverEntry = path.join(__dirname, "..", "dist-desktop", "server", "index.mjs");

let mainWindow = null;
let displayWindow = null;
let serverProcess = null;
let baseUrl = DEV_URL || null;
/** Cleared as soon as the renderer reports that the till actually mounted. */
let readyWatchdog = null;
let safeMode = false;
/** Set once the operator (or the shell) has genuinely asked the till to close. */
let quitting = false;


/** The till reported in, the page painted, or a person is looking at a screen. */
function markStartupSettled() {
  if (!readyWatchdog) return;
  clearTimeout(readyWatchdog);
  readyWatchdog = null;
}

function enterSafeMode(reason) {
  if (safeMode) return;
  safeMode = true;
  markStartupSettled();
  if (reason) health.markFailed(reason);
  else health.beginRecovery("Repeated failed launches");
  updater.pause();
  // The repair window opens FIRST: destroying the last till window with no
  // replacement on screen fires `window-all-closed`, which used to quit the
  // whole app — the operator saw the till vanish instead of a repair screen.
  recovery.open();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!recovery.isOwn(win)) win.destroy();
  }
  mainWindow = null;
  displayWindow = null;
}



/* ------------------------- local app server ------------------------- */

/**
 * The renderer keeps preferences (branding, theme, scale) in browser storage,
 * which is keyed by origin — so the local server must come back on the SAME
 * port every launch. Only fall back to a random port if it is taken.
 */
const PREFERRED_PORT = Number(process.env.POS_APP_PORT) || 43117;

function portFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.unref();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}

function randomPort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function choosePort() {
  if (await portFree(PREFERRED_PORT)) return PREFERRED_PORT;
  return randomPort();
}

function waitForPort(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = net.connect(port, "127.0.0.1");
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() > deadline)
          reject(new Error(`Local app server did not start on port ${port}`));
        else setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

async function startAppServer() {
  if (!fs.existsSync(serverEntry)) {
    throw new Error(`Desktop build missing (${serverEntry}). Run: npm run desktop:build`);
  }
  // Older builds sealed a central service key on this machine. It is no longer
  // used or accepted, so it is erased the first time this build starts.
  serverKeys.purgeLegacyServiceKey();
  const port = await choosePort();
  // ELECTRON_RUN_AS_NODE makes the bundled Electron binary behave as plain
  // Node, so the packaged app needs no separate Node.js install.
  serverProcess = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      // Without these the bundled server cannot reach the central database and
      // every cashier sign-in fails with "no key configured".
      ...serverKeys.serverEnv(),
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Piped to a file as well as the console: on a shop PC nobody is watching a
  // console, and a server that refuses to start is exactly what the recovery
  // screen needs evidence for.
  serverProcess.stdout.on("data", (d) => {
    const line = String(d).trimEnd();
    console.log(`[app-server] ${line}`);
    diagnostics.logServer(line);
  });
  serverProcess.stderr.on("data", (d) => {
    const line = String(d).trimEnd();
    console.error(`[app-server] ${line}`);
    diagnostics.logServer(`ERR ${line}`);
  });
  serverProcess.on("exit", (code) => {
    console.error(`[app-server] exited with code ${code}`);
    diagnostics.logServer(`exited with code ${code}`);
    diagnostics.logCrash("app-server.exit", { code });
    // The pages the till is showing now point at a dead address. Go to the
    // repair screen instead of leaving a window that can never load again.
    if (!quitting && !safeMode) enterSafeMode("The local app server stopped");
  });


  await waitForPort(port);
  return `http://127.0.0.1:${port}`;
}

function stopAppServer() {
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
  serverProcess = null;
}

function load(win, route) {
  return win.loadURL(`${baseUrl}${route}`);
}

/**
 * The window that holds the till bridge must stay on the till.
 *
 * Nothing here changes normal use: the app's own pages, the print preview and
 * the update flow all still work. What it stops is a stray or planted link
 * moving this privileged window to somewhere on the internet, or opening a
 * second window that inherits the same bridge. Links to elsewhere are handed
 * to the operator's normal browser instead, where they hold nothing.
 */
function sameApp(target) {
  try {
    const url = new URL(target);
    if (url.protocol === "data:" || url.protocol === "about:") return true;
    if (!baseUrl) return false;
    return url.origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

function lockDownNavigation(win, route) {
  win.webContents.on("will-navigate", (event, target) => {
    if (sameApp(target)) return;
    event.preventDefault();
    diagnostics.logCrash("window.navigation-blocked", { route, target });
    void shell.openExternal(target).catch(() => {});
  });
  win.webContents.on("will-redirect", (event, target) => {
    if (sameApp(target)) return;
    event.preventDefault();
    diagnostics.logCrash("window.redirect-blocked", { route, target });
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    // No second window ever gets the bridge; outside links go to the browser.
    if (!sameApp(url)) void shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });
  // A page in this window may not attach anything of its own to the shell.
  win.webContents.on("will-attach-webview", (event) => event.preventDefault());
}

function instrument(win, route) {
  lockDownNavigation(win, route);
  // A page that painted is proof the build works, whatever screen it landed on
  // — setup, sign-in or the register. Only a window that never renders at all
  // counts as a failed launch.
  win.webContents.on("did-finish-load", () => markStartupSettled());
  win.webContents.on("did-fail-load", (_e, code, description, url) => {
    console.error(`[window] failed to load ${url || route}: ${description} (${code})`);
    diagnostics.logCrash("window.did-fail-load", { route, code, description });
  });

  diagnostics.watchWindow(win, route);
  if (DEBUG) win.webContents.openDevTools({ mode: "detach" });
}

function createWindows(initialRoute = "/") {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: "#0b0b0c",
    // Frameless shell. On Windows the app paints its own minimise / maximise /
    // close buttons inside the title strip so they follow the POS theme.
    titleBarStyle: "hidden",
    ...(process.platform === "darwin"
      ? { trafficLightPosition: { x: 12, y: 12 } }
      : { frame: false }),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  instrument(mainWindow, initialRoute);
  void load(mainWindow, initialRoute);
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    // No tenant keys sealed on this device yet: nudge once, never block.
    if (!cloudCredentials.read()) {
      mainWindow.webContents.send("cloud:setup-required", { platform: "electron" });
    }
  });

  // Keep the in-app maximise icon in step with the real window state.
  const sendWindowState = () =>
    mainWindow?.webContents.send("window:state", { maximized: mainWindow.isMaximized() });
  mainWindow.on("maximize", sendWindowState);
  mainWindow.on("unmaximize", sendWindowState);

  // The customer screen is a companion of the till, never the other way
  // round: closing the till takes the second screen with it.
  mainWindow.on("closed", () => {
    mainWindow = null;
    closeCustomerDisplay();
  });

  // A second monitor becomes the customer-facing display automatically.
  const external = screen.getAllDisplays().find((d) => d.bounds.x !== 0 || d.bounds.y !== 0);
  if (external) {
    displayWindow = new BrowserWindow({
      x: external.bounds.x,
      y: external.bounds.y,
      fullscreen: true,
      backgroundColor: "#0b0b0c",
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    // Closing only the customer screen leaves the till running.
    displayWindow.on("closed", () => {
      displayWindow = null;
    });
    instrument(displayWindow, "/display");
    void load(displayWindow, "/display");
  }
}

/** Destroy the customer-facing window if one is open. Safe to call twice. */
function closeCustomerDisplay() {
  const win = displayWindow;
  displayWindow = null;
  if (win && !win.isDestroyed()) win.destroy();
}
const fail = (err) => ({ ok: false, error: err instanceof Error ? err.message : String(err) });

/* ----------------------------- printing ----------------------------- */

/**
 * Renders receipt HTML in a hidden (but real) window and prints it without any
 * dialog. Offscreen windows are deliberately NOT used: they hand a job to the
 * spooler without a paint surface, so the printer reacts but nothing prints.
 * When no printer name is configured the system default is used.
 */
const PAGE_SIZES = {
  "30mm": { width: 30000, height: 297000 },
  "58mm": { width: 58000, height: 297000 },
  "80mm": { width: 80000, height: 297000 },
};

function printSilent(html, deviceName, paper, dialog = false) {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      show: !!dialog,
      width: 420,
      height: 900,
      ...(dialog ? { title: "Print", autoHideMenuBar: true } : {}),
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false },
    });
    // A receipt is printed content, never a place to browse from.
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event) => event.preventDefault());
    const done = (result) => {
      if (!win.isDestroyed()) win.destroy();
      resolve(result);
    };
    const pageSize =
      PAGE_SIZES[paper] ?? (paper === "letter" ? "Letter" : paper === "a4" ? "A4" : undefined);
    win.webContents.once("did-finish-load", () => {
      // Settle delay so fonts/QR SVG are laid out before the page is rasterised.
      setTimeout(() => {
        if (win.isDestroyed()) return;
        win.webContents.print(
          {
            silent: !dialog,
            printBackground: true,
            margins: { marginType: "none" },
            ...(pageSize ? { pageSize } : {}),
            ...(deviceName ? { deviceName } : {}),
          },
          (success, reason) =>
            done(
              success
                ? { ok: true }
                : reason === "cancelled"
                  ? { ok: true, cancelled: true }
                  : { ok: false, error: reason },
            ),
        );
      }, 350);
    });
    win.webContents.once("did-fail-load", (_e, code, description) =>
      done({ ok: false, error: `${description} (${code})` }),
    );
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  });
}

/**
 * PowerShell helper that pushes a file of bytes into the Windows spooler with
 * the RAW datatype. RAW bypasses the driver entirely, so an ESC/POS drawer
 * pulse reaches the printer untouched and is forwarded to the RJ11 drawer port.
 * Printing by *name* means the printer does not have to be shared.
 */
const RAW_PS = `param([string]$Payload,[string]$PrinterName)
$ErrorActionPreference = 'Stop'
if (-not $PrinterName) {
  $PrinterName = (Get-CimInstance Win32_Printer -Filter "Default=True" | Select-Object -First 1).Name
}
if (-not $PrinterName) { throw 'No printer selected and no Windows default printer found.' }
Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Runtime.InteropServices;
public static class PosRaw {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public class DOCINFO { [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType; }
  [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool OpenPrinter(string src, out IntPtr h, IntPtr pd);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool StartDocPrinter(IntPtr h, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO di);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)]
  public static extern bool WritePrinter(IntPtr h, IntPtr buf, int count, out int written);
  public static void Send(string printer, byte[] data) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero))
      throw new Exception("OpenPrinter failed for '" + printer + "' (" + Marshal.GetLastWin32Error() + ")");
    try {
      DOCINFO di = new DOCINFO();
      di.pDocName = "POS drawer pulse"; di.pDataType = "RAW";
      if (!StartDocPrinter(h, 1, di)) throw new Exception("StartDocPrinter failed (" + Marshal.GetLastWin32Error() + ")");
      try {
        if (!StartPagePrinter(h)) throw new Exception("StartPagePrinter failed (" + Marshal.GetLastWin32Error() + ")");
        IntPtr buf = Marshal.AllocCoTaskMem(data.Length);
        try {
          Marshal.Copy(data, 0, buf, data.Length);
          int written;
          if (!WritePrinter(h, buf, data.Length, out written))
            throw new Exception("WritePrinter failed (" + Marshal.GetLastWin32Error() + ")");
        } finally { Marshal.FreeCoTaskMem(buf); }
      } finally { EndPagePrinter(h); EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
"@
[PosRaw]::Send($PrinterName, [System.IO.File]::ReadAllBytes($Payload))
Write-Output ("sent:" + $PrinterName)
`;

function runProcess(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let stderr = "";
    let stdout = "";
    child.stdout.on("data", (d) => (stdout += String(d)));
    child.stderr.on("data", (d) => (stderr += String(d)));
    child.on("error", (err) => resolve({ ok: false, error: err.message }));
    child.on("exit", (code) =>
      resolve(
        code === 0
          ? { ok: true, stdout: stdout.trim() }
          : { ok: false, error: stderr.trim() || stdout.trim() || `${cmd} exited ${code}` },
      ),
    );
  });
}

/**
 * Writes raw ESC/POS bytes to the printer. Drawers are wired to the receipt
 * printer over RJ11, so the kick pulse has to reach the device unprocessed —
 * a driver-rendered page would swallow it (and spit out a slip instead).
 *
 * Primary path: RAW spooler write to the printer by name (no share needed).
 * Secondary path: copy to a printer share, but only when one is configured.
 */
async function printRaw(bytes, options = {}) {
  const deviceName = options.deviceName || "";
  const share = options.share || "";
  if (process.platform !== "win32") {
    return { ok: false, error: "Raw printing is only supported on Windows" };
  }

  const stamp = Date.now();
  const binFile = path.join(os.tmpdir(), `pos-raw-${stamp}.bin`);
  const psFile = path.join(os.tmpdir(), `pos-raw-${stamp}.ps1`);
  const cleanup = () => {
    for (const f of [binFile, psFile]) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* already gone */
      }
    }
  };

  try {
    fs.writeFileSync(binFile, Buffer.from(bytes));
    fs.writeFileSync(psFile, RAW_PS, "utf8");

    const primary = await runProcess("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      psFile,
      "-Payload",
      binFile,
      "-PrinterName",
      deviceName,
    ]);
    if (primary.ok) {
      cleanup();
      return { ok: true, via: "raw-spooler" };
    }

    if (share) {
      const target = share.startsWith("\\\\") ? share : `\\\\localhost\\${share}`;
      const copied = await runProcess("cmd", ["/c", "copy", "/b", binFile, target]);
      cleanup();
      return copied.ok
        ? { ok: true, via: "share" }
        : { ok: false, error: `${primary.error}; share copy: ${copied.error}` };
    }

    cleanup();
    return { ok: false, error: primary.error };
  } catch (err) {
    cleanup();
    return fail(err);
  }
}


function authorizationServerUrl() {
  const configured = String(configStore.get("backendUrl") ?? "").trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(configured)) return configured;
  // The Vite server owns the API routes during development. A packaged till
  // must use its configured hosted backend because its local app server never
  // carries the central database service credential.
  return DEV_URL ? baseUrl : null;
}

function registerIpc() {
  ipcPrivilege.install(ipcMain, {
    isFirstRun: () => !terminalStore.read() && !cloudCredentials.status().configured,
  });
  ipcMain.handle("admin:status", () => adminSession.status());
  ipcMain.handle("admin:lock", () => { adminSession.clear(); return adminSession.status(); });
  ipcMain.handle("admin:adopt-session", async (_e, value, rawTerminal) => guard.guarded(async () => {
    const proof=guard.credentialProof(typeof value==="string"?{accessToken:value}:value);
    if(!proof.accessToken&&!proof.sessionToken&&!proof.cashierToken)return{ok:false,error:"A verified signed-in user is required."};
    const authorizationUrl=authorizationServerUrl();
    if(!authorizationUrl)return{ok:false,error:"Configure the hosted POS backend address before connecting the local database."};
    const response=await fetch(`${authorizationUrl}/api/v1/pos/ipc-adopt`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(proof)});
    const result=await response.json().catch(()=>({ok:false,error:"Authorization failed."}));
    if(!response.ok||!result.ok)return{ok:false,error:result.error??"Authorization failed."};
    // The hosted backend has now verified this live POS identity. This is the
    // safe point to repair the native activation mirror that boot hydration
    // could not write before a staff session existed.
    const terminal=rawTerminal==null?null:guard.terminalConfig(rawTerminal);
    if(terminal){
      const mirrored=terminalStore.write(terminal);
      if(mirrored?.ok===false)return{ok:false,code:"EACTIVATION_STORE",error:mirrored.error??"Windows secure storage could not save the terminal activation."};
    }
    adminSession.grant(result.level,result.subject,result.permissions,"pos",result.branchId);rememberVerifiedBranch(result.branchId);return{ok:true,level:result.level};
  }));
  ipcMain.handle("admin:unlock", async (_e, username, pin) => guard.guarded(async () => {
    const user = guard.text(username, { name: "username", max: 160 });
    const secret = guard.text(pin, { name: "PIN", max: 32 });
    const authorizationUrl = authorizationServerUrl();
    if (!authorizationUrl) return { ok: false, error: "Configure the hosted POS backend address before connecting the local database." };
    const response = await fetch(`${authorizationUrl}/api/v1/pos/ipc-authorize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: user, pin: secret, terminalId: terminalStore.read()?.terminalId ?? null }),
    });
    const result = await response.json().catch(() => ({ ok: false, error: "Authorization failed." }));
    if (!response.ok || !result.ok) return { ok: false, error: result.error ?? "Authorization failed." };
    adminSession.grant(result.level, result.subject, result.permissions, "manual", result.branchId);
    return { ok: true, level: result.level };
  }));
  ipcMain.handle("database:get-state", () => databaseService.snapshot());
  ipcMain.handle("database:retry-startup", () => databaseService.restore());
  ipcMain.handle("database:authorize-settings", () => ({ ok: true }));
  ipcMain.handle("database:set-enabled", (_e, value) => guard.guarded(async()=>{const state=await databaseService.setEnabled(value===true);if(value===true&&databaseManager.pool)void prepareLocalData().catch(error=>recordFault("local-data.prepare",error));return databaseService.snapshot();}));
  ipcMain.handle("database:list-servers", () => discoverLocalSqlServers());
  ipcMain.handle("database:test-server", (_e, value) => guard.guarded(() => databaseService.testServer(guard.databaseProfile(value))));
  ipcMain.handle("database:list-databases", (_e, value) => guard.guarded(() => databaseService.databases(guard.databaseProfile(value))));
  ipcMain.handle("database:validate", (_e, value) => guard.guarded(() => databaseService.validate(guard.databaseProfile(value, { requireDatabase: true }))));
  ipcMain.handle("database:migrate", (_e, value) => guard.guarded(() => applyMigrations(databaseManager,guard.databaseProfile(value,{requireDatabase:true}))));
  ipcMain.handle("database:save-connect", (_e, value) => guard.guarded(async()=>{
    const result=await databaseService.saveAndConnect(guard.databaseProfile(value,{requireDatabase:true}));
    if(!result.ok)return result;
    try{
      const synchronization=await prepareLocalData();
      return{...result,synchronization,state:databaseService.snapshot()};
    }catch(error){
      // SQL Server is already validated, connected and saved. Cloud readiness
      // is reported separately so missing activation or internet never turns a
      // valid local connection into a failed Save and Connect operation.
      return{...result,ok:true,synchronization:{ok:false,pending:true,code:error?.code??"ESYNC",message:String(error?.message??error)},state:databaseService.snapshot()};
    }
  }));
  ipcMain.handle("database:disconnect", () => databaseService.disconnect());
  ipcMain.handle("database:remove-configuration", () => databaseService.remove());
  ipcMain.handle("database:health", () => databaseService.health());
  ipcMain.handle("database:schema-status", () => databaseService.schemaStatus());
  ipcMain.handle("database:backup", (_e, file) => guard.guarded(() => backupService.backup(guard.filePath(file,{name:"backup file",extension:"bak"}))));
  ipcMain.handle("database:restore", (_e, file) => guard.guarded(async () => { const result=await backupService.restore(guard.filePath(file,{name:"backup file",extension:"bak"})); if(result.ok)await databaseService.restore(); return result; }));
  ipcMain.handle("business:write-batch", (_e, context, ops) => guard.guarded(async() => { const result=await operationsRepository.apply(guard.text(context,{name:"operation context",max:160}), guard.writeOps(ops,{max:200}));scheduleAutomaticSync(250);return result;}));
  ipcMain.handle("business:commit-aggregate", (_e, value) => guard.guarded(async() => {
    const aggregate=guard.aggregate(value);
    try {
      const result=await aggregateRepository.commit(aggregate.kind,aggregate);
      publishBusinessChange({kind:aggregate.kind,branchId:aggregate.branchId??localBranchId(),operationId:result.operationId??null});
      scheduleAutomaticSync(250);
      return result;
    } catch(error) {
      recordFault("business.commit-aggregate", error);
      return {ok:false,code:error?.code??"ESQLSERVER_WRITE",error:error?.message??"The local SQL Server transaction failed.",stage:error?.stage??null,table:error?.table??null,sqlNumber:error?.sqlNumber??null};
    }
  }));
  ipcMain.handle("business:snapshot", () => guard.guarded(() => operationsRepository.snapshot(localBranchId())));
  ipcMain.handle("business:query", (_e, table, options) => guard.guarded(() => operationsRepository.query(
    localBranchId(),
    guard.text(table, { name: "business table", max: 80 }),
    guard.queryOptions(options),
  )));
  ipcMain.handle("business:shift-expected", (_e, shiftId) => guard.guarded(() =>
    operationsRepository.shiftExpectedTotals(localBranchId(), guard.uuid(shiftId, { name: "shift id" })),
  ));
  ipcMain.handle("receipts:find-exact", (_e, value, branchId, proof) => guard.guarded(() => {
    const input = guard.options(proof, { name: "receipt authorization", max: 3 });
    const authorization = {
      ...(input.sessionToken ? { sessionToken: guard.text(input.sessionToken, { name: "session token", max: 400 }) } : {}),
      ...(input.cashierToken ? { cashierToken: guard.text(input.cashierToken, { name: "cashier token", max: 2000 }) } : {}),
      ...(input.accessToken ? { accessToken: guard.text(input.accessToken, { name: "access token", max: 4000 }) } : {}),
    };
    return receiptRepository.findExact(
      guard.text(value, { name: "receipt lookup", max: 128 }),
      guard.text(branchId, { name: "branch", max: 128 }),
      authorization,
    );
  }));
  ipcMain.handle("receipts:refund", (_e, value) => guard.guarded(() => { const input=guard.options(value,{name:"refund",max:5}); const terminal=terminalStore.read()??{}; const branch=input.branchId??terminal.locationId??terminal.storeId; return receiptRepository.refund({saleId:guard.uuid(input.saleId,{name:"sale id"}),refundId:guard.text(input.refundId,{name:"refund id",max:128}),branchId:guard.text(branch,{name:"branch",max:128}),reason:input.reason?guard.text(input.reason,{name:"reason",max:400}):null}); }));
  ipcMain.handle("jobs:get-active", async () => databaseManager.pool ? jobRepository.active() : null);
  ipcMain.handle("jobs:get-history", async (_e, limit) => databaseManager.pool ? jobRepository.history(Number(limit)||50) : []);
  ipcMain.handle("sync:get-status", () => syncCoordinator.snapshot());
  ipcMain.handle("sync:run-now", (_e, options) => guard.guarded(async()=>{const input=guard.options(options,{name:"sync options"});const result=await syncCoordinator.runNow({...input,branchId:input.branchId??localBranchId()});return result.code==="ECHANGEGAP"?prepareLocalData({force:true}):result;}));
  ipcMain.handle("sync:auto", async () => {
    if(!databaseManager.pool||!localBranchId())return{ok:false,skipped:true};
    return syncCoordinator.runNow({branchId:localBranchId(),batchSize:500});
  });
  ipcMain.handle("sync:pause", () => syncCoordinator.pause());
  ipcMain.handle("sync:resume", () => syncCoordinator.resume());
  ipcMain.handle("sync:get-failures", async () => ({ failures:databaseManager.pool?await jobRepository.failures():[], conflictRows:databaseManager.pool?await conflictRepository.unresolved():[], conflicts:databaseManager.pool?await conflictRepository.count():0 }));
  ipcMain.handle("sync:reconcile", (_e, options) => guard.guarded(async()=>{try{const input=guard.options(options,{name:"reconciliation options"});const branchId=localBranchId();if(!branchId)throw Object.assign(new Error("A branch is required for reconciliation."),{code:"EBRANCH"});const historyDays=Number(databaseConfig.profile()?.retentionDays)||90;if(input.deep===true){const report=await localDataLifecycle.verify(branchId,historyDays,Array.isArray(input.tables)?input.tables:[]);return{ok:true,verified:report.verified,differences:report.tables.filter(table=>!table.verified),verification:report.tables,lastVerifiedAt:report.verifiedAt};}const differences=input.repair===true?await localDataLifecycle.repair(branchId,historyDays,Array.isArray(input.tables)?input.tables:[]):await localDataLifecycle.reconcile(branchId,historyDays);return{ok:true,matched:differences.length===0,differences,verification:syncCoordinator.snapshot().tables,lastComparedAt:syncCoordinator.snapshot().lastComparedAt};}catch(error){return{ok:false,code:error?.code??"ERECONCILE",error:String(error?.message??error)};}}));
  ipcMain.handle("telemetry:presence", (_e, value) => guard.guarded(() => {
    const input = guard.options(value, { name: "telemetry presence", max: 3 });
    return mainTelemetry.setPresence({
      sessionStatus: input.sessionStatus === "signed_in" ? "signed_in" : "idle",
      staffName: input.staffName ? guard.text(input.staffName, { name: "staff name", max: 160 }) : null,
      staffRole: input.staffRole ? guard.text(input.staffRole, { name: "staff role", max: 64 }) : null,
    });
  }));
  ipcMain.handle("staff:roster", (_e, storeId) => localStaffStore.roster(storeId));
  ipcMain.handle("staff:cache-roster", (_e, rows) => localStaffStore.cache(rows));
  ipcMain.handle("staff:enroll", async (_e, username, pin) => {
    const authorizationUrl=authorizationServerUrl();
    if(!authorizationUrl)return{ok:false,error:"The hosted POS backend is not configured."};
    const terminal=terminalStore.read()??{};
    const response=await fetch(`${authorizationUrl}/api/public/cashier-login`,{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({username:String(username??""),pin:String(pin??""),platform:"windows-offline-enrollment",terminalId:terminal.tokenId??null,branchId:localBranchId()}),
    });
    const result=await response.json().catch(()=>({ok:false,error:"Credential verification failed."}));
    if(!response.ok||!result.ok||!result.cashier)return{ok:false,error:result.error??"Credential verification failed."};
    return localStaffStore.enroll(result.cashier,String(pin??""));
  });
  ipcMain.handle("staff:verify-pin", async (_e, username, pin) => {
    const cached = localStaffStore.verify(username, pin);
    if (cached.ok || cached.reason === "locked") return cached;
    try {
      const synced = await verifySyncedStaffPin(databaseManager.pool, username, pin, localBranchId());
      if (synced.ok) {
        const enrolled = localStaffStore.enroll(synced.staff, String(pin ?? ""));
        return enrolled?.ok === false ? enrolled : localStaffStore.verify(username, pin);
      }
      if (synced.reason === "inactive") return synced;
    } catch {
      /* A missing local SQL connection falls back to the enrolled verifier. */
    }
    return cached;
  });
  ipcMain.handle("app:ready", () => {
    markStartupSettled();
    const state = health.markHealthy();
    const resumed = updater.resume();
    return { ok: true, health: state, updatesResumed: resumed.resumed };
  });
  ipcMain.handle("health:state", () => ({ ...health.read(), version: app.getVersion(), safeMode }));
  ipcMain.handle("health:rollback", async () => {
    const { lastGoodVersion } = health.read();
    updater.pause();
    return updater.rollback(lastGoodVersion, (percent) => recovery.progress({ percent }));
  });
  ipcMain.handle("health:resume-updates", () => { health.reset(); return updater.resume(); });
  ipcMain.handle("health:retry", () => { health.reset(); app.relaunch(); app.exit(0); });
  ipcMain.handle("health:open-logs", () => shell.openPath(app.getPath("userData")));
  ipcMain.handle("health:collect-diagnostics", () => {
    const result = diagnostics.writeReport({ appVersion: app.getVersion(), storage: "sqlserver-local-first" });
    if (result.ok) shell.showItemInFolder(result.file);
    return result;
  });
  ipcMain.handle("health:quit", () => app.quit());

  ipcMain.handle("print:silent", async (_e, html, options) => guard.guarded(async () => {
    const body = guard.text(html, { name: "receipt", max: 2 * 1024 * 1024 });
    const opts = guard.plainObject(options, { name: "print options" });
    try { return await printSilent(body, guard.shellSafeText(opts.deviceName, { name: "printer name" }) || undefined, guard.text(opts.paper, { name: "paper size", max: 32, allowEmpty: true }) || undefined, !!opts.dialog); }
    catch (err) { return fail(err); }
  }));
  ipcMain.handle("print:raw", async (_e, bytes, options) => guard.guarded(async () => {
    const opts = guard.plainObject(options, { name: "print options" });
    return printRaw(guard.bytes(bytes), {
      deviceName: guard.shellSafeText(opts.deviceName, { name: "printer name" }),
      share: guard.shellSafeText(opts.share, { name: "printer share" }),
    });
  }));
  ipcMain.handle("print:list", async () => {
    try {
      const target = mainWindow ?? BrowserWindow.getAllWindows()[0];
      const printers = target ? await target.webContents.getPrintersAsync() : [];
      return { ok: true, printers: printers.map((p) => ({ name: p.name, displayName: p.displayName || p.name, isDefault: Boolean(p.isDefault) })) };
    } catch (err) { return { ok: false, printers: [], error: fail(err).error }; }
  });

  ipcMain.handle("update:status", () => updater.status());
  ipcMain.handle("update:check", () => updater.check());
  ipcMain.handle("update:install", () => updater.install());
  ipcMain.handle("update:diagnose", () => updater.diagnose());
  ipcMain.handle("update:download-page", () => updater.downloadPage());
  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("net:get-json", (_e, url) => netHttp.getJson(String(url)));
  ipcMain.handle("net:head", (_e, url) => netHttp.head(String(url)));
  ipcMain.handle("net:get-binary", (_e, url) => netHttp.getBinary(String(url)));

  ipcMain.handle("terminal:read", () => ({ ok: true, config: terminalStore.read() }));
  ipcMain.handle("terminal:write", (_e, raw) => {
    try {
      const config=guard.terminalConfig(raw);
      const activationBackend=String(config?.backendUrl??"").trim().replace(/\/+$/,"");
      const savedBackend=String(configStore.get("backendUrl")??"").trim().replace(/\/+$/,"");
      // The connection page is authoritative. Older activation payloads may
      // have no backend, while a development activation may contain a local
      // http origin; neither may erase a proven HTTPS deployment address.
      const backend=/^https:\/\/.+/i.test(savedBackend)?savedBackend:/^https:\/\/.+/i.test(activationBackend)?activationBackend:"";
      if(backend)configStore.set("backendUrl",backend);
      return terminalStore.write(config?{...config,...(backend?{backendUrl:backend}:{})}:config);
    }
    catch (err) { return guard.refuse(err.message); }
  });
  ipcMain.handle("terminal:clear", () => terminalStore.write(null));

  ipcMain.handle("config:read", () => ({ ok: true, config: configStore.readAll(), path: configStore.filePath(), sealed: configStore.encryptionAvailable() }));
  ipcMain.handle("config:write", (_e, patch) => guard.guarded(() => configStore.merge(guard.plainObject(patch, { name: "settings" }))));
  ipcMain.handle("config:get", (_e, key) => guard.guarded(() => ({ ok: true, value: configStore.get(guard.key(key)) })));
  ipcMain.handle("config:set", (_e, key, value) => guard.guarded(() => configStore.set(guard.key(key), value)));
  ipcMain.handle("config:reset", () => configStore.reset());
  ipcMain.handle("settings:get", (_e, key) => ({ ok: true, value: configStore.get(`setting:${String(key)}`) }));
  ipcMain.handle("settings:set", (_e, key, value) => configStore.set(`setting:${String(key)}`, value));

  ipcMain.handle("server-keys:status", () => ({ ok: true, ...serverKeys.status() }));
  ipcMain.handle("backend:get", () => ({ ok: true, url: String(configStore.get("backendUrl") ?? "").trim() }));
  ipcMain.handle("backend:set", (_e, value) => {
    const next = String(value ?? "").trim().replace(/\/+$/, "");
    if (next && !/^https:\/\/.+/i.test(next)) return { ok: false, error: "Enter a full address starting with https://" };
    const saved = configStore.set("backendUrl", next || null);
    if(saved?.ok===false)return saved;
    // Keep the native synchronization identity self-contained as a recovery
    // copy. Both files are protected by the same Windows DPAPI user profile.
    const terminal=terminalStore.read();
    if(terminal){
      const mirroredConfig={...terminal};
      if(next)mirroredConfig.backendUrl=next;else delete mirroredConfig.backendUrl;
      const mirrored=terminalStore.write(mirroredConfig);
      if(mirrored?.ok===false)return mirrored;
    }
    return { ok: true, url: next };
  });
  ipcMain.handle("cloud:status", () => ({ ok: true, ...cloudCredentials.status() }));
  ipcMain.handle("cloud:bootstrap", () => {
    const saved = cloudCredentials.read();
    return saved ? { ok: true, url: saved.url, key: saved.key } : { ok: false };
  });
  ipcMain.handle("cloud:set", (_e, value) => {
    const saved = cloudCredentials.write(value);
    return saved.ok === false ? saved : { ok: true, ...cloudCredentials.status() };
  });
  ipcMain.handle("cloud:remove", () => cloudCredentials.remove());
  ipcMain.handle("branding:read", () => ({ ok: true, branding: brandingStore.read() }));
  ipcMain.handle("branding:write", (_e, branding) => brandingStore.write(branding));

  const owner = (event) => BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
  ipcMain.handle("window:minimize", (e) => { owner(e)?.minimize(); return { ok: true }; });
  ipcMain.handle("window:maximize", (e) => { const win = owner(e); if (!win) return { ok: false, maximized: false }; win.isMaximized() ? win.unmaximize() : win.maximize(); return { ok: true, maximized: win.isMaximized() }; });
  ipcMain.handle("window:close", (e) => { owner(e)?.close(); return { ok: true }; });
  ipcMain.handle("window:is-maximized", (e) => ({ maximized: !!owner(e)?.isMaximized() }));
}

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    delete headers["content-security-policy"];
    delete headers["Content-Security-Policy"];
    headers["Content-Security-Policy"] = [["default-src 'self' data: blob:", "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: https:", "font-src 'self' data:", "connect-src 'self' https: wss: http://127.0.0.1:* http://localhost:*", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'"].join("; ")];
    callback({ responseHeaders: headers });
  });
  app.on("second-instance", () => { const win = mainWindow ?? BrowserWindow.getAllWindows()[0]; if (!win || win.isDestroyed()) return; if (win.isMinimized()) win.restore(); win.show(); win.focus(); });
  try { storageHygiene.runOnLaunch(app.getPath("userData"), app.getVersion()); } catch (error) { if (DEBUG) console.warn("[pos] storage hygiene skipped:", fail(error).error); }
  registerIpc();
  const restoredDatabase=await databaseService.restore();
  mainTelemetry.start();
  const boot = health.beginBoot();
  if (health.shouldEnterSafeMode(boot)) { safeMode = true; health.beginRecovery(boot.reason ?? "Repeated failed launches"); updater.pause(); recovery.open(); return; }
  try { if (!baseUrl) baseUrl = await startAppServer(); }
  catch (err) { enterSafeMode(err instanceof Error ? err.message : String(err)); return; }
  // A configured till restores its SQL connection before the terminal route
  // is loaded. If SQL Server is stopped or unreachable, open the database
  // recovery screen instead of exposing a register that cannot persist sales.
  const initialRoute = restoredDatabase.enabled && restoredDatabase.configured && !restoredDatabase.tradingReady
    ? "/database-startup"
    : "/";
  createWindows(initialRoute);
  if(restoredDatabase.state==="enabled_bootstrapping")void prepareLocalData().catch(error=>recordFault("local-data.prepare",error));
  scheduleAutomaticSync(5_000);
  updater.start();
  readyWatchdog = setTimeout(() => enterSafeMode("Startup timed out"), 60_000);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length !== 0) return;
    const database = databaseService.snapshot();
    createWindows(database.enabled && database.configured && !database.tradingReady ? "/database-startup" : "/");
  });
});

app.on("before-quit", () => { quitting = true; stopAutomaticSync(); mainTelemetry.stop(); closeCustomerDisplay(); void databaseManager.close(); });
app.on("window-all-closed", () => {
  if (recovery.isOpen()) return;
  markStartupSettled(); updater.stop(); stopAppServer();
  if (process.platform !== "darwin") app.quit();
});
