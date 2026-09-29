/**
 * Who may call which desktop channel.
 *
 * The window renders application code, so a hidden button is not a control:
 * anything running in the window can call the bridge directly. Every channel is
 * therefore classified here, and the desktop process refuses a call that the
 * caller has not earned — using the one administrator/supervisor unlock that
 * already exists on the till (`admin-session.cjs`), never a second role store.
 *
 * Three levels:
 *   open        the register needs it to trade; safe for any cashier
 *   supervisor  changes operational data or clears working state
 *   admin       changes the backend, the company, the database, the till's
 *               identity, its stored credentials or its audit trail
 *
 * A channel nobody has classified is treated as admin, so a new privileged
 * channel cannot become world-callable by being forgotten.
 */
const adminSession = require("./admin-session.cjs");

const OPEN = "open";
const SUPERVISOR = "supervisor";
const ADMIN = "admin";

// The account's central permission matrix owns local database and sync access.
// The desktop only enforces the server-verified grant; it does not keep a
// second database-admin role list.
const DATABASE_SYNC_CHANNELS = new Set([
  "pos:connect", "pos:configure-cloud", "pos:forget-connection", "pos:remove-connection",
  "pos:apply-schema", "pos:apply-schema-tables", "pos:restore", "pos:restore-verify",
  "pos:restore-drill", "pos:backup", "pos:set-sync-config", "pos:set-sync-enabled",
  "pos:retry-connection", "pos:reconnect", "pos:retry-errored", "pos:retry-row",
  "pos:discard-row", "database:set-enabled", "database:migrate", "database:migrate-saved", "database:save-connect",
  "database:disconnect", "database:remove-configuration", "database:backup",
  "database:restore", "sync:run-now", "sync:pause", "sync:resume",
  "sync:reconcile", "cloud:set", "cloud:remove", "backend:set",
  "driver:install", "sqladmin:connect", "sqladmin:cancel", "sqladmin:probe-port",
  "sqladmin:lock", "sqladmin:databases", "sqladmin:tables", "sqladmin:columns",
  "sqladmin:query", "sqladmin:repair", "sqladmin:disconnect",
]);
const DATABASE_SYNC_SETTING = /^(?:db[_.:-]|database|sql|sync|cloud|supabase|backend)/i;
function databaseSyncAction(channel, args = []) {
  return DATABASE_SYNC_CHANNELS.has(channel) ||
    ((channel === "settings:set" || channel === "config:set") &&
      DATABASE_SYNC_SETTING.test(String(args[0] ?? "")));
}

