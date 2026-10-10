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
const closeWriteBarrier = new (require("./sync/write-barrier.cjs").WriteBarrier)();
const { createTelemetry } = require("./telemetry.cjs");
const { OperationsRepository } = require("./db/repositories/operations.cjs");
const { readAnalytics } = require("./db/repositories/analytics.cjs");
const { aggregatePolicy } = require("./db/write-policy.cjs");
const { AggregateRepository } = require("./db/repositories/aggregates.cjs");
const { ReceiptRepository } = require("./db/repositories/receipts.cjs");
const { AuthorizationRulesRepository } = require("./db/repositories/authorization-rules.cjs");
const { applyMigrations, ensureDatabase, migrationBundleSql } = require("./db/migrations.cjs");
const { discoverLocalSqlServers } = require("./db/local-server-discovery.cjs");
const ipcPrivilege = require("./ipc-privilege.cjs");
const adminSession = require("./admin-session.cjs");
const { listSyncedStaff, verifySyncedStaffPin, verifySyncedApprovalPin } = require("./synced-staff-login.cjs");

const databaseConfig = createSecureConfig({ app, safeStorage, configStore });
const databaseManager = new ConnectionManager();
const databaseService = new DatabaseService({
  secureConfig: databaseConfig,
  manager: databaseManager,
  migrate: (profile) => applyMigrations(databaseManager, profile),
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
  pullWorker: new PullWorker({ connectionManager:databaseManager,cloud:syncCloud,checkpoints:syncCheckpoints,registry:syncRegistry,reader:changeReader,conflicts:conflictRepository,publish:publishBusinessChange }),
  publish: (state) => { for (const win of BrowserWindow.getAllWindows()) win.webContents.send("sync:state",state); },
});
const localDataLifecycle = new LocalDataLifecycle({ connectionManager:databaseManager,databaseService,jobManager,jobRepository,registry:syncRegistry,cloud:syncCloud,syncCoordinator,checkpoints:syncCheckpoints,reader:changeReader,publish:publishBusinessChange });
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
    const table=syncRegistry.tables.find((entry)=>entry.sqlServerTable===operation.table);
    const supportedColumns=new Set((table?.columns??[]).map((column)=>column.sqlServerColumn));
    const saleFields=aggregateKind==="sale"
      ? (saleBranchFields.get(operation.table)??[]).filter((field)=>supportedColumns.has(field))
      : null;
    // Receiving is performed by the physical till. Renderer state may still
    // carry an old branch alias after activation recovery, so the purchase
    // header always receives the branch verified from the sealed terminal.
    const receivingFields=aggregateKind==="receiving"&&operation.table==="purchase_orders"
      ? ["store_id"].filter((field)=>supportedColumns.has(field))
      : null;
    const verified=verifiedBranchTables.has(operation.table);
    const fillMissing=branchStampedTables.has(operation.table);
    if(operation.kind==="insert"||operation.kind==="upsert"){
      const rows=operation.rows??(operation.values?[operation.values]:[]);
      if(!rows.length||(!saleFields?.length&&!receivingFields?.length&&!verified&&!fillMissing))return operation;
      const stamped=rows.map((row)=>{
        if(saleFields?.length)return saleFields.reduce((next,field)=>({...next,[field]:branchId}),{...row});
        if(receivingFields?.length)return receivingFields.reduce((next,field)=>({...next,[field]:branchId}),{...row});
        if(!supportedColumns.has("store_id"))return row;
        return verified||!String(row?.store_id??"").trim()?{...row,store_id:branchId}:row;
      });
      return operation.rows
        ? {...operation,rows:stamped}
        : {...operation,values:stamped[0]};
    }
    if(operation.kind==="update"&&verified&&supportedColumns.has("store_id"))
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
let localDatabaseRecoveryPromise=null;
function recoverLocalDatabase({prepare=true}={}){
  if(localDatabaseRecoveryPromise)return localDatabaseRecoveryPromise;
  localDatabaseRecoveryPromise=(async()=>{
    const restored=await databaseService.restore({reuseValidation:!prepare});
    if(!restored.connected||!restored.tradingReady)return restored;
    const branchId=localBranchId();
    if(!branchId)return databaseService.snapshot();
    if(prepare){
      try{await prepareLocalData();}
      catch{return databaseService.snapshot();}
      return databaseService.snapshot();
    }
    try{
      const synced=await syncCoordinator.runNow({branchId,batchSize:10});
      if(synced.code==="ECHANGEGAP")await prepareLocalData({force:true});
      else if(!synced.ok)throw Object.assign(new Error(synced.error??"Synchronization failed after reconnect."),{code:synced.code??"ESYNC"});
      else databaseService.markReady({phase:"reconnected",syncReady:true});
    }catch(error){
      databaseService.markReady({phase:"sync_pending",syncReady:false,code:error?.code??"ESYNC",error:String(error?.message??error)});
    }
    return databaseService.snapshot();
  })().finally(()=>{localDatabaseRecoveryPromise=null;});
  return localDatabaseRecoveryPromise;
}

// Local commits and private cloud notifications wake delta sync immediately.
// The two-minute check flushes activity and recovers missed socket events.
const { ACTIVITY_INTERVAL_MS, activityOnly } = require("./sync/event-policy.cjs");
const AUTO_SYNC_OK_MS = ACTIVITY_INTERVAL_MS;
const AUTO_SYNC_RETRY_MS = 60_000;
const AUTO_VERIFY_MS = 15 * 60_000;
const SHUTDOWN_SYNC_TIMEOUT_MS = 120_000;
const automaticSyncScheduler = require("./sync/scheduler.cjs").createSyncScheduler(runAutomaticSync);
let automaticSyncQueued = false;
let lastAutomaticVerification = 0;
let terminalIdentityPausedSync = false;
let lastActivityFlush = 0;
function scheduleLocalChanges(operations) {
  scheduleAutomaticSync(activityOnly(operations) ? ACTIVITY_INTERVAL_MS : 250);
}
function scheduleAutomaticSync(delay = AUTO_SYNC_OK_MS) {
  if (quitting) return;
  if (syncCoordinator.running && delay <= 250) automaticSyncQueued = true;
  automaticSyncScheduler.schedule(delay);
}
async function runAutomaticSync() {
  const databaseState=databaseService.snapshot();
  if(databaseState.enabled&&databaseState.configured&&!databaseManager.isConnected()){
    const recovered=await recoverLocalDatabase({prepare:false}).catch(error=>{
      recordFault("database.automatic-reconnect",error);
      return databaseService.snapshot();
    });
    scheduleAutomaticSync(recovered.connected?250:AUTO_SYNC_RETRY_MS);
    return;
  }
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
  const includeActivity = Date.now() - lastActivityFlush >= ACTIVITY_INTERVAL_MS;
  let result = await syncCoordinator.runNow({ branchId: localBranchId(), batchSize: 500, includeActivity });
  if (result.ok && includeActivity) lastActivityFlush = Date.now();
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
  scheduleAutomaticSync(automaticSyncQueued ? 250 : result.ok ? Math.max(250, AUTO_SYNC_OK_MS - (Date.now() - lastActivityFlush)) : AUTO_SYNC_RETRY_MS);
}
function stopAutomaticSync() {
  automaticSyncScheduler.stop();
}

