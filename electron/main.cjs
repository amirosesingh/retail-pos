const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const { randomUUID } = require("node:crypto");
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
const { AuthorizationRulesRepository } = require("./db/repositories/authorization-rules.cjs");
const { applyMigrations, migrationBundleSql } = require("./db/migrations.cjs");
const { discoverLocalSqlServers } = require("./db/local-server-discovery.cjs");
const ipcPrivilege = require("./ipc-privilege.cjs");
const adminSession = require("./admin-session.cjs");
const { listSyncedStaff, verifySyncedStaffPin, verifySyncedApprovalPin } = require("./synced-staff-login.cjs");

const databaseConfig = createSecureConfig({ app, safeStorage, configStore });
const databaseManager = new ConnectionManager();
const databaseService = new DatabaseService({
  secureConfig: databaseConfig,
  manager: databaseManager,
  log: diagnostics.logConnection,
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
const authorizationRulesRepository = new AuthorizationRulesRepository(databaseManager);

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
  if(terminal?.tokenId&&!terminal.locationId&&!terminal.storeId&&!terminal.branchId){
    terminalStore.write({...terminal,branchId});
    // The renderer may already have loaded its first local snapshot while the
    // sealed activation still lacked its branch mirror. Wake it immediately;
    // otherwise SQL contains the catalogue but the till remains empty until a
    // full application restart.
    publishBusinessChange({kind:"branch",branchId:String(branchId)});
  }
}
function stampVerifiedBranchOperations(operations,branchId,aggregateKind=null){
  const branchStampedTables=new Set(["audit_logs","shift_sessions","activity_events","authorization_requests","authorization_log","record_edits","member_verifications","entity_status_history"]);
  // Audit rows and staff shift sessions describe work performed on this
  // physical till. Renderer/session state can contain an older branch alias,
  // so Main replaces it with the branch verified from the sealed terminal.
  const verifiedBranchTables=new Set(["audit_logs","shift_sessions"]);
  // A sale performed on this physical till can only belong to the paired
  // terminal branch.  Stamp every financial child consistently so stale UI
  // branch state cannot either block checkout or redirect a sale elsewhere.
  const saleBranchFields=new Map([
    ["sales",["store_id","branch_id"]],
    ["sale_items",["branch_id"]],
    ["payment_transactions",["store_id"]],
    ["item_activity_logs",["store_id"]],
  ]);
  return operations.map((operation)=>{
    const saleFields=aggregateKind==="sale"?saleBranchFields.get(operation.table):null;
    const verified=verifiedBranchTables.has(operation.table);
    const fillMissing=branchStampedTables.has(operation.table);
    if(operation.kind==="insert"||operation.kind==="upsert"){
      if(!saleFields&&!verified&&!fillMissing)return operation;
      return{...operation,rows:operation.rows.map((row)=>{
        if(saleFields)return saleFields.reduce((next,field)=>({...next,[field]:branchId}),{...row});
        return verified||!String(row?.store_id??"").trim()?{...row,store_id:branchId}:row;
      })};
    }
    if(operation.kind==="update"&&verified)
      return{...operation,values:{...operation.values,store_id:branchId}};
    return operation;
  });
}
async function observedDatabaseOperation(category, stage, work) {
  try {
    const result = await work();
    if (result?.ok === false) diagnostics.logConnection(`${category}.${stage}.failed`, {
      category, stage, code: result.code ?? "EDATABASE", message: result.error ?? result.message ?? "The database operation did not complete.",
    });
    else diagnostics.logConnection(`${category}.${stage}.succeeded`, { category, stage });
    return result;
  } catch (error) {
    diagnostics.logConnection(`${category}.${stage}.failed`, {
      category, stage, code: error?.code ?? "EDATABASE", message: error?.message ?? String(error),
    });
    throw error;
  }
}
let localDataPreparePromise=null;
function prepareLocalData({force=false}={}){
  // Startup, the automatic ECHANGEGAP recovery path, and a manual database
  // action can request preparation together. Share one lifecycle run so a
  // periodic push cannot race the scoped checkpoint repairs.
  if(localDataPreparePromise)return localDataPreparePromise;
  const profile=databaseConfig.profile()??{};
  localDataPreparePromise=(async()=>{
    try{
      const result=await localDataLifecycle.ensure({branchId:localBranchId(),historyDays:Number(profile.retentionDays)||90,force});
      diagnostics.logConnection("synchronization.bootstrap.succeeded", { category:"synchronization", stage:"bootstrap", state:"ready" });
      return result;
    }
    catch(error){
      // Reaching this function means SQL Server already passed validation and is
      // connected. A cloud, activation or reconciliation problem belongs to the
      // synchronization status; it must not describe the healthy local database
      // as degraded or disable offline trading.
      databaseService.markReady({phase:"sync_pending",syncReady:false,code:error?.code??"EBOOTSTRAP",error:String(error?.message??error),differences:error?.differences});
      diagnostics.logConnection("synchronization.bootstrap.failed", { category:"synchronization", stage:"bootstrap", code:error?.code??"EBOOTSTRAP", message:String(error?.message??error) });
      throw error;
    }
  })().finally(()=>{localDataPreparePromise=null;});
  return localDataPreparePromise;
}

const AUTO_SYNC_OK_MS = 15_000;
const AUTO_SYNC_RETRY_MS = 60_000;
const AUTO_VERIFY_MS = 15 * 60_000;
const SHUTDOWN_SYNC_TIMEOUT_MS = 8_000;
let automaticSyncTimer = null;
let automaticSyncQueued = false;
let lastAutomaticVerification = 0;
let terminalIdentityPausedSync = false;
function scheduleAutomaticSync(delay = AUTO_SYNC_OK_MS) {
  if (quitting) return;
  if (syncCoordinator.running && delay <= 250) automaticSyncQueued = true;
  if (automaticSyncTimer) clearTimeout(automaticSyncTimer);
  automaticSyncTimer = setTimeout(() => void runAutomaticSync(), Math.max(250, delay));
  automaticSyncTimer.unref?.();
}
async function runAutomaticSync() {
  automaticSyncTimer = null;
  // A cached administrator branch is never a substitute for a registered
  // terminal identity. Revocation clears the vault before this can run again.
  if (!terminalStore.read()?.tokenId || !databaseManager.isConnected() || !localBranchId() || jobManager.running || localDataPreparePromise || syncCoordinator.paused) {
    scheduleAutomaticSync();
    return;
  }
  if (syncCoordinator.running) {
    automaticSyncQueued = true;
    scheduleAutomaticSync(250);
    return;
  }
  automaticSyncQueued = false;
  let result = await syncCoordinator.runNow({ branchId: localBranchId(), batchSize: 10 });
  if (!result.ok) diagnostics.logConnection("synchronization.automatic.failed", { category:"synchronization", stage:result.stage??"automatic", code:result.code??"ESYNC", message:result.error??result.message??"Automatic synchronization failed." });
  if (result.code === "ECHANGEGAP") {
    try {
      await prepareLocalData({ force: true });
      result = { ok: true };
    } catch (error) {
      result = { ok: false, error: String(error?.message ?? error) };
    }
  }
  if (result.ok) diagnostics.logConnection("synchronization.automatic.succeeded", { category:"synchronization", stage:"automatic", state:"ready" });
  if (result.ok && Date.now() - lastAutomaticVerification >= AUTO_VERIFY_MS) {
    lastAutomaticVerification = Date.now();
    void localDataLifecycle.reconcile(localBranchId(), Number(databaseConfig.profile()?.retentionDays)||90)
      .catch((error) => recordFault("sync.verify-counts", error));
  }
  scheduleAutomaticSync(automaticSyncQueued ? 250 : result.ok ? AUTO_SYNC_OK_MS : AUTO_SYNC_RETRY_MS);
}
function stopAutomaticSync() {
  if (automaticSyncTimer) clearTimeout(automaticSyncTimer);
  automaticSyncTimer = null;
}

const shutdownDelay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function flushSyncBeforeShutdown() {
  const branchId = localBranchId();
  if (!databaseManager.isConnected() || !branchId || syncCoordinator.paused) return { skipped: true };
  const deadline = Date.now() + SHUTDOWN_SYNC_TIMEOUT_MS;
  while (syncCoordinator.running && Date.now() < deadline) await shutdownDelay(50);
  let result = { ok: true, pushed: 0 };
  do {
    const remaining = deadline - Date.now();
    if (remaining <= 0 || syncCoordinator.running) return { ...result, timedOut: true };
    let timeout;
    result = await Promise.race([
      syncCoordinator.runNow({ branchId, batchSize: 10 }),
      new Promise((resolve) => { timeout = setTimeout(() => resolve({ ok: false, timedOut: true }), remaining); }),
    ]).finally(() => clearTimeout(timeout));
    // One run drains every normal change-tracking page. Aggregate journals are
    // capped at 500 per run, so repeat only when that cap may have been hit.
  } while (result.ok && Number(result.pushed ?? 0) >= 500);
  return result;
}

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const DEBUG = process.env.POS_DEBUG === "1";

// Must run before the first window exists, otherwise a native crash in the GPU
// or a driver leaves nothing behind to look at.
diagnostics.startCrashReporter();
diagnostics.watchApp(app);
diagnostics.logConnection("application.started", { state: "starting" });

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
    ...(error?.stage ? { stage: String(error.stage).slice(0, 80) } : {}),
    ...(error?.table ? { table: String(error.table).slice(0, 80) } : {}),
    ...(error?.sqlNumber != null ? { sqlNumber: Number(error.sqlNumber) } : {}),
    ...(error?.sqlDetail ? { sqlDetail: String(error.sqlDetail).slice(0, 500) } : {}),
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
const intentionallyStoppedServers = new WeakSet();
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
  const cloud = cloudCredentials.read();
  const port = await choosePort();
  // ELECTRON_RUN_AS_NODE makes the bundled Electron binary behave as plain
  // Node, so the packaged app needs no separate Node.js install.
  const child = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      // Without these the bundled server cannot reach the central database and
      // every cashier sign-in fails with "no key configured".
      ...serverKeys.serverEnv(),
      ...(cloud
        ? {
            SUPABASE_URL: cloud.url,
            SUPABASE_ANON_KEY: cloud.key,
            SUPABASE_PUBLISHABLE_KEY: cloud.key,
          }
        : {}),
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProcess = child;

  // Piped to a file as well as the console: on a shop PC nobody is watching a
  // console, and a server that refuses to start is exactly what the recovery
  // screen needs evidence for.
  child.stdout.on("data", (d) => {
    const line = String(d).trimEnd();
    console.log(`[app-server] ${line}`);
    diagnostics.logServer(line);
  });
  child.stderr.on("data", (d) => {
    const line = String(d).trimEnd();
    console.error(`[app-server] ${line}`);
    diagnostics.logServer(`ERR ${line}`);
  });
  child.on("exit", (code) => {
    console.error(`[app-server] exited with code ${code}`);
    diagnostics.logServer(`exited with code ${code}`);
    diagnostics.logCrash("app-server.exit", { code });
    // The pages the till is showing now point at a dead address. Go to the
    // repair screen instead of leaving a window that can never load again.
    if (!quitting && !safeMode && !intentionallyStoppedServers.has(child))
      enterSafeMode("The local app server stopped");
  });


  await waitForPort(port);
  return `http://127.0.0.1:${port}`;
}