/** Explicit classification of every channel the bridge exposes. */
const CHANNEL_LEVELS = {
  /* --- unlock surface itself: must be reachable to be able to unlock --- */
  "admin:unlock": OPEN,
  "admin:lock": OPEN,
  "admin:status": OPEN,
  "admin:adopt-session": OPEN,

  /* --- trading: the register cannot sell without these --- */
  "pos:write": OPEN,
  "pos:write-batch": OPEN,
  // Legacy fallback only. Current renderers use commit-aggregate, which has
  // kind-specific permission checks below. An arbitrary batch must never be
  // available to ordinary renderer code.
  "business:write-batch": SUPERVISOR,
  "business:commit-aggregate": OPEN,
  "business:snapshot": OPEN,
  "business:query": OPEN,
  "business:save-authorization-rule": OPEN,
  "business:shift-expected": OPEN,
  "business:shift-close-start": OPEN,
  "business:shift-close-count": OPEN,
  "business:shift-recount": OPEN,
  "business:shift-variance-approve": OPEN,
  "business:shift-reconciliation-view": OPEN,
  "receipts:find-exact": OPEN,
  "receipts:refund": OPEN,
  "pos:status": OPEN,
  "pos:database-config": OPEN,
  "pos:connection-audit": OPEN,
  "pos:verify-write": OPEN,
  "pos:push": OPEN,
  "pos:pull": OPEN,
  "pos:sync-now": OPEN,
  "pos:set-sync-config": OPEN,
  "pos:snapshot": OPEN,
  "pos:sync-contract": OPEN,
  "pos:schema-status": OPEN,
  "pos:schema-inventory": OPEN,
  "pos:read-schema": OPEN,
  "pos:schema-table-sql": OPEN,
  "pos:compare-summary": OPEN,
  "pos:compare-rows": OPEN,
  "pos:restore-status": OPEN,
  "pos:restore-evidence": OPEN,
  "db:get-products": OPEN,
  "db:get-pending-sync-count": OPEN,
  "db:get-branch": OPEN,
  "print:silent": OPEN,
  "print:raw": OPEN,
  "drawer:open": OPEN, // permission-refined in allowed()
  "print:list": OPEN,
  "local:info": OPEN,
  "local:mirror": OPEN,
  "local:list": OPEN,
  "local:audit-log": OPEN,
  "local:audit-list": OPEN,
  "local:relational-health": OPEN,
  "staff:roster": OPEN,
  "staff:cache-roster": OPEN,
  "staff:verify-pin": OPEN,
  "staff:enroll": OPEN,
  // Pre-login bridge: the hosted endpoint still verifies the PIN and applies
  // its central brute-force throttle; Electron merely keeps expected 401s out
  // of the renderer network console.
  "auth:cashier-login": OPEN,
  "sync:auto": OPEN,
  "settings:get": OPEN,
  "config:read": OPEN,
  "config:get": OPEN,
  "terminal:read": OPEN,
  // A terminal whose registration was revoked or deleted erases its own saved
  // activation. That is the machine cleaning up after itself, so it must work
  // with a cashier signed in, or nobody at all.
  "terminal:clear": OPEN,
  "backend:get": OPEN,
  "cloud:status": OPEN,
  "cloud:bootstrap": OPEN,
  "server-keys:status": OPEN,
  "app:version": OPEN,
  "app:ready": OPEN,
  "health:state": OPEN,
  "health:retry": OPEN,
  "health:open-logs": OPEN,
  "health:collect-diagnostics": OPEN,
  "health:log-connection": OPEN,
  "update:status": OPEN,
  "update:check": OPEN,
  "update:diagnose": OPEN,
  "update:download-page": OPEN,

  "net:get-json": OPEN,
  "net:head": OPEN,
  "net:get-binary": OPEN,
  "window:minimize": OPEN,
  "window:maximize": OPEN,
  "window:close": OPEN,
  "window:is-maximized": OPEN,
  "branding:read": OPEN,
  "database:get-state": OPEN,
  "database:retry-startup": OPEN,
  // Discovery only inspects the local default-instance service and returns
  // aliases to the wizard. It does not connect, persist credentials, or alter
  // the terminal/database configuration.
  "database:list-servers": OPEN,
  // This is a temporary, read-only SQL Server probe. It does not save a
  // profile or change the terminal, so it can run before an admin unlock.
  "database:test-server": OPEN,
  // Both checks use a temporary SQL connection and do not save credentials
  // or change the selected database. A staff account can inspect the target
  // before an authorised operator commits configuration changes.
  "database:list-databases": OPEN,
  "database:validate": OPEN,
  "database:export-migrations": OPEN,
  "database:health": OPEN,
  "database:schema-status": OPEN,
  "jobs:get-active": OPEN,
  "jobs:get-history": OPEN,
  "sync:get-status": OPEN,
  "sync:get-failures": OPEN,
  "telemetry:presence": OPEN,
  "driver:list": OPEN,
  "pos:test": OPEN,
  "sqladmin:status": OPEN,

  /* --- supervisor: operational data and working state --- */
  "pos:housekeep": SUPERVISOR,
  "pos:retry-errored": SUPERVISOR,
  "pos:retry-row": SUPERVISOR,
  "pos:discard-row": SUPERVISOR,
  "pos:set-sync-enabled": SUPERVISOR,
  "pos:retry-connection": SUPERVISOR,
  "pos:reconnect": SUPERVISOR,
  "local:rollback": SUPERVISOR,
  "db:set-branch": SUPERVISOR,
  "branding:write": SUPERVISOR,
  "update:install": SUPERVISOR,
  "health:resume-updates": SUPERVISOR,

  /* --- admin: backend, company, database, identity, credentials, audit --- */
  "pos:connect": ADMIN,
  "database:set-enabled": ADMIN,
  "database:authorize-settings": ADMIN,
  "database:migrate": ADMIN,
  "database:migrate-saved": ADMIN,
  "database:save-connect": ADMIN,
  "database:disconnect": ADMIN,
  "database:remove-configuration": ADMIN,
  "database:backup": ADMIN,
  "database:restore": ADMIN,
  "sync:run-now": ADMIN,
  "sync:pause": ADMIN,
  "sync:resume": ADMIN,
  "sync:reconcile": ADMIN,
  "pos:configure-cloud": ADMIN,
  "pos:forget-connection": ADMIN,
  "pos:remove-connection": ADMIN,
  "pos:apply-schema": ADMIN,
  "pos:apply-schema-tables": ADMIN,
  "pos:restore": ADMIN,
  "pos:restore-verify": ADMIN,
  "pos:restore-drill": ADMIN,
  "pos:backup": ADMIN,
  "backend:set": ADMIN,
  "cloud:set": ADMIN,
  "cloud:remove": ADMIN,
  "terminal:write": ADMIN,
  "config:write": ADMIN,
  "config:set": ADMIN,
  "config:reset": ADMIN,
  "local:audit-clear": ADMIN,
  "staff:remember-pin": ADMIN,
  "staff:forget-pin": ADMIN,
  "driver:install": ADMIN,
  "health:rollback": ADMIN,
  "health:quit": ADMIN,
  "settings:set": ADMIN, // refined per key below
  "sqladmin:connect": SUPERVISOR,
  "sqladmin:cancel": SUPERVISOR,
  "sqladmin:probe-port": SUPERVISOR,
  "sqladmin:lock": SUPERVISOR,
  "sqladmin:databases": SUPERVISOR,
  "sqladmin:tables": SUPERVISOR,
  "sqladmin:columns": SUPERVISOR,
  "sqladmin:query": SUPERVISOR,
  "sqladmin:repair": ADMIN,
  "sqladmin:disconnect": SUPERVISOR,
};