const SHUTDOWN_RESOURCE_TIMEOUT_MS = 12_000;

/**
 * Native SQL/ODBC and child-process shutdowns can otherwise keep Electron
 * alive with no windows. The work promise is observed even after the deadline
 * so a late rejection never becomes an unhandled rejection.
 */
function settleWithin(work, timeoutMs = SHUTDOWN_RESOURCE_TIMEOUT_MS) {
  let timer;
  const operation = Promise.resolve()
    .then(work)
    .then(value => ({ ok: true, value }), (error) => ({ ok: false, error }));
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, timedOut: true }), timeoutMs);
  });
  return Promise.race([operation, deadline]).finally(() => clearTimeout(timer));
}

async function flushSyncBeforeShutdown() {
  const branchId = localBranchId();
  if (!databaseManager.isConnected() || !branchId)
    return { ok:false, code:"ELOCALDB", error:"Connect the local database before closing so pending transactions can be checked." };
  const wasPaused = syncCoordinator.paused;
  syncCoordinator.resume();
  try {
    return await require('./sync/shutdown-sync.cjs').finishShutdownSync({
      progress: reportCloseProgress,
      run: async () => {
        const settled = await settleWithin(() => syncCoordinator.runFinal({branchId,batchSize:500}), SHUTDOWN_SYNC_TIMEOUT_MS);
        if (settled.timedOut) return {ok:false,timedOut:true,error:"Synchronization is still running. Your data remains saved locally; retry closing when it finishes."};
        if (!settled.ok) return {ok:false,code:settled.error?.code,error:String(settled.error?.message ?? settled.error)};
        return settled.value;
      },
    });
  } finally { if (wasPaused) syncCoordinator.pause(); }
}

function reportCloseProgress(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('sync:closing', payload);
    mainWindow.setProgressBar(payload.active ? 2 : -1);
  }
}

async function synchronizeClosingShifts(shiftId = null) {
  if (shiftId) pendingShiftCloseSync.add(String(shiftId));
  if (!pendingShiftCloseSync.size) return { ok: true, skipped: true };
  if (mandatoryShiftSyncRun) return mandatoryShiftSyncRun;
  mandatoryShiftSyncRun = (async () => {
    const branchId = localBranchId();
    if (!databaseManager.isConnected() || !branchId)
      return { ok: false, code: "ELOCALDB", error: "The local database is not ready." };
    const healthResult = await syncCloud.health({ timeoutMs: SHUTDOWN_SYNC_TIMEOUT_MS });
    if (!healthResult.online) {
      const remaining = await changeReader.pendingSummary(branchId);
      return { ok: false, offline: true, ...remaining, code:"EOFFLINE", error:"The shift is saved locally but has not been acknowledged by the cloud. Reconnect and retry synchronization before closing." };
    }
    if (!healthResult.ready)
      return {
        ok: false,
        code: healthResult.code ?? "ECENTRAL_UNAVAILABLE",
        error: healthResult.error ?? "The central POS server is not ready.",
      };
    let result = await syncCoordinator.runFinal({ branchId, batchSize: 500 });
    if (result.code === "ECHANGEGAP") {
      await prepareLocalData({ force: true });
      result = await syncCoordinator.runFinal({ branchId, batchSize: 500 });
    }
    if (result.ok) pendingShiftCloseSync.clear();
    return result;
  })();
  try {
    return await mandatoryShiftSyncRun;
  } finally {
    mandatoryShiftSyncRun = null;
  }
}

async function restoreShiftCloseGuard() {
  const branchId = localBranchId();
  if (!databaseManager.isConnected() || !branchId) return;
  const result = await databaseManager.pool.request().input("branch", branchId).query(`SELECT TOP (1) 1 required
    WHERE EXISTS (
      SELECT 1 FROM dbo.shifts
      WHERE store_id=@branch AND COALESCE(state,CASE WHEN closed_at IS NULL THEN 'ACTIVE' ELSE 'CLOSED' END) NOT IN ('ACTIVE','CLOSED')
    ) OR EXISTS (
      SELECT 1 FROM dbo.sync_change_journal
      WHERE branch_id IN (@branch,'global') AND acknowledged_at IS NULL
        AND entity_type IN ('shifts','shift_cash_counts','shift_close_events','shift_reconciliations','shift_variance_alerts','shift_notifications')
    );`);
  if (result.recordset?.length) pendingShiftCloseSync.add("recovered-shift-close");
}