let cloudServerRestartTimer = null;
function scheduleCloudServerRestart() {
  if (cloudServerRestartTimer) clearTimeout(cloudServerRestartTimer);
  cloudServerRestartTimer = setTimeout(async () => {
    cloudServerRestartTimer = null;
    if (quitting || safeMode) return;
    const currentOrigin = baseUrl ? new URL(baseUrl).origin : "";
    const windows = BrowserWindow.getAllWindows().filter((win) => {
      if (win.isDestroyed() || win.webContents.isDestroyed()) return false;
      try {
        return new URL(win.webContents.getURL()).origin === currentOrigin;
      } catch {
        return false;
      }
    });
    const routes = windows.map((win) => {
      try {
        const current = new URL(win.webContents.getURL());
        return `${current.pathname}${current.search}${current.hash}`;
      } catch {
        return "/";
      }
    });
    try {
      stopAppServer();
      baseUrl = await startAppServer();
      await Promise.all(windows.map((win, index) => load(win, routes[index])));
    } catch (error) {
      recordFault("app-server.cloud-config-restart", error);
      enterSafeMode("The local app server could not apply the saved cloud connection");
    }
  }, 1_000);
}

function stopAppServer() {
  if (serverProcess && !serverProcess.killed) {
    intentionallyStoppedServers.add(serverProcess);
    serverProcess.kill();
  }
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

const shiftMoney = (value) => Math.round(Number(value ?? 0) * 100) / 100;

async function startLocalShiftClose(raw) {
  const branchId = localBranchId();
  if (!branchId) throw Object.assign(new Error("The terminal branch is not configured."), { code: "EBRANCH" });
  const shiftId = guard.uuid(raw.shiftId, { name: "shift id" });
  const reason = guard.text(raw.reason, { name: "shift close reason", max: 400 }).trim();
  if (!reason) throw new Error("A reason for closing this shift is required.");
  const result = await operationsRepository.query(branchId, "shifts", { match: { id: shiftId }, limit: 1 });
  const shift = result.rows?.[0];
  if (!shift) throw new Error("That shift no longer exists on this terminal.");
  const state = String(shift.state ?? (shift.closed_at ? "CLOSED" : "ACTIVE"));
  if (state !== "ACTIVE") return { ok: true, state, replayed: true };
  const identity = adminSession.identity();
  const actor = identity?.subject ?? String(shift.opened_by_name ?? "");
  const terminalId = String(raw.terminalId ?? shift.terminal_id ?? "").trim() || null;
  const differentOperator = Boolean(shift.opened_by_staff_id && actor && String(shift.opened_by_staff_id) !== actor);
  const differentTerminal = Boolean(shift.terminal_id && String(shift.terminal_id) !== terminalId);
  const forced = differentOperator || differentTerminal;
  if (forced && !adminSession.hasPermission("can_manage_other_shifts"))
    throw Object.assign(new Error("You do not have permission to close another employee or terminal shift."), { code: "EFORBIDDEN" });
  const now = new Date().toISOString();
  await operationsRepository.apply("Starting shift close", [
    { kind: "update", table: "shifts", match: { id: shiftId }, values: {
      store_id: branchId, state: "CASH_COUNT_REQUIRED", close_reason: reason,
      closing_started_at: now, closing_started_by: actor, updated_at: now,
    } },
    { kind: "insert", table: "shift_close_events", rows: [{
      id: randomUUID(), shift_id: shiftId, store_id: branchId, terminal_id: terminalId,
      event: "closing_started", from_state: "ACTIVE", to_state: "CASH_COUNT_REQUIRED",
      detail: {
        reason, forced,
        opened_by_staff_id: shift.opened_by_staff_id ?? null,
        opened_terminal_id: shift.terminal_id ?? null,
      },
      actor_name: actor, actor_staff_id: actor, created_at: now,
    }] },
  ]);
  publishBusinessChange({ kind: "shift", branchId, operationId: shiftId });
  scheduleAutomaticSync(250);
  return { ok: true, state: "CASH_COUNT_REQUIRED" };
}

/**
 * Trusted offline close. Expected totals and variance never cross into the renderer;
 * only the resulting workflow state is returned.
 */
async function commitLocalShiftCashCount(raw) {
  const branchId = localBranchId();
  if (!branchId) throw Object.assign(new Error("The terminal branch is not configured."), { code: "EBRANCH" });
  const shiftId = guard.uuid(raw.shiftId, { name: "shift id" });
  const cash = Number(raw.cash);
  const card = raw.card == null ? null : Number(raw.card);
  const digital = raw.digital == null ? null : Number(raw.digital);
  if (!Number.isFinite(cash) || cash < 0) throw new Error("Enter the cash counted in the drawer.");
  if (card != null && (!Number.isFinite(card) || card < 0)) throw new Error("The card total counted cannot be negative.");
  if (digital != null && (!Number.isFinite(digital) || digital < 0)) throw new Error("The digital total counted cannot be negative.");
  const shifts = await operationsRepository.query(branchId, "shifts", { match: { id: shiftId }, limit: 1 });
  const shift = shifts.rows?.[0];
  if (!shift) throw new Error("That shift no longer exists on this terminal.");
  const state = String(shift.state ?? (shift.closed_at ? "CLOSED" : "ACTIVE"));
  if (state === "ACTIVE") throw new Error("Start the closing process before counting the drawer.");
  if (!["CLOSING_STARTED", "CASH_COUNT_REQUIRED"].includes(state)) return { ok: true, state };
  const prior = await operationsRepository.query(branchId, "shift_cash_counts", { match: { shift_id: shiftId, kind: "ORIGINAL" }, limit: 1 });
  if (prior.rows?.length) {
    const current = await operationsRepository.query(branchId, "shifts", { match: { id: shiftId }, limit: 1 });
    return { ok: true, state: String(current.rows?.[0]?.state ?? "CLOSED"), replayed: true };
  }
  const expected = await operationsRepository.shiftExpectedTotals(branchId, shiftId);
  const storeResult = await operationsRepository.query(branchId, "stores", { match: { id: branchId }, limit: 1 });
  const expectedCash = shiftMoney(expected.expected_cash);
  const expectedCard = shiftMoney(expected.expected_card);
  const expectedDigital = shiftMoney(expected.expected_digital);
  const countedCash = shiftMoney(cash);
  const countedCard = card == null ? null : shiftMoney(card);
  const countedDigital = digital == null ? null : shiftMoney(digital);
  const varianceCash = shiftMoney(countedCash - expectedCash);
  const varianceCard = countedCard == null ? null : shiftMoney(countedCard - expectedCard);
  const varianceDigital = countedDigital == null ? null : shiftMoney(countedDigital - expectedDigital);
  const varianceTotal = shiftMoney(varianceCash + (varianceCard ?? 0) + (varianceDigital ?? 0));
  const varianceStatus = Math.abs(varianceTotal) <= 0.005 ? "NO_VARIANCE" : varianceTotal > 0 ? "OVER" : "SHORT";
  const identity = adminSession.identity();
  const actor = identity?.subject ?? String(shift.opened_by_name ?? "");
  const terminalId = String(raw.terminalId ?? shift.terminal_id ?? "").trim() || null;
  const countId = randomUUID();
  const reconciliationId = randomUUID();
  const now = new Date().toISOString();
  const openingFloat = shiftMoney(shift.opening_float);
  const totalSales = shiftMoney(expected.total_sales);
  const netCashSales = shiftMoney(expectedCash - openingFloat);
  const branchName = String(storeResult.rows?.[0]?.name ?? branchId);
  const terminalName = String(shift.terminal_name ?? terminalId ?? "");
  const operations = [
    { kind: "insert", table: "shift_cash_counts", rows: [{
      id: countId, shift_id: shiftId, store_id: branchId, terminal_id: terminalId,
      kind: "ORIGINAL", counted_cash: countedCash, counted_card: countedCard,
      counted_digital: countedDigital, reason: shift.close_reason ?? null,
      counted_by_name: actor, counted_by_staff_id: actor,
      client_key: String(raw.clientKey ?? `${shiftId}:original`), created_at: now,
    }] },
    { kind: "insert", table: "shift_reconciliations", rows: [{
      id: reconciliationId, shift_id: shiftId, store_id: branchId, count_id: countId,
      expected_cash: expectedCash, expected_card: expectedCard, expected_digital: expectedDigital,
      counted_cash: countedCash, counted_card: countedCard, counted_digital: countedDigital,
      variance_cash: varianceCash, variance_card: varianceCard, variance_digital: varianceDigital,
      variance_total: varianceTotal, variance_status: varianceStatus, created_at: now,
    }] },
    { kind: "insert", table: "shift_close_events", rows: [
      { id: randomUUID(), shift_id: shiftId, store_id: branchId, terminal_id: terminalId,
        event: "cash_count_submitted", from_state: state, to_state: "CASH_COUNT_SUBMITTED",
        detail: { count_id: countId }, actor_name: actor, actor_staff_id: actor, created_at: now },
      { id: randomUUID(), shift_id: shiftId, store_id: branchId, terminal_id: terminalId,
        event: "reconciled", from_state: "CASH_COUNT_SUBMITTED", to_state: "CLOSED",
        detail: { variance_status: varianceStatus, variance_total: varianceTotal },
        actor_name: actor, actor_staff_id: actor, created_at: now },
    ] },
    { kind: "update", table: "shifts", match: { id: shiftId }, values: {
      store_id: branchId, state: "CLOSED", status: "CLOSED",
      closed_at: shift.closed_at ?? now, final_counted_cash: countedCash,
      counted_cash: countedCash, closing_float: countedCash, counted_card: countedCard,
      counted_digital: countedDigital, expected_cash: expectedCash, expected_card: expectedCard,
      expected_digital: expectedDigital, variance_cash: varianceCash,
      variance_card: varianceCard, variance_digital: varianceDigital,
      variance_total: varianceTotal, variance_status: varianceStatus, updated_at: now,
    } },
  ];
  if (varianceStatus !== "NO_VARIANCE") {
    const message = [
      `Cashier: ${actor}`,
      `Branch: ${branchName}`,
      `Terminal: ${terminalName}`,
      `Shift: ${shiftId}`,
      `Closed: ${now}`,
      `Opening float: ${openingFloat.toFixed(2)}`,
      `Total sales: ${totalSales.toFixed(2)}`,
      `Net cash sales: ${netCashSales.toFixed(2)}`,
      `Expected cash: ${expectedCash.toFixed(2)}`,
      `Counted cash: ${countedCash.toFixed(2)}`,
      `Card expected / counted: ${expectedCard.toFixed(2)} / ${countedCard == null ? "not counted" : countedCard.toFixed(2)}`,
      `Digital expected / counted: ${expectedDigital.toFixed(2)} / ${countedDigital == null ? "not counted" : countedDigital.toFixed(2)}`,
      `Variance: ${varianceTotal > 0 ? "+" : ""}${varianceTotal.toFixed(2)}`,
    ].join("\n");
    operations.push({
      kind: "insert", table: "shift_variance_alerts", rows: [{
        id: randomUUID(), shift_id: shiftId, store_id: branchId,
        reconciliation_id: reconciliationId, variance_total: varianceTotal,
        variance_status: varianceStatus, severity: "warning", message,
        delivery_status: "pending", attempts: 0, created_at: now, updated_at: now,
      }],
    });
    operations.push({
      kind: "insert", table: "activity_events", rows: [{
        id: randomUUID(), event_type: "shift_cash_variance", severity: "warning",
        title: "Shift cash variance detected", message, actor_name: actor,
        terminal_id: terminalId, terminal_name: terminalName, store_id: branchId,
        branch_id: branchId, entity_type: "shift", entity_id: shiftId,
        amount: varianceTotal, client_event_id: `shift:${shiftId}:cash_variance`,
        meta: {
          branch_name: branchName, terminal_name: terminalName,
          opened_at: shift.opened_at ?? null, closed_at: now,
          opening_float: openingFloat, total_sales: totalSales, net_cash_sales: netCashSales,
          expected_cash: expectedCash, counted_cash: countedCash,
          expected_card: expectedCard, counted_card: countedCard,
          expected_digital: expectedDigital, counted_digital: countedDigital,
          variance_total: varianceTotal, variance_status: varianceStatus,
          reconciliation_id: reconciliationId,
        },
        created_at: now,
      }],
    });
  }
  try {
    await operationsRepository.apply("Closing shift cash count", operations);
  } catch (error) {
    if (![2601, 2627].includes(Number(error?.number ?? error?.originalError?.info?.number))) throw error;
    const current = await operationsRepository.query(branchId, "shifts", { match: { id: shiftId }, limit: 1 });
    return { ok: true, state: String(current.rows?.[0]?.state ?? "CLOSED"), replayed: true };
  }
  publishBusinessChange({ kind: "shift", branchId, operationId: shiftId });
  scheduleAutomaticSync(250);
  return { ok: true, state: "CLOSED" };
}

async function commitLocalShiftRecount(raw) {
  const branchId = localBranchId();
  if (!branchId) throw Object.assign(new Error("The terminal branch is not configured."), { code: "EBRANCH" });
  const shiftId = guard.uuid(raw.shiftId, { name: "shift id" });
  const reason = guard.text(raw.reason, { name: "recount reason", max: 400 }).trim();
  if (!reason) throw new Error("A reason for the recount is required.");
  const cash = Number(raw.cash);
  const card = raw.card == null ? null : Number(raw.card);
  const digital = raw.digital == null ? null : Number(raw.digital);
  if (!Number.isFinite(cash) || cash < 0) throw new Error("Enter the recounted cash amount.");
  if (card != null && (!Number.isFinite(card) || card < 0)) throw new Error("The card total counted cannot be negative.");
  if (digital != null && (!Number.isFinite(digital) || digital < 0)) throw new Error("The digital total counted cannot be negative.");
  const result = await operationsRepository.query(branchId, "shifts", { match: { id: shiftId }, limit: 1 });
  const shift = result.rows?.[0];
  if (!shift) throw new Error("That shift no longer exists on this terminal.");
  const state = String(shift.state ?? (shift.closed_at ? "CLOSED" : "ACTIVE"));
  if (!["VARIANCE_REVIEW_REQUIRED", "RECONCILIATION", "CLOSED"].includes(state))
    throw new Error("This shift has not been counted yet.");
  const clientKey = String(raw.clientKey ?? `${shiftId}:recount:${cash}:${card ?? ""}:${digital ?? ""}:${reason}`);
  const prior = await operationsRepository.query(branchId, "shift_cash_counts", { match: { client_key: clientKey }, limit: 1 });
  if (prior.rows?.length) return { ok: true, state: "CLOSED", replayed: true };
  const expected = await operationsRepository.shiftExpectedTotals(branchId, shiftId);
  const expectedCash = shiftMoney(expected.expected_cash);
  const expectedCard = shiftMoney(expected.expected_card);
  const expectedDigital = shiftMoney(expected.expected_digital);
  const countedCash = shiftMoney(cash);
  const countedCard = card == null ? null : shiftMoney(card);
  const countedDigital = digital == null ? null : shiftMoney(digital);
  const varianceCash = shiftMoney(countedCash - expectedCash);
  const varianceCard = countedCard == null ? null : shiftMoney(countedCard - expectedCard);
  const varianceDigital = countedDigital == null ? null : shiftMoney(countedDigital - expectedDigital);
  const varianceTotal = shiftMoney(varianceCash + (varianceCard ?? 0) + (varianceDigital ?? 0));
  const varianceStatus = Math.abs(varianceTotal) <= 0.005 ? "NO_VARIANCE" : varianceTotal > 0 ? "OVER" : "SHORT";
  const identity = adminSession.identity();
  const actor = identity?.subject ?? String(shift.opened_by_name ?? "");
  const terminalId = String(raw.terminalId ?? shift.terminal_id ?? "").trim() || null;
  const countId = randomUUID();
  const now = new Date().toISOString();
  try {
    await operationsRepository.apply("Saving shift recount", [
      { kind: "insert", table: "shift_cash_counts", rows: [{
        id: countId, shift_id: shiftId, store_id: branchId, terminal_id: terminalId,
        kind: "RECOUNT", counted_cash: countedCash, counted_card: countedCard,
        counted_digital: countedDigital, reason, counted_by_name: actor,
        counted_by_staff_id: actor, client_key: clientKey, created_at: now,
      }] },
      { kind: "insert", table: "shift_reconciliations", rows: [{
        id: randomUUID(), shift_id: shiftId, store_id: branchId, count_id: countId,
        expected_cash: expectedCash, expected_card: expectedCard, expected_digital: expectedDigital,
        counted_cash: countedCash, counted_card: countedCard, counted_digital: countedDigital,
        variance_cash: varianceCash, variance_card: varianceCard, variance_digital: varianceDigital,
        variance_total: varianceTotal, variance_status: varianceStatus, created_at: now,
      }] },
      { kind: "insert", table: "shift_close_events", rows: [{
        id: randomUUID(), shift_id: shiftId, store_id: branchId, terminal_id: terminalId,
        event: "recount_submitted", from_state: state, to_state: "CLOSED",
        detail: { reason, count_id: countId }, actor_name: actor,
        actor_staff_id: actor, created_at: now,
      }] },
      { kind: "update", table: "shifts", match: { id: shiftId }, values: {
        store_id: branchId, state: "CLOSED", status: "CLOSED", closed_at: shift.closed_at ?? now,
        counted_cash: countedCash, final_counted_cash: countedCash, closing_float: countedCash,
        counted_card: countedCard, counted_digital: countedDigital,
        expected_cash: expectedCash, expected_card: expectedCard, expected_digital: expectedDigital,
        variance_cash: varianceCash, variance_card: varianceCard, variance_digital: varianceDigital,
        variance_total: varianceTotal, variance_status: varianceStatus, updated_at: now,
      } },
    ]);
  } catch (error) {
    if (![2601, 2627].includes(Number(error?.number ?? error?.originalError?.info?.number))) throw error;
    return { ok: true, state: "CLOSED", replayed: true };
  }
  publishBusinessChange({ kind: "shift", branchId, operationId: shiftId });
  scheduleAutomaticSync(250);
  return { ok: true, state: "CLOSED" };
}

async function approveLocalShiftVariance(raw) {
  const branchId = localBranchId();
  if (!branchId) throw Object.assign(new Error("The terminal branch is not configured."), { code: "EBRANCH" });
  const shiftId = guard.uuid(raw.shiftId, { name: "shift id" });
  const result = await operationsRepository.query(branchId, "shifts", { match: { id: shiftId }, limit: 1 });
  const shift = result.rows?.[0];
  if (!shift) throw new Error("That shift no longer exists on this terminal.");
  const state = String(shift.state ?? (shift.closed_at ? "CLOSED" : "ACTIVE"));
  if (state === "CLOSED") return { ok: true, state: "CLOSED", replayed: true };
  if (!["VARIANCE_REVIEW_REQUIRED", "RECONCILIATION"].includes(state))
    throw new Error("This shift is not waiting for variance approval.");
  const identity = adminSession.identity();
  const actor = identity?.subject ?? "";
  const now = new Date().toISOString();
  await operationsRepository.apply("Approving shift variance", [
    { kind: "update", table: "shifts", match: { id: shiftId }, values: {
      store_id: branchId, state: "CLOSED", status: "CLOSED", closed_at: shift.closed_at ?? now,
      closed_by_name: actor, updated_at: now,
    } },
    { kind: "insert", table: "shift_close_events", rows: [{
      id: randomUUID(), shift_id: shiftId, store_id: branchId, terminal_id: shift.terminal_id ?? null,
      event: "variance_approved", from_state: state, to_state: "CLOSED",
      detail: { note: String(raw.note ?? "").slice(0, 400) }, actor_name: actor,
      actor_staff_id: actor, created_at: now,
    }] },
  ]);
  publishBusinessChange({ kind: "shift", branchId, operationId: shiftId });
  scheduleAutomaticSync(250);
  return { ok: true, state: "CLOSED" };
}

function redactShiftRow(row) {
  const copy = { ...row };
  if (!adminSession.hasPermission("can_shift_expected_cash_view"))
    for (const key of ["expected_cash", "expected_card", "expected_digital"]) delete copy[key];
  if (!adminSession.hasPermission("can_shift_counted_cash_view"))
    for (const key of ["counted_cash", "counted_card", "counted_digital", "final_counted_cash", "closing_float"]) delete copy[key];
  if (!adminSession.hasPermission("can_shift_variance_view"))
    for (const key of ["variance_cash", "variance_card", "variance_digital", "variance_total", "variance_status"]) delete copy[key];
  return copy;
}

async function localShiftReconciliationView(shiftId) {
  const branchId = localBranchId();
  if (!branchId) throw Object.assign(new Error("The terminal branch is not configured."), { code: "EBRANCH" });
  const result = await operationsRepository.query(branchId, "shift_reconciliations", {
    match: { shift_id: guard.uuid(shiftId, { name: "shift id" }) },
    orderBy: { column: "created_at", ascending: false }, limit: 200,
  });
  const expected = adminSession.hasPermission("can_shift_expected_cash_view");
  const counted = adminSession.hasPermission("can_shift_counted_cash_view");
  const variance = adminSession.hasPermission("can_shift_variance_view");
  return { ok: true, rows: (result.rows ?? []).map((row) => ({
    id: row.id, shift_id: row.shift_id, store_id: row.store_id, count_id: row.count_id,
    expected_cash: expected ? row.expected_cash : null,
    expected_card: expected ? row.expected_card : null,
    expected_digital: expected ? row.expected_digital : null,
    counted_cash: counted ? row.counted_cash : null,
    counted_card: counted ? row.counted_card : null,
    counted_digital: counted ? row.counted_digital : null,
    variance_cash: variance ? row.variance_cash : null,
    variance_card: variance ? row.variance_card : null,
    variance_digital: variance ? row.variance_digital : null,
    variance_total: variance ? row.variance_total : null,
    variance_status: variance ? row.variance_status : null,
    created_at: row.created_at,
  })) };
}

/** ESC/POS drawer pulses must use drawer:open, where identity and permission are checked. */
function containsDrawerPulse(bytes) {
  const values = Array.from(bytes ?? []);
  for (let index = 0; index <= values.length - 5; index += 1) {
    if (values[index] === 0x1b && values[index + 1] === 0x70 &&
        (values[index + 2] === 0 || values[index + 2] === 1)) return true;
  }
  return false;
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
    isFirstRun: () => !terminalStore.read(),
  });
  ipcMain.handle("admin:status", () => adminSession.status());
  ipcMain.handle("admin:lock", () => { adminSession.clear(); syncCloud.clearAuthorizationProof(); return adminSession.status(); });
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
    adminSession.grant(result.level,result.subject,result.permissions,"pos",result.branchId);
    syncCloud.setAuthorizationProof(proof);
    rememberVerifiedBranch(result.branchId);return{ok:true,level:result.level};
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
  ipcMain.handle("database:set-enabled", (_e, value) => guard.guarded(async()=>{await databaseService.setEnabled(value===true);if(value===true&&databaseManager.isConnected())void prepareLocalData().catch(error=>recordFault("local-data.prepare",error));return databaseService.snapshot();}));
  ipcMain.handle("database:list-servers", () => discoverLocalSqlServers());
  ipcMain.handle("database:test-server", (_e, value) => guard.guarded(() => observedDatabaseOperation("connection","test",() => databaseService.testServer(guard.databaseProfile(value)))));
  ipcMain.handle("database:list-databases", (_e, value) => guard.guarded(() => observedDatabaseOperation("connection","list_databases",() => databaseService.databases(guard.databaseProfile(value)))));
  ipcMain.handle("database:validate", (_e, value) => guard.guarded(() => observedDatabaseOperation("validation","schema",() => databaseService.validate(guard.databaseProfile(value, { requireDatabase: true })))));
  ipcMain.handle("database:migrate", (_e, value) => guard.guarded(async () => {
    const profile=guard.databaseProfile(value,{requireDatabase:true});
    const preflight=await observedDatabaseOperation("migration","preflight",() => databaseService.validate(profile));
    if(!preflight.ok)return preflight;
    const migrated=await observedDatabaseOperation("migration","apply",() => applyMigrations(databaseManager,profile));
    if(!migrated.ok)return migrated;
    const validation=await observedDatabaseOperation("migration","revalidate",() => databaseService.validate(profile));
    if(!validation.ok)return validation;
    return validation.ready?{...migrated,ready:true,validation}:{...migrated,ok:false,code:"EMIGRATION_INCOMPLETE",error:"The migration ran, but schema validation still found differences.",validation};
  }));
  ipcMain.handle("database:migrate-saved", () => guard.guarded(async()=>{
    const wasPaused=syncCoordinator.paused;
    if(!wasPaused)syncCoordinator.pause();
    databaseService.beginMigration();
    try{
      const preflight=await observedDatabaseOperation("migration","preflight",() => databaseService.health());
      if(!preflight.ok){databaseService.migrationFailed(preflight);return{...preflight,state:databaseService.snapshot()};}
      const migrated=await observedDatabaseOperation("migration","apply",() => applyMigrations(databaseManager));
      if(!migrated.ok){databaseService.migrationFailed(migrated);return{...migrated,state:databaseService.snapshot()};}
      const state=await databaseService.revalidateConnected();
      if(!state.tradingReady)return{...migrated,ok:false,code:"EMIGRATION_INCOMPLETE",error:"The packaged migration ran, but the local schema still requires attention.",state};
      databaseService.markReady({phase:"migration_complete",syncReady:!wasPaused});
      return{...migrated,ok:true,ready:true,state:databaseService.snapshot()};
    }finally{if(!wasPaused){syncCoordinator.resume();scheduleAutomaticSync(250);}}
  }));
  ipcMain.handle("database:export-migrations", async()=>{
    const chosen=await dialog.showSaveDialog({
      title:"Save local SQL Server migration",
      defaultPath:path.join(app.getPath("downloads"),`Retail POS Local Migration ${app.getVersion()}.sql`),
      filters:[{name:"SQL Server script",extensions:["sql"]}],
      properties:["showOverwriteConfirmation"],
    });
    if(chosen.canceled||!chosen.filePath)return{ok:false,canceled:true};
    try{fs.writeFileSync(chosen.filePath,migrationBundleSql(app.getVersion()),"utf8");return{ok:true,file:chosen.filePath};}
    catch(error){diagnostics.logConnection("migration.export.failed",{category:"migration",stage:"download",code:"EMIGRATION_EXPORT",message:String(error?.message??error)});return{ok:false,code:"EMIGRATION_EXPORT",error:String(error?.message??error)};}
  });
  ipcMain.handle("database:save-connect", (_e, value) => guard.guarded(async()=>{
    const result=await observedDatabaseOperation("connection","save_connect",() => databaseService.saveAndConnect(guard.databaseProfile(value,{requireDatabase:true})));
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
  ipcMain.handle("business:write-batch", (_e, context, ops) => guard.guarded(async() => { const terminal=terminalStore.read()??{};const branchId=localBranchId();const operations=stampVerifiedBranchOperations(guard.writeOps(ops,{max:200}),branchId);const result=await operationsRepository.apply(guard.text(context,{name:"operation context",max:160}),operations,{branchId,terminalId:terminal.tokenId??terminal.terminalId});scheduleAutomaticSync(250);return result;}));
  ipcMain.handle("business:save-authorization-rule", (_e, value) => guard.guarded(async () => {
    const identity = adminSession.identity();
    if (!identity || !adminSession.hasPosAuthority() || !adminSession.hasPermission("can_access_pos_settings"))
      return { ok: false, code: "PERMISSION_DENIED", error: "POS settings permission is required." };
    const branchId = localBranchId();
    if (!branchId) return { ok: false, code: "EBRANCH", error: "The terminal branch is not configured." };
    try {
      const result = await authorizationRulesRepository.save(value, {
        branchId: String(branchId),
        actor: identity.subject,
        isAdmin: identity.level === "admin",
      });
      publishBusinessChange({ tables: ["authorization_actions", "authorization_action_history"], source: "local" });
      scheduleAutomaticSync(250);
      return result;
    } catch (error) {
      recordFault("business.save-authorization-rule", error);
      return { ok: false, code: error?.code ?? "ESQLSERVER_WRITE", error: error?.message ?? "The authorization rule could not be saved locally." };
    }
  }));
  ipcMain.handle("business:commit-aggregate", (_e, value) => guard.guarded(async() => {
    const aggregate=guard.aggregate(value);
    try {
      const branchId=localBranchId();
      if(!branchId)throw Object.assign(new Error("The terminal branch is not configured."),{code:"EBRANCH"});
      if(adminSession.branchId()&&String(adminSession.branchId())!==String(branchId))
        throw Object.assign(new Error("The signed-in account is not authorized for this terminal branch."),{code:"SYNC_BRANCH_FORBIDDEN"});
      // Early-startup governance events may be emitted before the renderer has
      // learned its branch. Main already owns the verified terminal branch, so
      // fill only a missing value here. Audit rows are the exception: renderer
      // context may contain a pre-canonical branch alias, while Main owns the
      // paired terminal identity, so audit rows always receive that verified
      // branch. Other supplied mismatches remain rejected below.
      const operations=stampVerifiedBranchOperations(aggregate.operations,branchId,aggregate.kind);
      const terminal=terminalStore.read()??{};
      const trustedAggregate={
        ...aggregate,
        operations,
        branchId,
        terminalId:terminal.tokenId??terminal.terminalId??null,
      };
      const result=await aggregateRepository.commit(aggregate.kind,trustedAggregate);
      publishBusinessChange({kind:aggregate.kind,branchId,operationId:result.operationId??null});
      scheduleAutomaticSync(250);
      return result;
    } catch(error) {
      recordFault("business.commit-aggregate", error);
      return {ok:false,code:error?.code??"ESQLSERVER_WRITE",error:error?.message??"The local SQL Server transaction failed.",stage:error?.stage??null,table:error?.table??null,sqlNumber:error?.sqlNumber??null};
    }
  }));
  ipcMain.handle("business:snapshot", () => guard.guarded(async () => {
    const snapshot = await operationsRepository.snapshot(localBranchId(), terminalStore.read()?.tokenId ?? null);
    return { ...snapshot, shifts: (snapshot.shifts ?? []).map(redactShiftRow) };
  }));
  ipcMain.handle("business:query", (_e, table, options) => guard.guarded(async () => {
    try {
      const safeTable = guard.text(table, { name: "business table", max: 80 });
      const result = await operationsRepository.query(localBranchId(), safeTable, guard.queryOptions(options));
      return safeTable === "shifts"
        ? { ...result, rows: (result.rows ?? []).map(redactShiftRow) }
        : result;
    } catch (error) {
      // A fresh, revoked, or not-yet-paired terminal has no trusted branch.
      // Reads can race terminal restoration during startup; return a normal
      // not-ready result instead of rejecting the IPC promise and flooding the
      // Electron/Chromium console with an uncaught handler error.
      if (error?.code === "EBRANCH") {
        return { ok: false, code: "EBRANCH", rows: [], error: error.message };
      }
      throw error;
    }
  }));
  ipcMain.handle("business:shift-expected", (_e, shiftId) => guard.guarded(() =>
    operationsRepository.shiftExpectedTotals(localBranchId(), guard.uuid(shiftId, { name: "shift id" })),
  ));
  ipcMain.handle("business:shift-close-start", (_e, value) => guard.guarded(() =>
    startLocalShiftClose(guard.options(value, { name: "shift close start", max: 3 })),
  ));
  ipcMain.handle("business:shift-close-count", (_e, value) => guard.guarded(() =>
    commitLocalShiftCashCount(guard.options(value, { name: "shift cash count", max: 6 })),
  ));
  ipcMain.handle("business:shift-recount", (_e, value) => guard.guarded(() =>
    commitLocalShiftRecount(guard.options(value, { name: "shift recount", max: 7 })),
  ));
  ipcMain.handle("business:shift-variance-approve", (_e, value) => guard.guarded(() =>
    approveLocalShiftVariance(guard.options(value, { name: "shift variance approval", max: 2 })),
  ));
  ipcMain.handle("business:shift-reconciliation-view", (_e, shiftId) => guard.guarded(() =>
    localShiftReconciliationView(shiftId),
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
  ipcMain.handle("jobs:get-active", async () => databaseManager.isConnected() ? jobRepository.active() : null);
  ipcMain.handle("jobs:get-history", async (_e, limit) => databaseManager.isConnected() ? jobRepository.history(Number(limit)||50) : []);
  ipcMain.handle("sync:get-status", () => syncCoordinator.refresh(localBranchId()));
  ipcMain.handle("sync:run-now", (_e, options) => guard.guarded(async()=>{const input=guard.options(options,{name:"sync options"});const branchId=localBranchId();if(!branchId)throw Object.assign(new Error("The terminal branch is not configured."),{code:"EBRANCH"});const result=await observedDatabaseOperation("synchronization","manual",() => syncCoordinator.runNow({...input,branchId}));return result.code==="ECHANGEGAP"?prepareLocalData({force:true}):result;}));
  ipcMain.handle("sync:auto", async () => {
    if(!databaseManager.isConnected()||!localBranchId())return{ok:false,skipped:true};
    return syncCoordinator.runNow({branchId:localBranchId(),batchSize:10});
  });
  ipcMain.handle("sync:pause", () => syncCoordinator.pause());
  ipcMain.handle("sync:resume", () => syncCoordinator.resume());
  ipcMain.handle("sync:get-failures", async () => ({ databaseErrors:diagnostics.databaseErrors(100), failures:databaseManager.isConnected()?await jobRepository.failures():[], businessBatches:databaseManager.isConnected()?await changeReader.failedAggregates(localBranchId()):[], conflictRows:databaseManager.isConnected()?await conflictRepository.unresolved():[], conflicts:databaseManager.isConnected()?await conflictRepository.count():0 }));
  ipcMain.handle("sync:reconcile", (_e, options) => guard.guarded(async()=>{try{const input=guard.options(options,{name:"reconciliation options"});const branchId=localBranchId();if(!branchId)throw Object.assign(new Error("A branch is required for reconciliation."),{code:"EBRANCH"});const historyDays=Number(databaseConfig.profile()?.retentionDays)||90;if(input.deep===true){const report=await localDataLifecycle.verify(branchId,historyDays,Array.isArray(input.tables)?input.tables:[]);return{ok:true,verified:report.verified,differences:report.tables.filter(table=>!table.verified),verification:report.tables,lastVerifiedAt:report.verifiedAt};}const differences=input.repair===true?await localDataLifecycle.repair(branchId,historyDays,Array.isArray(input.tables)?input.tables:[]):await localDataLifecycle.reconcile(branchId,historyDays);return{ok:true,matched:differences.length===0,differences,verification:syncCoordinator.snapshot().tables,lastComparedAt:syncCoordinator.snapshot().lastComparedAt};}catch(error){return{ok:false,code:error?.code??"ERECONCILE",error:String(error?.message??error)};}}));
  ipcMain.handle("telemetry:presence", (_e, value) => guard.guarded(() => {
    const input = guard.options(value, { name: "telemetry presence", max: 3 });
    return mainTelemetry.setPresence({
      sessionStatus: input.sessionStatus === "signed_in" ? "signed_in" : "idle",
      staffName: input.staffName ? guard.text(input.staffName, { name: "staff name", max: 160 }) : null,
      staffRole: input.staffRole ? guard.text(input.staffRole, { name: "staff role", max: 64 }) : null,
    });
  }));
  ipcMain.handle("staff:roster", async (_e, storeId) => {
    const branchId=localBranchId()??String(storeId??"").trim();
    try {
      return await listSyncedStaff(databaseManager.pool,branchId);
    } catch (error) {
      return {ok:false,reason:"unavailable",rows:[],error:String(error?.message??error)};
    }
  });
  // Compatibility IPCs remain while older renderer bundles are upgraded.
  // Staff rows and PIN verifiers are written only by the cloud-to-SQL sync.
  ipcMain.handle("staff:cache-roster", () => ({ok:true,written:0,source:"sql-sync"}));
  ipcMain.handle("staff:enroll", () => ({ok:true,written:0,source:"sql-sync"}));
  ipcMain.handle("staff:verify-pin", async (_e, username, pin) => {
    try {
      return await verifySyncedStaffPin(databaseManager.pool, username, pin, localBranchId());
    } catch (error) {
      return {ok:false,reason:"unavailable",error:String(error?.message??error)};
    }
  });
  ipcMain.handle("staff:verify-approval-pin", async (_e, username, pin) => {
    try {
      return await verifySyncedApprovalPin(databaseManager.pool, username, pin, localBranchId());
    } catch (error) {
      return {ok:false,reason:"unavailable",error:String(error?.message??error)};
    }
  });
  ipcMain.handle("auth:cashier-login", (_e, value) => guard.guarded(async () => {
    const input = guard.options(value, { name: "cashier sign in", max: 2 });
    const username = guard.text(input.username, { name: "username", max: 120 });
    const pin = guard.text(input.pin, { name: "PIN or passcode", max: 32 });
    const authorizationUrl = authorizationServerUrl();
    if (!authorizationUrl)
      return { ok: false, status: 503, code: "no_server", error: "The hosted POS backend is not configured." };
    const terminal = terminalStore.read() ?? {};
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 6_000);
    const response = await fetch(`${authorizationUrl}/api/public/cashier-login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: abort.signal,
      body: JSON.stringify({
        username,
        pin,
        platform: "electron",
        terminalId: terminal.tokenId ?? null,
        branchId: localBranchId(),
      }),
    }).finally(() => clearTimeout(timer));
    const result = await response.json().catch(() => ({
      ok: false,
      error: "The sign-in service returned an invalid response.",
    }));
    // The hosted endpoint has verified the PIN and re-read this account's
    // current permission matrix. Adopt that proof in the desktop process now,
    // before the renderer can submit its first sale. Requiring the separate
    // database-maintenance permission here made ordinary cashier checkouts
    // fail with EPRIVILEGE even though can_process_sale was granted.
    if (response.ok && result?.ok && result.cashier) {
      const cashier = result.cashier;
      const role = String(cashier.role ?? cashier.role_slug ?? "staff").toLowerCase();
      const level = role === "admin" ? "admin" : role === "manager" || role === "supervisor" ? "supervisor" : "staff";
      const branchId = cashier.store_id ?? localBranchId();
      adminSession.grant(level, cashier.username ?? username, cashier.permissions ?? {}, "pos", branchId);
      const proof = {
        ...(typeof result.sessionToken === "string" ? { sessionToken: result.sessionToken } : {}),
        ...(typeof result.cashierToken === "string" ? { cashierToken: result.cashierToken } : {}),
      };
      syncCloud.setAuthorizationProof(proof);
      rememberVerifiedBranch(branchId);
    }
    return { ...result, status: response.status };
  }));
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
  ipcMain.handle("health:log-connection", (_event, event, detail) => {
    diagnostics.logConnection(
      guard.text(event, { name: "connection event", max: 100 }),
      guard.options(detail, { name: "connection detail", max: 8 }),
    );
    return { ok: true };
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
    const checked = guard.bytes(bytes);
    if (containsDrawerPulse(checked)) return {
      ok: false,
      code: "EDRAWER_CHANNEL",
      error: "Cash drawer pulses must use the protected drawer command.",
    };
    return printRaw(checked, {
      deviceName: guard.shellSafeText(opts.deviceName, { name: "printer name" }),
      share: guard.shellSafeText(opts.share, { name: "printer share" }),
    });
  }));
  ipcMain.handle("drawer:open", async (_e, value) => guard.guarded(async () => {
    const input = guard.options(value, { name: "drawer request", max: 5 });
    const reason = guard.text(input.reason, { name: "drawer reason", max: 400 });
    if (reason.trim().length < 3) return { ok: false, code: "EREASON", error: "A drawer-opening reason is required." };
    const branchId = localBranchId();
    if (!branchId) return { ok: false, code: "EBRANCH", error: "The terminal branch is not configured." };
    if (!databaseManager.isConnected()) return { ok: false, code: "EDATABASE", error: "The local SQL database must be connected before the drawer can open." };
    const identity = adminSession.identity();
    if (!identity) return { ok: false, code: "EAUTH", error: "A verified signed-in user is required." };
    const terminal = terminalStore.read() ?? {};
    const eventId = randomUUID();
    const terminalId = String(terminal.tokenId ?? terminal.terminalId ?? "").trim() || null;
    const shiftId = input.shiftId ? guard.uuid(input.shiftId, { name: "shift id" }) : null;
    const printer = guard.plainObject(input.printer, { name: "printer options" });
    await operationsRepository.apply("Recording cash drawer request", [{
      kind: "insert", table: "drawer_events", rows: [{
        id: eventId,
        store_id: branchId,
        terminal_id: terminalId,
        shift_id: shiftId,
        staff_id: identity.subject,
        staff_name: identity.subject,
        role: identity.level,
        reason: reason.trim(),
        note: "OPEN_REQUESTED",
        approved_by: null,
        created_at: new Date().toISOString(),
      }],
    }]);
    const result = await printRaw([0x1b, 0x70, Number(input.pin) === 5 ? 1 : 0, 0x19, 0xfa], {
      deviceName: guard.shellSafeText(printer.deviceName, { name: "printer name" }),
      share: guard.shellSafeText(printer.share, { name: "printer share" }),
    });
    await operationsRepository.apply("Recording cash drawer result", [{
      kind: "update", table: "drawer_events", match: { id: eventId },
      values: { note: result.ok ? "OPENED" : `FAILED: ${String(result.error ?? "Printer refused the drawer pulse").slice(0, 300)}` },
    }]);
    publishBusinessChange({ kind: "drawer", branchId, operationId: eventId });
    scheduleAutomaticSync(250);
    return { ...result, eventId };
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
  ipcMain.handle("update:download", () => updater.downloadUpdate());
  const installUpdateWhenShiftClosed = async (downloadFirst) => {
    const shifts = await operationsRepository.query(localBranchId(), "shifts", { limit: 500 });
    // CASH_COUNT_REQUIRED is still an open financial shift. Never let either
    // install path quit the till until every shift has a durable closed_at.
    const active = (shifts.rows ?? []).some((shift) => !shift.closed_at);
    if (active) {
      return {
        ok: false,
        code: "EACTIVE_SHIFT",
        error: "Close the active shift before installing an update.",
      };
    }
    return downloadFirst ? updater.downloadAndInstall() : updater.install();
  };
  ipcMain.handle("update:download-install", () => installUpdateWhenShiftClosed(true));
  ipcMain.handle("update:install", () => installUpdateWhenShiftClosed(false));
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
      const saved=terminalStore.write(config?{...config,...(backend?{backendUrl:backend}:{})}:config);
      if(saved?.ok&&config&&terminalIdentityPausedSync){terminalIdentityPausedSync=false;syncCoordinator.resume();scheduleAutomaticSync(250);}
      return saved;
    }
    catch (err) { return guard.refuse(err.message); }
  });
  ipcMain.handle("terminal:clear", () => {
    // Revocation and explicit unpairing stop cloud movement before erasing the
    // identity, even when an old administrator session still caches a branch.
    terminalIdentityPausedSync=true;
    stopAutomaticSync();
    syncCoordinator.pause();
    return terminalStore.write(null);
  });

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
    if (saved.ok === false) return saved;
    scheduleCloudServerRestart();
    return { ok: true, ...cloudCredentials.status() };
  });
  ipcMain.handle("cloud:remove", () => {
    const removed = cloudCredentials.remove();
    if (removed.ok !== false) scheduleCloudServerRestart();
    return removed;
  });
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
    // Cloudflare challenge/RUM responses can include their own report-only
    // policy. Keeping it beside the shell policy produces hundreds of false
    // violations for same-origin challenge scripts and telemetry requests.
    // Remove every casing of both upstream CSP headers, then install the one
    // enforced desktop policy below.
    for (const name of Object.keys(headers)) {
      if (["content-security-policy", "content-security-policy-report-only"].includes(name.toLowerCase())) delete headers[name];
    }
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

let shutdownFlushStarted = false;
let shutdownFlushComplete = false;
app.on("before-quit", (event) => {
  if (shutdownFlushComplete) return;
  event.preventDefault();
  if (shutdownFlushStarted) return;
  shutdownFlushStarted = true;
  quitting = true;
  stopAutomaticSync();
  mainTelemetry.stop();
  closeCustomerDisplay();
  void flushSyncBeforeShutdown()
    .then((result) => {
      if (result?.timedOut) recordFault("shutdown.sync-timeout", new Error("Final synchronization exceeded 8 seconds; pending SQL changes remain durable for next launch."));
      else if (result?.ok === false) recordFault("shutdown.sync", new Error(result.error ?? "Final synchronization failed; pending SQL changes remain durable for next launch."));
    })
    .catch((error) => recordFault("shutdown.sync", error))
    .finally(async () => {
      await databaseManager.close().catch((error) => recordFault("shutdown.database-close", error));
      shutdownFlushComplete = true;
      app.quit();
    });
});
app.on("window-all-closed", () => {
  if (recovery.isOpen()) return;
  markStartupSettled(); updater.stop(); stopAppServer();
  if (process.platform !== "darwin") app.quit();
});