/**
 * Channels the first-run screen needs before anybody can possibly sign in.
 * They are open only while the till has no connection and no activation; the
 * moment either exists, the normal level applies again.
 */
const FIRST_RUN_CHANNELS = new Set([
  "pos:connect",
  "pos:configure-cloud",
  "cloud:set",
  "backend:set",
  "terminal:write",
  "config:write",
  "config:set",
]);

/**
 * Channels an Emergency Access session may use without a username and PIN.
 *
 * Emergency Access exists to repair a terminal that cannot sign anybody in, so
 * everything needed to get it connected, activated and printing again is here:
 * connection, cloud keys, backend address, identity, configuration, the local
 * SQL Server and its driver, schema repair and hardware. Deliberately absent:
 * clearing the audit trail, backup/restore, and quitting or rolling back the
 * app — those are not repairs and stay with a real administrator.
 */
const RECOVERY_CHANNELS = new Set([
  "pos:connect",
  "pos:configure-cloud",
  "pos:forget-connection",
  "pos:remove-connection",
  "pos:apply-schema",
  "pos:apply-schema-tables",
  "pos:retry-connection",
  "pos:reconnect",
  "pos:set-sync-enabled",
  "cloud:set",
  "cloud:remove",
  "backend:set",
  "terminal:write",
  "config:write",
  "config:set",
  "config:reset",
  "settings:set",
  "db:set-branch",
  "branding:write",
  "driver:install",
  "local:rollback",
  "sqladmin:connect",
  "sqladmin:cancel",
  "sqladmin:probe-port",
  "sqladmin:lock",
  "sqladmin:databases",
  "sqladmin:tables",
  "sqladmin:columns",
  "sqladmin:repair",
  "sqladmin:disconnect",
]);

/* --------------------------- settings by key --------------------------- */