async function showMandatorySyncFailure(result) {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  const response = await dialog.showMessageBox(win, {
    type: "error",
    title: "Synchronization incomplete",
    message: "Synchronization must finish before the application can close.",
    detail: String(result?.error ?? "Retry after checking the synchronization status."),
    buttons: win ? ["Retry sync and close", "Keep application open"] : ["Keep application open"],
    defaultId: 0,
    cancelId: win ? 1 : 0,
    noLink: true,
  });
  if (win && response.response === 0) setImmediate(() => { if (!win.isDestroyed()) win.close(); });
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
/** Shift closes committed locally but not yet finalized against the online peer. */
const pendingShiftCloseSync = new Set();
let mandatoryShiftSyncRun = null;
let allowMainWindowClose = false;
let closePreparation = null;
let installUpdateAfterSync = null;

function flushRendererBeforeClose(forUpdate = false) {
  const win=mainWindow;
  if(!win || win.isDestroyed()) return Promise.resolve();
  const nonce=randomUUID();
  return new Promise((resolve,reject)=>{
    const finish=(error)=>{clearTimeout(timer);ipcMain.removeListener("sync:renderer-flushed",reply);error?reject(error):resolve();};
    const reply=(event,result)=>{
      if(event.sender!==win.webContents || result?.nonce!==nonce)return;
      finish(result.ok?null:new Error(String(result.error??"Activity logs could not be saved before closing.")));
    };
    const timer=setTimeout(()=>finish(new Error("The application has not finished saving its activity logs. Keep it open and retry closing.")),30_000);
    ipcMain.on("sync:renderer-flushed",reply);
    win.webContents.send("sync:prepare-close",{nonce,forUpdate});
  });
}

function prepareApplicationClose(forUpdate = false) {
  if(closePreparation)return closePreparation;
  closePreparation=(async()=>{

    mainWindow?.setEnabled(false);
    reportCloseProgress({ active: true, message: 'Saving pending activity and finishing local writes…' });
    try {
      if (forUpdate && closeWriteBarrier.active.size) throw new Error("Please finish the current transaction before updating.");
      await flushRendererBeforeClose(forUpdate);
      // Even an unregistered window must pass the renderer safety check.
      if(!databaseService.snapshot().configured && !pendingShiftCloseSync.size)return {ok:true,skipped:true};
      const drained=await settleWithin(() => closeWriteBarrier.sealAndDrain(), SHUTDOWN_SYNC_TIMEOUT_MS);
      if(!drained.ok)throw new Error("Local writes are still finishing. Keep the application open and retry closing.");
      const result=await flushSyncBeforeShutdown();
      if(!result?.ok)throw new Error(result?.error??"Pending data has not been acknowledged by the cloud.");
      pendingShiftCloseSync.clear();
      return result;
    } catch(error) {
      closeWriteBarrier.reopen();
      return {ok:false,error:String(error?.message??error)};
    } finally { reportCloseProgress({ active: false }); if(mainWindow&&!mainWindow.isDestroyed())mainWindow.setEnabled(true); }
  })();
  closePreparation.then(result=>{if(!result.ok)closePreparation=null;},()=>{closePreparation=null;});
  return closePreparation;
}

app.on("second-instance", () => {
  const win = mainWindow ?? BrowserWindow.getAllWindows()[0];
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});


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

async function startAppServer(preferredPort = null) {
  if (!fs.existsSync(serverEntry)) {
    throw new Error(`Desktop build missing (${serverEntry}). Run: npm run desktop:build`);
  }
  // Older builds sealed a central service key on this machine. It is no longer
  // used or accepted, so it is erased the first time this build starts.
  serverKeys.purgeLegacyServiceKey();
  const cloud = cloudCredentials.read();
  const port = preferredPort && await portFree(preferredPort) ? preferredPort : await choosePort();
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
      const previousPort = baseUrl ? Number(new URL(baseUrl).port) : null;
      await stopAppServer();
      baseUrl = await startAppServer(previousPort);
      await Promise.all(windows.map((win, index) => load(win, routes[index])));
    } catch (error) {
      recordFault("app-server.cloud-config-restart", error);
      enterSafeMode("The local app server could not apply the saved cloud connection");
    }
  }, 1_000);
}

function stopAppServer() {
  const child = serverProcess;
  if (!child) return Promise.resolve();
  if (serverProcess === child) serverProcess = null;
  intentionallyStoppedServers.add(child);
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* the process may have just exited */ }
      reject(new Error("The previous local app server did not stop in time."));
    }, 10_000);
    child.once("exit", () => { clearTimeout(timeout); resolve(); });
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    try {
      child.kill();
    } catch (error) {
      clearTimeout(timeout);
      reject(error);
    }
  });
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

  // Keep the renderer alive to flush logs, freeze writes and await cloud ACKs.
  mainWindow.on("close", (event) => {
    if (allowMainWindowClose || shutdownFlushComplete) return;
    event.preventDefault();
    const closingWindow = mainWindow;
    if (updater.status().status === "ready") {
      void installUpdateAfterSync(false).then(result => { if (!result.ok) return showMandatorySyncFailure(result); });
      return;
    }
    void prepareApplicationClose().then(async (result) => {
      if (!result.ok) {
        await showMandatorySyncFailure(result);
        closingWindow?.show();
        closingWindow?.focus();
        return;
      }
      allowMainWindowClose = true;
      closingWindow?.close();
    }).catch(async (error) => {
      await showMandatorySyncFailure({ error: String(error?.message ?? error) });
    });
  });

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
  if (state !== "ACTIVE") {
    pendingShiftCloseSync.add(shiftId);
    return { ok: true, state, replayed: true };
  }
  const identity = adminSession.identity();
  const actor = identity?.subject ?? String(shift.opened_by_name ?? "");
  const terminalId = String(raw.terminalId ?? shift.terminal_id ?? "").trim() || null;
  const differentOperator = Boolean(shift.opened_by_staff_id && actor && String(shift.opened_by_staff_id) !== actor);
  const differentTerminal = Boolean(shift.terminal_id && String(shift.terminal_id) !== terminalId);
  const forced = differentOperator || differentTerminal;
  const policyRows = await operationsRepository.query(branchId, "pos_settings", {match:{id:1},limit:1});
  const rawPolicy = policyRows.rows?.[0]?.integration_settings;
  const policy = typeof rawPolicy === "string" ? JSON.parse(rawPolicy) : rawPolicy;
  const { mayCloseShift } = require("./db/shift-close-policy.cjs");
  if (!mayCloseShift({differentOperator,differentTerminal,isAdmin:adminSession.hasLevel("admin"),canManageOthers:adminSession.hasPermission("can_manage_other_shifts"),canClose:adminSession.hasPermission("can_close_shift"),allowHandover:policy?.allowAnyStaffCloseShift === true}))
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
  ], { branchId, terminalId });
  publishBusinessChange({ kind: "shift", branchId, operationId: shiftId });
  pendingShiftCloseSync.add(shiftId);
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
  if (!["CLOSING_STARTED", "CASH_COUNT_REQUIRED"].includes(state)) {
    pendingShiftCloseSync.add(shiftId);
    return { ok: true, state };
  }
  const prior = await operationsRepository.query(branchId, "shift_cash_counts", { match: { shift_id: shiftId, kind: "ORIGINAL" }, limit: 1 });
  if (prior.rows?.length) {
    const current = await operationsRepository.query(branchId, "shifts", { match: { id: shiftId }, limit: 1 });
    pendingShiftCloseSync.add(shiftId);
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
  const { shiftSummaryRow } = require("./db/shift-summary.cjs");
  operations.push({ kind: "insert", table: "shift_notifications", rows: [shiftSummaryRow({
    id: randomUUID(), shift, totals: expected, branchId, branchName, terminalName,
    actor, closedAt: shift.closed_at ?? now, countedCash,
  })] });
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
    await operationsRepository.apply("Closing shift cash count", operations, { branchId, terminalId });
  } catch (error) {
    if (![2601, 2627].includes(Number(error?.number ?? error?.originalError?.info?.number))) throw error;
    const current = await operationsRepository.query(branchId, "shifts", { match: { id: shiftId }, limit: 1 });
    pendingShiftCloseSync.add(shiftId);
    return { ok: true, state: String(current.rows?.[0]?.state ?? "CLOSED"), replayed: true };
  }
  publishBusinessChange({ kind: "shift", branchId, operationId: shiftId });
  pendingShiftCloseSync.add(shiftId);
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
    ], { branchId, terminalId });
  } catch (error) {
    if (![2601, 2627].includes(Number(error?.number ?? error?.originalError?.info?.number))) throw error;
    pendingShiftCloseSync.add(shiftId);
    return { ok: true, state: "CLOSED", replayed: true };
  }
  publishBusinessChange({ kind: "shift", branchId, operationId: shiftId });
  pendingShiftCloseSync.add(shiftId);
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
  if (state === "CLOSED") {
    pendingShiftCloseSync.add(shiftId);
    return { ok: true, state: "CLOSED", replayed: true };
  }
  if (!["VARIANCE_REVIEW_REQUIRED", "RECONCILIATION"].includes(state))
    throw new Error("This shift is not waiting for variance approval.");
  const identity = adminSession.identity();
  const actor = identity?.subject ?? "";
  const terminal = terminalStore.read() ?? {};
  const terminalId = String(shift.terminal_id ?? terminal.tokenId ?? terminal.terminalId ?? "").trim() || null;
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
  ], { branchId, terminalId });
  publishBusinessChange({ kind: "shift", branchId, operationId: shiftId });
  pendingShiftCloseSync.add(shiftId);
  scheduleAutomaticSync(250);
  return { ok: true, state: "CLOSED" };
}

