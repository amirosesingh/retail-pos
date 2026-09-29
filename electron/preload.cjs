const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld("sqlAdmin", {
  unlock: (username, pin) => invoke("admin:unlock", username, pin),
  lockAdmin: () => invoke("admin:lock"),
  adoptSession: (proof, terminalConfig) => invoke("admin:adopt-session", proof, terminalConfig),
  status: () => invoke("admin:status"),
});

/**
 * Electron business bridge. Operational reads and writes use local SQL
 * Server; Supabase synchronization stays in the main process background.
 */
contextBridge.exposeInMainWorld("pos", {
  write: (context, op) => invoke("business:write-batch", context, [op]),
  writeBatch: (context, ops) => invoke("business:write-batch", context, ops),
  commitAggregate: (aggregate) => invoke("business:commit-aggregate", aggregate),
  snapshot: () => invoke("business:snapshot"),
  query: (table, options) => invoke("business:query", table, options),
  shiftExpectedTotals: (shiftId) => invoke("business:shift-expected", shiftId),
  shiftCloseStart: (value) => invoke("business:shift-close-start", value),
  shiftCloseCount: (value) => invoke("business:shift-close-count", value),
  shiftRecount: (value) => invoke("business:shift-recount", value),
  shiftVarianceApprove: (value) => invoke("business:shift-variance-approve", value),
  shiftReconciliationView: (shiftId) => invoke("business:shift-reconciliation-view", shiftId),
  onBusinessChanged: (cb) => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on("business:changed", handler);
    return () => ipcRenderer.removeListener("business:changed", handler);
  },
  findReceipt: (value, branchId, proof) => invoke("receipts:find-exact", value, branchId, proof),
  refundReceipt: (value) => invoke("receipts:refund", value),
  database: {
    getState: () => invoke("database:get-state"),
    retryStartup: () => invoke("database:retry-startup"),
    authorizeSettings: () => invoke("database:authorize-settings"),
    setEnabled: (enabled) => invoke("database:set-enabled", enabled),
    listServers: () => invoke("database:list-servers"),
    testServer: (profile) => invoke("database:test-server", profile),
    listDatabases: (profile) => invoke("database:list-databases", profile),
    validateDatabase: (profile) => invoke("database:validate", profile),
    migrateDatabase: (profile) => invoke("database:migrate", profile),
    migrateSavedDatabase: () => invoke("database:migrate-saved"),
    exportMigrationSql: () => invoke("database:export-migrations"),
    saveAndConnect: (profile) => invoke("database:save-connect", profile),
    disconnect: () => invoke("database:disconnect"),
    removeConfiguration: () => invoke("database:remove-configuration"),
    health: () => invoke("database:health"),
    schemaStatus: () => invoke("database:schema-status"),
    backup: (file) => invoke("database:backup", file),
    restore: (file) => invoke("database:restore", file),
    subscribe: (cb) => {
      const handler = (_event, payload) => cb(payload);
      ipcRenderer.on("database:state", handler);
      return () => ipcRenderer.removeListener("database:state", handler);
    },
  },
  jobs: {
    getActive: () => invoke("jobs:get-active"),
    getHistory: (limit) => invoke("jobs:get-history", limit),
    subscribe: (cb) => { const handler=(_event,payload)=>cb(payload); ipcRenderer.on("jobs:state",handler); return()=>ipcRenderer.removeListener("jobs:state",handler); },
  },
  sync: {
    getStatus: () => invoke("sync:get-status"),
    runNow: (options) => invoke("sync:run-now", options),
    auto: () => invoke("sync:auto"),
    pause: () => invoke("sync:pause"),
    resume: () => invoke("sync:resume"),
    getFailures: () => invoke("sync:get-failures"),
    reconcile: (options) => invoke("sync:reconcile", options),
    subscribe: (cb) => { const handler=(_event,payload)=>cb(payload); ipcRenderer.on("sync:state",handler); return()=>ipcRenderer.removeListener("sync:state",handler); },
  },
  staffRoster: (storeId) => invoke("staff:roster", storeId),
  cacheStaffRoster: (rows) => invoke("staff:cache-roster", rows),
  rememberStaffPin: (username, pin) => invoke("staff:enroll", username, pin),
  verifyStaffPin: (username, pin) => invoke("staff:verify-pin", username, pin),
  cashierLogin: (username, pin) => invoke("auth:cashier-login", { username, pin }),
  telemetry: {
    presence: (value) => invoke("telemetry:presence", value),
  },
  print: (html, options) => invoke("print:silent", html, options),
  printRaw: (bytes, options) => invoke("print:raw", bytes, options),
  openDrawer: (value) => invoke("drawer:open", value),
  listPrinters: () => invoke("print:list"),
  appVersion: () => invoke("app:version"),
  netGetJson: (url) => invoke("net:get-json", url),
  netHead: (url) => invoke("net:head", url),
  netGetBinary: (url) => invoke("net:get-binary", url),
  updateStatus: () => invoke("update:status"),
  checkForUpdates: () => invoke("update:check"),
  installUpdate: () => invoke("update:install"),
  diagnoseUpdates: () => invoke("update:diagnose"),
  updateDownloadPage: () => invoke("update:download-page"),
  onUpdateStatus: (cb) => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on("update:status", handler);
    return () => ipcRenderer.removeListener("update:status", handler);
  },
  readTerminalConfig: () => invoke("terminal:read"),
  writeTerminalConfig: (config) => invoke("terminal:write", config),
  clearTerminalConfig: () => invoke("terminal:clear"),
  getSetting: (key) => invoke("settings:get", key),
  setSetting: (key, value) => invoke("settings:set", key, value),
  readConfig: () => invoke("config:read"),
  writeConfig: (patch) => invoke("config:write", patch),
  getConfig: (key) => invoke("config:get", key),
  setConfig: (key, value) => invoke("config:set", key, value),
  resetConfig: () => invoke("config:reset"),
  serverKeyStatus: () => invoke("server-keys:status"),
  backendUrl: () => invoke("backend:get"),
  setBackendUrl: (value) => invoke("backend:set", value),
  cloudKeyStatus: () => invoke("cloud:status"),
  bootstrapCloudCredentials: () => invoke("cloud:bootstrap"),
  setCloudCredentials: (value) => invoke("cloud:set", value),
  removeCloudCredentials: () => invoke("cloud:remove"),
  onCloudSetupRequired: (cb) => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on("cloud:setup-required", handler);
    return () => ipcRenderer.removeListener("cloud:setup-required", handler);
  },
  readBranding: () => invoke("branding:read"),
  writeBranding: (branding) => invoke("branding:write", branding),
  minimizeWindow: () => invoke("window:minimize"),
  toggleMaximizeWindow: () => invoke("window:maximize"),
  closeWindow: () => invoke("window:close"),
  isWindowMaximized: () => invoke("window:is-maximized"),
  onWindowState: (cb) => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on("window:state", handler);
    return () => ipcRenderer.removeListener("window:state", handler);
  },
  reportReady: () => invoke("app:ready"),
  healthState: () => invoke("health:state"),
  rollbackNow: () => invoke("health:rollback"),
  openLogFolder: () => invoke("health:open-logs"),
  collectDiagnostics: () => invoke("health:collect-diagnostics"),
  logConnection: (event, detail) => invoke("health:log-connection", event, detail),
  onFatal: (cb) => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on("app:fatal", handler);
    return () => ipcRenderer.removeListener("app:fatal", handler);
  },
});