/**
 * Settings that decide where the money goes, who this till is, or what is
 * recorded. They are never changeable by an ordinary window.
 */
const RESTRICTED_SETTING_PATTERNS = [
  /^terminal/i,
  /^activation/i,
  /^backend/i,
  /^cloud/i,
  /^supabase/i,
  /^tenant/i,
  /^company/i,
  /^branch/i,
  /^store/i,
  /^db[_.:-]/i,
  /^database/i,
  /^sql/i,
  /^sync/i,
  /^audit/i,
  /^security/i,
  /^pin/i,
  /^auth/i,
  /^offline_grace/i,
  /^grace/i,
  /^licen[cs]e/i,
  /^update/i,
  /key$/i,
  /secret/i,
  /password/i,
  /token/i,
];

/** Preferences that only change how a screen looks. Safe for the register. */
const OPEN_SETTING_PATTERNS = [
  /^ui[_.:-]/i,
  /^display[_.:-]/i,
  /^theme/i,
  /^layout/i,
  /^receipt_(layout|font|logo_position|footer_note)/i,
  /^screen[_.:-]/i,
  /^last_/i,
  /^recent_/i,
  /^printer_preview/i,
];

function settingLevel(key) {
  const name = String(key ?? "");
  if (!name) return ADMIN;
  if (OPEN_SETTING_PATTERNS.some((p) => p.test(name))) return OPEN;
  if (RESTRICTED_SETTING_PATTERNS.some((p) => p.test(name))) return ADMIN;
  // Anything not recognised is operational, not free-for-all.
  return SUPERVISOR;
}

/** The level a call needs, taking its arguments into account. */
function levelFor(channel, args = []) {
  if (channel === "settings:set") return settingLevel(args[0]);
  if (channel === "config:set") return settingLevel(args[0]) === OPEN ? OPEN : ADMIN;
  return CHANNEL_LEVELS[channel] ?? ADMIN;
}

/* ------------------------------- the gate ------------------------------- */

/** Replaced by `install()` with the real stores. */
let firstRun = () => false;

function refusal(level, channel, args = []) {
  if (channel === "drawer:open") return {
    ok: false,
    code: "EPRIVILEGE",
    stage: "authorize",
    error: "This account does not have permission to open the cash drawer.",
  };
  if (databaseSyncAction(channel, args)) return {
    ok: false,
    code: "EPRIVILEGE",
    stage: "authorize",
    error: "This action requires the Manage database connection permission on your staff account. Sign in with an account that has it.",
  };
  return {
    ok: false,
    code: "EPRIVILEGE",
    requiredLevel: level,
    stage: "authorize",
    error:
      level === ADMIN
        ? "This action changes how the terminal is connected or identified. An administrator must unlock it with their username and PIN first."
        : "This action needs a supervisor. Unlock it with a supervisor username and PIN first.",
  };
}