function redactShiftRow(row) {
  const copy = { ...row };
  if (!(adminSession.hasLevel("admin") || adminSession.hasPermission("can_shift_expected_cash_view")))
    for (const key of ["expected_cash", "expected_card", "expected_digital"]) delete copy[key];
  if (!(adminSession.hasLevel("admin") || adminSession.hasPermission("can_shift_counted_cash_view")))
    for (const key of ["counted_cash", "counted_card", "counted_digital", "final_counted_cash", "closing_float"]) delete copy[key];
  if (!(adminSession.hasLevel("admin") || adminSession.hasPermission("can_shift_variance_view")))
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
  const expected = adminSession.hasLevel("admin") || adminSession.hasPermission("can_shift_expected_cash_view");
  const counted = adminSession.hasLevel("admin") || adminSession.hasPermission("can_shift_counted_cash_view");
  const variance = adminSession.hasLevel("admin") || adminSession.hasPermission("can_shift_variance_view");
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
    writeBarrier: closeWriteBarrier,
  });
  ipcMain.handle("admin:status", () => adminSession.status());
  ipcMain.handle("admin:lock", () => { adminSession.clear(); syncCloud.clearAuthorizationProof(); return adminSession.status(); });
  ipcMain.handle("admin:recovery-unlock", async (_event, username, pin) => guard.guarded(async () => {
    const user = guard.text(username, { name: "username", max: 160 });
    const secret = guard.text(pin, { name: "password or PIN", max: 128 });

    // A real email address uses the operator's ordinary Supabase password.
    // Authentication happens in the main process with the project pair sealed
    // in DPAPI; neither the publishable key nor the returned bearer is exposed
    // to the recovery renderer. The hosted POS backend then re-reads the staff
    // row before granting database-management authority.
    if (user.includes("@")) {
      const cloud = cloudCredentials.read();
      if (!cloud)
        return { ok: false, error: "Cloud authentication is not configured on this terminal. Use a synchronized username and approval PIN instead." };
      const authController = new AbortController();
      const authTimer = setTimeout(() => authController.abort(), 8_000);
      let authResponse;
      try {
        authResponse = await fetch(`${cloud.url}/auth/v1/token?grant_type=password`, {
          method: "POST",
          headers: { apikey: cloud.key, "content-type": "application/json" },
          body: JSON.stringify({ email: user, password: secret }),
          signal: authController.signal,
        });
      } catch {
        return { ok: false, error: "Cloud authentication could not be reached. Use a synchronized username and approval PIN while offline." };
      } finally {
        clearTimeout(authTimer);
      }
      const auth = await authResponse.json().catch(() => ({}));
      if (!authResponse.ok || !auth.access_token)
        return { ok: false, error: "That administrator email or password was not accepted." };
      const authorizationUrl = authorizationServerUrl();
      if (!authorizationUrl)
        return { ok: false, error: "The hosted POS backend address is not configured." };
      const authorityController = new AbortController();
      const authorityTimer = setTimeout(() => authorityController.abort(), 8_000);
      let authorityResponse;
      try {
        authorityResponse = await fetch(`${authorizationUrl}/api/v1/pos/ipc-adopt`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ accessToken: auth.access_token }),
          signal: authorityController.signal,
        });
      } catch {
        return { ok: false, error: "The POS backend could not verify this administrator. Try again when the connection is available." };
      } finally {
        clearTimeout(authorityTimer);
      }
      const authority = await authorityResponse.json().catch(() => ({}));
      if (!authorityResponse.ok || !authority.ok)
        return { ok: false, error: authority.error ?? "This administrator could not be verified." };
      if (authority.level !== "admin" && authority.permissions?.can_manage_sync_backup !== true)
        return { ok: false, error: "Database-management permission is required." };
      adminSession.grantRecovery();
      return { ok: true };
    }

    const local = await verifySyncedApprovalPin(databaseManager.pool, user, secret, localBranchId())
      .catch(() => ({ ok: false, reason: "unavailable" }));
    if (local.ok) {
      const role = String(local.staff?.role_slug ?? "staff").toLowerCase();
      const permissions = local.staff?.permissions ?? {};
      if (role === "admin" || permissions.can_manage_sync_backup === true) {
        adminSession.grantRecovery();
        return { ok: true };
      }
      return { ok: false, error: "Database-management permission is required." };
    }
    // A freshly installed or repaired local database may not have pulled the
    // administrator yet, so "missing" may use the authoritative hosted check.
    // Never use that fallback to bypass a local lock, bad PIN or deactivation.
    if (!["unavailable", "missing"].includes(local.reason)) {
      const messages = {
        locked: "This administrator PIN is temporarily locked after repeated failed attempts.",
        inactive: "This administrator account is inactive.",
        invalid: "The administrator username or approval PIN is incorrect.",
      };
      return { ok: false, error: local.error ?? messages[local.reason] ?? "The administrator could not be verified." };
    }

    // If SQL Server itself is what needs repair, verify the same credential
    // through the configured hosted backend. Its response is authoritative;
    // no role or permission supplied by the renderer is ever trusted.
    const authorizationUrl = authorizationServerUrl();
    if (!authorizationUrl)
      return { ok: false, error: "The local database is unavailable and no POS backend is configured." };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    let response;
    try {
      response = await fetch(`${authorizationUrl}/api/v1/pos/ipc-authorize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: user, pin: secret, terminalId: terminalStore.read()?.tokenId ?? null }),
        signal: controller.signal,
      });
    } catch {
      return { ok: false, error: "The approval service could not be reached. Check the connection or use a PIN already synchronized to this terminal." };
    } finally {
      clearTimeout(timer);
    }
    const result = await response.json().catch(() => ({ ok: false, error: "Authorization failed." }));
    if (!response.ok || !result.ok)
      return { ok: false, error: result.error ?? "That username or PIN was not accepted." };
    if (result.level !== "admin" && result.permissions?.can_manage_sync_backup !== true)
      return { ok: false, error: "Database-management permission is required." };
    adminSession.grantRecovery();
    return { ok: true };
  }));
  ipcMain.handle("admin:recovery-lock", () => {
    adminSession.clearRecovery();
    return { ok: true };
  });
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
  ipcMain.handle("database:retry-startup", () => recoverLocalDatabase({prepare:true}));
  ipcMain.handle("database:authorize-settings", () => ({ ok: true }));
  ipcMain.handle("database:set-enabled", (_e, value) => guard.guarded(async()=>{await databaseService.setEnabled(value===true);if(value===true&&databaseManager.isConnected())void prepareLocalData().catch(error=>recordFault("local-data.prepare",error));return databaseService.snapshot();}));
  ipcMain.handle("database:list-servers", () => discoverLocalSqlServers());
  ipcMain.handle("database:test-server", (_e, value) => guard.guarded(() => observedDatabaseOperation("connection","test",() => databaseService.testServer(guard.databaseProfile(value)))));
  ipcMain.handle("database:list-databases", (_e, value) => guard.guarded(() => observedDatabaseOperation("connection","list_databases",() => databaseService.databases(guard.databaseProfile(value)))));
  ipcMain.handle("database:validate", (_e, value) => guard.guarded(() => observedDatabaseOperation("validation","schema",() => databaseService.validate(guard.databaseProfile(value, { requireDatabase: true })))));
  ipcMain.handle("database:migrate", (_e, value) => guard.guarded(async () => {
    const profile=guard.databaseProfile(value,{requireDatabase:true});
    const ensured=await observedDatabaseOperation("migration","database",() => ensureDatabase(databaseManager,profile));
    if(!ensured.ok)return{...ensured,stage:"database"};
    const migrated=await observedDatabaseOperation("migration","apply",() => applyMigrations(databaseManager,profile));
    if(!migrated.ok)return{...migrated,stage:"migration",created:ensured.created,hint:migrated.code==="ETIMEOUT"?"The initial POS schema did not finish within the five-minute setup limit. SQL Server remains unchanged outside the current migration batch.":migrated.hint};
    const validation=await observedDatabaseOperation("migration","revalidate",() => databaseService.validate(profile));
    if(!validation.ok)return{...validation,stage:"validation",created:ensured.created,applied:migrated.applied};
    return validation.ready?{...validation,...migrated,ok:true,ready:true,created:ensured.created}:{...validation,ok:false,code:"EMIGRATION_INCOMPLETE",error:"The migration ran, but schema validation still found differences.",stage:"validation",created:ensured.created,applied:migrated.applied};
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
  ipcMain.handle("database:provision-connect", (_e, value) => guard.guarded(async()=>{
    const profile=guard.databaseProfile(value,{requireDatabase:true});
    const wasPaused=syncCoordinator.paused;
    let resumed=false;
    if(!wasPaused)syncCoordinator.pause();
    try{
      if(syncCoordinator.activeRun)await syncCoordinator.activeRun;
      const ensured=await observedDatabaseOperation("provision","database",()=>ensureDatabase(databaseManager,profile));
      if(!ensured.ok)return{...ensured,stage:"database"};
      const migrated=await observedDatabaseOperation("provision","migration",()=>applyMigrations(databaseManager,profile));
      if(!migrated.ok)return{...migrated,stage:"migration",created:ensured.created,hint:migrated.code==="ETIMEOUT"?"The initial POS schema did not finish within the five-minute setup limit. SQL Server remains unchanged outside the current migration batch.":migrated.hint};
      const validation=await observedDatabaseOperation("provision","validation",()=>databaseService.validate(profile));
      if(!validation.ok)return{...validation,stage:"validation",created:ensured.created,applied:migrated.applied};
      if(!validation.ready)return{ok:false,code:"EMIGRATION_INCOMPLETE",error:"The database was prepared, but schema validation still found differences.",created:ensured.created,applied:migrated.applied,validation};
      const connected=await observedDatabaseOperation("provision","connect",()=>databaseService.saveAndConnect(profile));
      if(!connected.ok)return{...connected,stage:"connection",created:ensured.created,applied:migrated.applied,validation};
      // Schema work is complete. Let the existing bootstrap coordinator run;
      // it performs the initial push/pull itself and refuses to run paused.
      if(!wasPaused){syncCoordinator.resume();resumed=true;}
      let synchronization;
      try{synchronization=await prepareLocalData();}
      catch(error){synchronization={ok:false,pending:true,code:error?.code??"ESYNC",message:String(error?.message??error)};}
      return{...connected,ok:true,created:ensured.created,applied:migrated.applied,schemaRepair:migrated.schemaRepair,validation,synchronization,state:databaseService.snapshot()};
    }finally{
      if(!wasPaused&&!resumed)syncCoordinator.resume();
      if(!wasPaused)scheduleAutomaticSync(250);
    }
  }));
  ipcMain.handle("database:export-migrations", async()=>{
    const chosen=await dialog.showSaveDialog({
      title:"Save latest local SQL Server update",
      defaultPath:path.join(app.getPath("downloads"),`Retail POS Local Database Update ${app.getVersion()}.sql`),
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
    // SQL Server is already validated, connected and saved. Bootstrap can
    // include every branch table and must not hold the setup dialog open or
    // make a healthy port-1433 connection look like a connection timeout.
    // prepareLocalData owns readiness/error publication and deduplicates with
    // startup or automatic recovery, so it is safe to continue in background.
    void prepareLocalData().catch(()=>undefined);
    return{...result,ok:true,synchronization:{ok:true,pending:true},state:databaseService.snapshot()};
  }));
  ipcMain.handle("database:disconnect", () => databaseService.disconnect());
  ipcMain.handle("database:remove-configuration", () => databaseService.remove());
  ipcMain.handle("database:health", () => databaseService.health());
  ipcMain.handle("database:schema-status", () => databaseService.schemaStatus());
  ipcMain.handle("database:backup", (_e, file) => guard.guarded(() => backupService.backup(guard.filePath(file,{name:"backup file",extension:"bak"}))));
  ipcMain.handle("database:restore", (_e, file) => guard.guarded(async () => { const result=await backupService.restore(guard.filePath(file,{name:"backup file",extension:"bak"})); if(result.ok)await databaseService.restore(); return result; }));
  ipcMain.handle("business:write-batch", (_e, context, ops) => guard.guarded(async() => { const terminal=terminalStore.read()??{};const branchId=localBranchId();const identity=adminSession.identity();if(identity?.source==="pos")adminSession.touch();const operations=stampVerifiedBranchOperations(guard.writeOps(ops,{max:200}),branchId);const result=await operationsRepository.apply(guard.text(context,{name:"operation context",max:160}),operations,{branchId,terminalId:terminal.tokenId??terminal.terminalId,permissions:identity?.permissions??{},...aggregatePolicy("general",operations,identity)});publishBusinessChange({kind:"general",branchId,tables:[...new Set(operations.map(operation=>operation.table))],changes:operations.flatMap(op=>(op.rows??[op.match??{}]).map(row=>({table:op.table,entityId:op.table==="product_barcodes"?row.product_id:row.id??null})))});scheduleLocalChanges(operations);return result;}));
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
      adminSession.touch();
      const trustedAggregate={
        ...aggregate,
        operations,
        branchId,
        terminalId:terminal.tokenId??terminal.terminalId??null,
        permissions:adminSession.identity()?.permissions??{},
        ...aggregatePolicy(aggregate.kind,operations,adminSession.identity()),
        // Automatic sale/payment accrual is governed by the aggregate itself.
        // Direct member administration uses the generic aggregate and must
        // enforce the same add/points permissions as the central relay.
        enforcePermissions:true,
      };
      const result=await aggregateRepository.commit(aggregate.kind,trustedAggregate);
      publishBusinessChange({kind:aggregate.kind,branchId,operationId:result.operationId??null,tables:[...new Set(operations.map(op=>op.table))],changes:operations.flatMap(op=>(op.rows??[op.match??{}]).map(row=>({table:op.table,entityId:op.table==="product_barcodes"?row.product_id:row.id??null})))});
      scheduleLocalChanges(operations);
      return result;
    } catch(error) {
      recordFault("business.commit-aggregate", error);
      return {ok:false,code:error?.code??"ESQLSERVER_WRITE",error:error?.message??"The local SQL Server transaction failed.",stage:error?.stage??null,table:error?.table??null,sqlNumber:error?.sqlNumber??null};
    }
  }));
  ipcMain.handle("business:snapshot", (_e, options) => guard.guarded(async () => {
    if(!databaseManager.isConnected())return{ok:false,code:"EDATABASE_NOT_READY",error:"SQL Server setup or connection is not complete yet."};
    const snapshot = await operationsRepository.snapshot(localBranchId(), terminalStore.read()?.tokenId ?? null, { salesOnly: options?.salesOnly === true, onProgress: (progress) => { if (!_e.sender.isDestroyed()) _e.sender.send("business:read-progress", progress); } });
    return { ...snapshot, shifts: (snapshot.shifts ?? []).map(redactShiftRow) };
  }));
  ipcMain.handle("business:analytics", (_e, from, to) => guard.guarded(async () => {
    if (!adminSession.hasPosAuthority() || !adminSession.hasPermission("can_view_sales_reports"))
      return { ok: false, code: "PERMISSION_DENIED", error: "Sales report permission is required." };
    return readAnalytics(databaseManager, localBranchId(), guard.text(from, { name: "from date", max: 10 }), guard.text(to, { name: "to date", max: 10 }));
  }));
  ipcMain.handle("business:query", (_e, table, options) => guard.guarded(async () => {
    try {
      const safeTable = guard.text(table, { name: "business table", max: 80 });
      if(!databaseManager.isConnected())return{ok:false,code:"EDATABASE_NOT_READY",rows:[],error:"SQL Server setup or connection is not complete yet."};
      const terminal = terminalStore.read() ?? {};
      const result = await operationsRepository.query(
        localBranchId(), safeTable, guard.queryOptions(options),
        terminal.tokenId ?? terminal.terminalId ?? null,
      );
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
  ipcMain.handle("receipts:refund", (_e, value) => guard.guarded(async () => { if(!adminSession.hasPosAuthority()||!adminSession.hasPermission("can_process_refund"))return{ok:false,code:"PERMISSION_DENIED",error:"Refund permission is required."};const input=guard.options(value,{name:"refund",max:5}); const terminal=terminalStore.read()??{}; const branch=localBranchId();if(input.branchId&&String(input.branchId)!==String(branch))return{ok:false,code:"SYNC_BRANCH_FORBIDDEN",error:"The refund must belong to this terminal branch."};const result=await receiptRepository.refund({saleId:guard.uuid(input.saleId,{name:"sale id"}),refundId:guard.text(input.refundId,{name:"refund id",max:128}),branchId:guard.text(branch,{name:"branch",max:128}),reason:input.reason?guard.text(input.reason,{name:"reason",max:400}):null});publishBusinessChange({kind:"refund",branchId:branch});scheduleAutomaticSync(250);return result; }));
  ipcMain.handle("jobs:get-active", async () => databaseManager.isConnected() ? jobRepository.active() : null);
  ipcMain.handle("jobs:get-history", async (_e, limit) => databaseManager.isConnected() ? jobRepository.history(Number(limit)||50) : []);
  ipcMain.handle("sync:get-status", () => syncCoordinator.refresh(localBranchId()));
  ipcMain.handle("sync:run-now", (_e, options) => guard.guarded(async()=>{const input=guard.options(options,{name:"sync options"});const branchId=localBranchId();if(!branchId)throw Object.assign(new Error("The terminal branch is not configured."),{code:"EBRANCH"});const result=await observedDatabaseOperation("synchronization","manual",() => syncCoordinator.runNow({...input,branchId}));return result.code==="ECHANGEGAP"?prepareLocalData({force:true}):result;}));
  ipcMain.handle("sync:finalize-shift-close", (_e, shiftId) => guard.guarded(() =>
    synchronizeClosingShifts(guard.uuid(shiftId, { name: "shift id" })),
  ));
  ipcMain.handle("sync:auto", async () => {
    if(!databaseManager.isConnected()||!localBranchId())return{ok:false,skipped:true};
    return syncCoordinator.runNow({branchId:localBranchId(),batchSize:500,includeActivity:false});
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
    try { return await verifySyncedStaffPin(databaseManager.pool, username, pin, localBranchId()); }
    catch (error) { return {ok:false,reason:"unavailable",error:String(error?.message??error)}; }
  });
  ipcMain.handle("staff:sign-in", async (_e, username, pin) => {
    try {
      const result = await verifySyncedStaffPin(databaseManager.pool, username, pin, localBranchId());
      if (result.ok && result.staff) {
        const staff = result.staff;
        const role = staff.role_slug;
        const level = role === "admin" ? "admin" : ["manager", "supervisor"].includes(role) ? "supervisor" : "staff";
        adminSession.grant(level, staff.username, staff.permissions ?? {}, "pos", staff.store_id ?? localBranchId());
      }
      return result;
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
  let recoveryOperation = null;
  const safelyRecover = (event, action) => {
    if (!safeMode || !recovery.isOwn(BrowserWindow.fromWebContents(event.sender)) || event.senderFrame !== event.sender.mainFrame)
      return { ok: false, error: "Open the recovery window before using this maintenance action." };
    if (recoveryOperation) return recoveryOperation;
    recoveryOperation = (async () => {
      if (closeWriteBarrier.active.size || jobManager.running || localDataPreparePromise)
        return { ok: false, error: "Please finish the current transaction before updating." };
      const prepared = await prepareApplicationClose(true);
      if (!prepared.ok) return prepared;
      shutdownFlushComplete = true;
      allowMainWindowClose = true;
      const result = await action();
      if (!result?.ok) {
        shutdownFlushComplete = false; allowMainWindowClose = false;
        closePreparation = null; closeWriteBarrier.reopen();
      }
      return result;
    })().catch(error => {
      shutdownFlushComplete = false; allowMainWindowClose = false;
      closePreparation = null; closeWriteBarrier.reopen();
      return { ok: false, error: String(error?.message ?? error) };
    }).finally(() => { recoveryOperation = null; });
    return recoveryOperation;
  };
  ipcMain.handle("health:rollback", (event) => safelyRecover(event, async () => {
    const { lastGoodVersion } = health.read();
    updater.pause();
    return updater.rollback(lastGoodVersion, (percent) => recovery.progress({ percent }));
  }));
  ipcMain.handle("health:resume-updates", () => { health.reset(); return updater.resume(true); });
  ipcMain.handle("health:retry", (event) => safelyRecover(event, async () => { health.reset(); app.relaunch(); app.quit(); return { ok: true }; }));
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
  ipcMain.handle("cache:status", () => ({ ok: true, ...storageHygiene.usage(app.getPath("userData")) }));
  ipcMain.handle("cache:clear", async () => {
    await session.defaultSession.clearCache();
    await session.defaultSession.clearStorageData({ storages: ["serviceworkers", "cachestorage", "shadercache"] });
    session.defaultSession.flushStorageData();
    const removedEntries = storageHygiene.pruneCaches(app.getPath("userData"));
    const removedInstallers = updater.cleanupFallbackInstallers(updater.status().installerFile);
    return { ok: true, removedEntries, removedInstallers, ...storageHygiene.usage(app.getPath("userData")) };
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
    }], { branchId, terminalId });
    const result = await printRaw([0x1b, 0x70, Number(input.pin) === 5 ? 1 : 0, 0x19, 0xfa], {
      deviceName: guard.shellSafeText(printer.deviceName, { name: "printer name" }),
      share: guard.shellSafeText(printer.share, { name: "printer share" }),
    });
    await operationsRepository.apply("Recording cash drawer result", [{
      kind: "update", table: "drawer_events", match: { id: eventId },
      values: { note: result.ok ? "OPENED" : `FAILED: ${String(result.error ?? "Printer refused the drawer pulse").slice(0, 300)}` },
    }], { branchId, terminalId });
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

  updater.onInstallFailure(() => {
    shutdownFlushStarted = false;
    quitting = false;
    shutdownFlushComplete = false;
    allowMainWindowClose = false;
    closePreparation = null;
    closeWriteBarrier.reopen();
    mainWindow?.setEnabled(true);
  });
  ipcMain.handle("update:status", () => updater.status());
  ipcMain.handle("update:history", () => updater.history());
  ipcMain.handle("update:check", () => updater.check());
  ipcMain.handle("update:download", () => updater.downloadUpdate());
  installUpdateAfterSync = require("./update-install.cjs").createUpdateInstall({
    updater,
    isBusy: () => closeWriteBarrier.active.size > 0 || Boolean(jobManager.running || localDataPreparePromise) || ["enabled_connecting", "enabled_validating", "enabled_bootstrapping"].includes(databaseService.snapshot().state),
    prepare: prepareApplicationClose,
    allowQuit: () => {
      // Sync has completed. Do not intercept electron-updater's quit and
      // replace its installation handoff with the ordinary app.exit path.
      shutdownFlushComplete = true;
      allowMainWindowClose = true;
    },
    recover: () => {
      shutdownFlushComplete = false;
      allowMainWindowClose = false;
      closePreparation = null;
      closeWriteBarrier.reopen();
    },
  });
  const updateFromWindow = (event, download) => event.sender === mainWindow?.webContents && event.senderFrame === event.sender.mainFrame
    ? installUpdateAfterSync(download)
    : {ok:false,error:"Only the POS window can request an update restart."};
  ipcMain.handle("update:download-install", (event) => updateFromWindow(event, true));
  ipcMain.handle("update:install", (event) => updateFromWindow(event, false));
  ipcMain.handle("update:diagnose", () => updater.diagnose());
  ipcMain.handle("update:download-page", () => updater.downloadPage());
  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("net:get-json", (_e, url) => netHttp.getJson(String(url)));
  ipcMain.handle("cloud:request", (_e, request) => require("./supabase-http.cjs").supabaseRequest(request, cloudCredentials.read()));
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
  ipcMain.handle("business:reserve-bill", (_e, prefix, minimum) =>
    require("./bill-counter.cjs").reserveBillCounter(configStore, prefix, minimum));
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
  try { storageHygiene.runOnLaunch(app.getPath("userData"), app.getVersion()); } catch (error) { if (DEBUG) console.warn("[pos] storage hygiene skipped:", fail(error).error); }
  registerIpc();
  mainTelemetry.start();
  const boot = health.beginBoot();
  if (health.shouldEnterSafeMode(boot)) { safeMode = true; health.beginRecovery(boot.reason ?? "Repeated failed launches"); updater.pause(); recovery.open(); return; }
  updater.start();
  const splash = new BrowserWindow({ width: 360, height: 240, frame: false, resizable: false, show: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  void splash.loadFile(path.join(__dirname, "splash.html"));
  try { if (!baseUrl) baseUrl = await startAppServer(); }
  catch (err) { splash.destroy(); enterSafeMode(err instanceof Error ? err.message : String(err)); return; }

  // Always put a window on screen before touching SQL Server. Validation and
  // an additive schema repair can legitimately take minutes after an update;
  // awaiting them first left a healthy Electron process looking invisible and
  // gave the operator no window to close. A configured till starts on the
  // recovery-safe route and moves to the register when the state subscription
  // reports tradingReady.
  const initialDatabase = databaseService.snapshot();
  const initialRoute = initialDatabase.enabled && initialDatabase.configured
    ? "/database-startup"
    : "/";
  readyWatchdog = setTimeout(() => enterSafeMode("Startup timed out"), 60_000);
  createWindows(initialRoute);
  mainWindow.webContents.once("did-finish-load", () => { if (!splash.isDestroyed()) splash.destroy(); });
  mainWindow.once("closed", () => { if (!splash.isDestroyed()) splash.destroy(); });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length !== 0) return;
    const database = databaseService.snapshot();
    createWindows(database.enabled && database.configured && !database.tradingReady ? "/database-startup" : "/");
  });

  let restoredDatabase;
  try {
    restoredDatabase = await databaseService.restore();
  } catch (error) {
    recordFault("database.startup-restore", error);
    if (!quitting) enterSafeMode("The local database startup check failed unexpectedly");
    return;
  }
  if (quitting || safeMode) return;
  await restoreShiftCloseGuard().catch((error) => recordFault("shift-close.guard-restore", error));
  if (restoredDatabase.state === "enabled_bootstrapping")
    void prepareLocalData().catch((error) => recordFault("local-data.prepare", error));
  scheduleAutomaticSync(5_000);
});

let shutdownFlushStarted = false;
let shutdownFlushComplete = false;
app.on("before-quit", (event) => {
  if (shutdownFlushComplete) return;
  event.preventDefault();
  if (shutdownFlushStarted) return;
  if (updater.status().status === "ready" && installUpdateAfterSync) {
    shutdownFlushStarted = true;
    void installUpdateAfterSync(false).then(async result => {
      if (!result.ok) { shutdownFlushStarted = false; await showMandatorySyncFailure(result); }
    });
    return;
  }
  shutdownFlushStarted = true;
  quitting = true;
  stopAutomaticSync();
  void (async () => {
    let result;
    try {
      result = await prepareApplicationClose();
    } catch (error) {
      result = { ok: false, error: String(error?.message ?? error) };
    }
    if (result?.ok === false) {
      recordFault("shutdown.shift-sync", new Error(result.error ?? "Mandatory shift synchronization failed."));
      quitting = false;
      shutdownFlushStarted = false;
      scheduleAutomaticSync(250);
      await showMandatorySyncFailure(result);
      mainWindow?.show();
      mainWindow?.focus();
      return;
    }
    mainTelemetry.stop();
    updater.stop();
    closeCustomerDisplay();
    const serverStop = await settleWithin(() => stopAppServer());
    if (serverStop.timedOut) recordFault("shutdown.app-server-timeout", new Error("The local app server did not stop before the shutdown deadline."));
    else if (!serverStop.ok) recordFault("shutdown.app-server", serverStop.error);
    const databaseClose = await settleWithin(() => databaseManager.close());
    if (databaseClose.timedOut) recordFault("shutdown.database-close-timeout", new Error("SQL Server did not close before the shutdown deadline."));
    else if (!databaseClose.ok) recordFault("shutdown.database-close", databaseClose.error);
    shutdownFlushComplete = true;
    // Cleanup above is bounded and every pending write is durable. app.exit is
    // intentional here: native ODBC work that began during startup must not
    // leave a headless Electron process after the operator chose Exit.
    app.exit(0);
  })();
});
app.on("window-all-closed", () => {
  if (recovery.isOpen()) return;
  markStartupSettled();
  if (process.platform !== "darwin") app.quit();
});