/** True when the caller may run this channel with these arguments right now. */
function allowed(channel, args = []) {
  if (channel === "business:commit-aggregate") {
    const kind = String(args[0]?.kind ?? "");
    const permissions = {
      sale: ["can_process_sale"],
      payment: ["can_process_sale", "can_collect_booking"],
      refund: ["can_refund", "can_process_refund"],
      shift: ["can_open_shift", "can_close_shift"],
      receiving: ["can_receive_purchase_order"],
      stock: ["can_adjust_stock"],
      transfer: ["can_create_transfer", "can_receive_transfer", "can_approve_transfer"],
      booking: ["can_create_booking", "can_manage_bookings", "can_cancel_booking"],
      held_order: ["can_hold_cart"],
    }[kind];
    if (!adminSession.hasPosAuthority()) return false;
    if (!permissions) {
      if (!adminSession.hasLevel(SUPERVISOR)) return false;
    } else if (!permissions.some((permission) => adminSession.hasPermission(permission))) {
      return false;
    }
    adminSession.touch();
    return true;
  }
  if (channel === "drawer:open") {
    if (adminSession.hasPosAuthority() && adminSession.hasPermission("can_open_drawer")) {
      adminSession.touch();
      return true;
    }
    return false;
  }
  if (channel === "business:shift-expected") {
    if (adminSession.hasPosAuthority() && adminSession.hasPermission("can_shift_expected_cash_view")) {
      adminSession.touch();
      return true;
    }
    return false;
  }
  if (channel === "business:shift-close-start") {
    if (adminSession.hasPosAuthority() && adminSession.hasPermission("can_close_shift")) {
      adminSession.touch();
      return true;
    }
    return false;
  }
  if (channel === "business:shift-close-count") {
    if (adminSession.hasPosAuthority() &&
        (adminSession.hasPermission("can_shift_cash_count") || adminSession.hasPermission("can_close_shift"))) {
      adminSession.touch();
      return true;
    }
    return false;
  }
  if (channel === "business:shift-recount") {
    if (adminSession.hasPosAuthority() && adminSession.hasPermission("can_shift_cash_recount")) {
      adminSession.touch();
      return true;
    }
    return false;
  }
  if (channel === "business:shift-variance-approve") {
    if (adminSession.hasPosAuthority() && adminSession.hasPermission("can_shift_variance_approve")) {
      adminSession.touch();
      return true;
    }
    return false;
  }
  if (channel === "business:shift-reconciliation-view") {
    if (adminSession.hasPosAuthority() && [
      "can_shift_expected_cash_view", "can_shift_counted_cash_view", "can_shift_variance_view",
    ].some((permission) => adminSession.hasPermission(permission))) {
      adminSession.touch();
      return true;
    }
    return false;
  }
  if (channel === "business:query") {
    const table = String(args[0] ?? "");
    if (table === "shift_reconciliations") return false;
    const permission = table === "shift_close_events"
      ? "can_shift_closing_history_view"
      : table === "shift_cash_counts"
        ? "can_shift_counted_cash_view"
        : null;
    if (permission) {
      if (adminSession.hasPosAuthority() && adminSession.hasPermission(permission)) {
        adminSession.touch();
        return true;
      }
      return false;
    }
  }
  if (channel === "business:save-authorization-rule") {
    if (adminSession.hasPosAuthority() && adminSession.hasPermission("can_access_pos_settings")) {
      adminSession.touch();
      return true;
    }
    return false;
  }
  const level = levelFor(channel, args);
  if (level === OPEN) return true;
  if (FIRST_RUN_CHANNELS.has(channel) && firstRun()) return true;
  if (RECOVERY_CHANNELS.has(channel) && typeof adminSession.recoveryActive === "function" && adminSession.recoveryActive()) {
    adminSession.recoveryTouch?.();
    return true;
  }
  if (databaseSyncAction(channel, args)) {
    // Database authority comes only from the live POS account adopted through
    // /api/v1/pos/ipc-adopt. A separate desktop PIN unlock must not grant it.
    if (adminSession.hasPosAuthority() &&
        (adminSession.hasLevel(ADMIN) || adminSession.hasPermission("can_manage_sync_backup"))) {
      adminSession.touch();
      return true;
    }
    return false;
  }
  if (adminSession.hasLevel(level)) {
    adminSession.touch();
    return true;
  }
  return false;
}

/**
 * Wraps `ipcMain.handle` so every channel — the ones registered today and any
 * added later — passes the gate before its body runs.
 */
function install(ipcMain, { isFirstRun } = {}) {
  if (typeof isFirstRun === "function") firstRun = isFirstRun;
  const original = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener) =>
    original(channel, (event, ...args) => {
      if (!allowed(channel, args)) return refusal(levelFor(channel, args), channel, args);
      return listener(event, ...args);
    });
  return ipcMain;
}

module.exports = {
  OPEN,
  SUPERVISOR,
  ADMIN,
  CHANNEL_LEVELS,
  DATABASE_SYNC_CHANNELS,
  databaseSyncAction,
  FIRST_RUN_CHANNELS,
  RECOVERY_CHANNELS,
  settingLevel,
  levelFor,
  allowed,
  refusal,
  install,
};
