/**
 * Bridge to the Windows desktop shell's local Microsoft SQL Server database.
 *
 * In the packaged Electron app the preload script exposes `window.pos`, and
 * every write becomes a parameterised T-SQL statement executed in the main
 * process. The bridge is absent in web and Android builds; those clients write
 * live to the central database and never queue business data locally.
 */
import type { SyncOp } from "@/lib/sync-outbox";
import type { ShiftState } from "@/core/types/pos-types";

export type LocalDbConfig = {
  server: string;
  database: string;
  /** "windows" uses integrated auth, "sql" uses the user/password pair. */
  auth: "windows" | "sql";
  user: string;
  password: string;
  port: number;
  encrypt: boolean;
  /** Accept self-signed / internal certificates. */
  trustServerCertificate?: boolean;
  /** SET ARITHABORT ON for the session. */
  arithAbort?: boolean;
};

export const defaultLocalDbConfig: LocalDbConfig = {
  server: "127.0.0.1",
  database: "",
  auth: "windows",
  user: "",
  password: "",
  port: 1433,
  encrypt: true,
  trustServerCertificate: true,
  arithAbort: true,
};

export type TableSyncStat = {
  table: string;
  pending: number;
  synced: number;
  errored: number;
};

export type SyncQueueRow = {
  table: string;
  id: string;
  status: string;
  error: string | null;
  updatedAt: string | null;
};

export type LocalDbTestResult = {
  ok: boolean;
  version?: string;
  serverName?: string;
  activeDb?: string;
  latencyMs?: number;
  error?: string;
  code?: string | null;
  originalMessage?: string | null;
  hint?: string | null;
};

/**
 * The one state every panel reads. Derived in a single place so a spinner can
 * never outlive the work it belongs to, and nothing reports "connected" before
 * the shell has proved the database answers.
 */
export type LocalWriteCheck = {
  ok: boolean;
  activeDb?: string | null;
  createdProbeTable?: boolean;
  rolledBack?: boolean;
  latencyMs?: number;
  error?: string;
  code?: string | null;
  hint?: string | null;
};

/**
 * Migration guard for the saved connection plus isolated-driver health.
 *
 * Audit of an explicit host and TCP port connection.
 */
export type LocalConnectionAudit = {
  ok: boolean;
  configured: boolean;
  direct: boolean;
  needsPort: boolean;
  host: string | null;
  port: number | null;
  target: string | null;
  issues: Array<{ code: string; severity: "error" | "warning"; message: string; hint?: string }>;
  driver?: {
    workers: number;
    maxWorkers: number;
    orphanedSessions: number;
    sessionWarning: boolean;
    crashTargets: Array<{ target: string; consecutive: number; blocked: boolean }>;
    crashBlocked: boolean;
  };
};

export type LocalDbConnectionState =
  | "unavailable"
  | "not_configured"
  | "testing"
  | "saving"
  | "initializing"
  | "connected"
  | "failed"
  | "driver_blocked";

export type LocalDbConnectionView = {
  state: LocalDbConnectionState;
  /** One plain line an operator can act on. */
  message: string;
  detail?: string | null;
  busy: boolean;
};

const STATE_MESSAGE: Record<LocalDbConnectionState, string> = {
  unavailable: "Local database unavailable",
  not_configured: "Local database requires setup",
  testing: "Checking the local database…",
  saving: "Saving the connection…",
  initializing: "Reconnecting…",
  connected: "Database: Connected",
  failed: "Local database unavailable",
  driver_blocked: "Local database driver stopped",
};

export function describeLocalDbState(
  state: LocalDbConnectionState,
  detail?: string | null,
): LocalDbConnectionView {
  return {
    state,
    message: STATE_MESSAGE[state],
    detail: detail ?? null,
    busy: state === "testing" || state === "saving" || state === "initializing",
  };
}

/**
 * Turns the shell's raw status into the single state above.
 *
 * `pending` is whatever the UI is doing right now (a wizard run, a save); it
 * always wins, because that is the only work the spinner belongs to.
 */
export function deriveLocalDbState(input: {
  available: boolean;
  configured: boolean;
  status:
    | (Pick<LocalSyncStatus, "connected" | "error" | "durability" | "sqlServer"> & {
        errorHint?: string | null;
        errorCode?: string | null;
      })
    | null;
  pending?: "testing" | "saving" | null;
}): LocalDbConnectionView {
  if (!input.available) return describeLocalDbState("unavailable");
  if (input.pending) return describeLocalDbState(input.pending);
  // Configuration is the first invariant: no runtime or cached status may
  // turn a fresh/unconfigured installation green.
  if (!input.configured) return describeLocalDbState("not_configured");
  if (input.status?.connected) return describeLocalDbState("connected");
  if (input.status?.durability && !input.status.durability.ok)
    return describeLocalDbState(
      "failed",
      "Local SQL Server transaction store unavailable. Trading durability is not ready.",
    );
  if (input.status?.sqlServer && !input.status.sqlServer.ok)
    return describeLocalDbState(
      "failed",
      "Local SQL Server connection unavailable. Trading remains in Central Online mode.",
    );
  // A repeated driver crash is deterministic: the banner says so and the till
  // stops pretending a retry is imminent.
  if (input.status?.errorCode === "EDRIVER_CRASH_LOOP") {
    return describeLocalDbState("driver_blocked", reconnectReason(input.status));
  }
  if (input.status?.error) return describeLocalDbState("failed", reconnectReason(input.status));
  return describeLocalDbState("initializing", "Trying to reach the saved database.");
}

/**
 * The banner shows the driver's actual reason, not a generic line: a stopped
 * A wrong host or TCP port is a fixable misconfiguration and the operator
 * should be told which one it is.
 */
export function reconnectReason(status: {
  error?: string | null;
  errorHint?: string | null;
}): string {
  const parts = [status.error?.trim(), status.errorHint?.trim()].filter(Boolean);
  return parts.length ? parts.join(" ") : "Trying to reach the saved database.";
}

/**
 * Reads the saved-connection audit. Never throws: diagnostics failing must not
 * take the settings screen down with them.
 */
export async function readConnectionAudit(): Promise<LocalConnectionAudit | null> {
  const bridge = localDb();
  if (!bridge?.getConnectionAudit) return null;
  try {
    return await withIpcTimeout(
      bridge.getConnectionAudit(),
      5_000,
      "The connection check did not answer.",
    );
  } catch {
    return null;
  }
}

/**
 * Writes one diagnostic report file and reveals it. Used when a shop needs to
 * send evidence of a crash to support without hunting through a log folder.
 */
export async function saveDiagnosticReport(): Promise<{ ok: boolean; file?: string }> {
  const bridge = localDb() as
    (PosBridge & { collectDiagnostics?: () => Promise<{ ok: boolean; file?: string }> }) | null;
  if (!bridge?.collectDiagnostics) return { ok: false };
  try {
    return await withIpcTimeout(bridge.collectDiagnostics(), 10_000, "The report timed out.");
  } catch {
    return { ok: false };
  }
}

/** No IPC call may hang the UI: everything gets an outer deadline. */
export async function withIpcTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return (await Promise.race([
    work.finally(() => clearTimeout(timer)),
    new Promise<never>((_r, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ])) as T;
}

/**
 * Save the details and point the till at the database. Resolves as soon as the
 * shell has proved the local database is usable; cloud sync starts behind it.
 */
export async function connectLocalDatabase(
  config: LocalDbConfig,
  cloud?: CloudBridgeConfig,
): Promise<LocalDbTestResult> {
  const bridge = localDb();
  if (!bridge) return { ok: false, error: "Only the Windows desktop app has a local database." };
  try {
    await writeLocalDbConfig(config);
  } catch (err) {
    return {
      ok: false,
      error: `The connection details could not be saved: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
  try {
    return await withIpcTimeout(
      bridge.connect(config, cloud),
      60_000,
      "The desktop shell did not answer. The local database may be unreachable — check the server name and firewall.",
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Parameters accepted by the direct (Browser-free) connection probe. */
export type DirectConnectionParams = {
  host: string;
  port: number;
  database: string;
  authType: "windows" | "sql";
  username?: string;
  password?: string;
  encrypt: boolean;
  trustServerCertificate: boolean;
  arithAbort: boolean;
  timeout?: number;
};

export type LocalSyncStatus = {
  connected: boolean;
  tradingReady?: boolean;
  durability?: { ok: boolean; code?: string | null; error?: string; rolledBack?: boolean };
  sqlServer?: {
    ok: boolean;
    code?: string | null;
    error?: string;
    activeDb?: string | null;
    rolledBack?: boolean;
  };
  error?: string;
  /** Structured reason from the shell, so the banner can be specific. */
  errorCode?: string | null;
  errorHint?: string | null;
  errorStage?: string | null;
  reconnecting?: boolean;
  configured?: boolean;
  lastConnectionCheckAt?: string | null;
  lastSuccessfulConnectionAt?: string | null;
  cloudConfigured?: boolean;
  phase?: "idle" | "pushing" | "pulling";
  pending?: number;
  failed?: number;
  conflicts?: number;
  lastError?: string | null;
  running?: boolean;
  paused?: boolean;
  enabled?: boolean;
  /** The central project rejected this device's keys — sync is parked. */
  credentialsInvalid?: boolean;
  mutationPath?: "relay" | "authenticated-direct" | "pending-auth" | "authorization-refused";
  businessBatches?: {
    pending: number;
    failed: number;
    parked: number;
    sales: number;
    rows: Array<{
      id: string;
      status: "pending" | "failed" | "dead_letter";
      attempts: number;
      client_transaction_id?: string | null;
      created_at: string;
      last_attempt_at?: string | null;
      error_message?: string | null;
      error_detail?: string | null;
    }>;
  };
  lastBusinessPush?: {
    batchId: string;
    clientTransactionId?: string | null;
    localCommittedAt: string;
    pushStartedAt: string;
    acknowledgedAt?: string | null;
    durationMs?: number | null;
    result: "pushing" | "synced" | "pending" | "failed";
    reason?: string;
  } | null;
  lastFailure?: {
    stage:
      | "sql-server"
      | "sql-projection"
      | "cloud-push"
      | "cloud-pull"
      | "connectivity"
      | "staff-roster"
      | "worker";
    message: string;
    reason: string;
    at: string;
    batchId?: string | null;
    table?: string | null;
  } | null;
  tables: TableSyncStat[];
  queue?: SyncQueueRow[];
  lastPushAt: string | null;
  lastPullAt: string | null;
  lastRestoreAt?: string | null;
  restore?: Record<string, unknown> | null;
  drill?: Record<string, unknown> | null;

  server?: string | null;
  database?: string | null;
};

export type PosBridge = {
  /** Close only the Electron window that sent the request. */
  closeWindow?: () => Promise<unknown>;
  onBeforeClose?: (flush: () => Promise<void>) => () => void;
  cacheStatus?: () => Promise<{
    ok: boolean;
    totalBytes: number;
    cacheBytes: number;
    diagnosticBytes: number;
    retainedBytes: number;
  }>;
  clearAppCache?: () => Promise<{
    ok: boolean;
    removedEntries?: number;
    removedInstallers?: number;
    totalBytes?: number;
    cacheBytes?: number;
    diagnosticBytes?: number;
    retainedBytes?: number;
    error?: string;
  }>;
  saveAuthorizationRule?: (value: Record<string, unknown>) => Promise<{
    ok: boolean;
    rule?: Record<string, unknown>;
    error?: string;
    code?: string;
  }>;
  openDrawer?: (value: {
    reason: string;
    shiftId?: string | null;
    pin?: 2 | 5;
    printer?: { deviceName?: string; share?: string };
  }) => Promise<{ ok: boolean; eventId?: string; error?: string; code?: string }>;
  database?: {
    getState: () => Promise<{ enabled: boolean; connected: boolean; tradingReady?: boolean; state: string }>;
  };
  telemetry?: {
    presence: (value: { sessionStatus: "signed_in" | "idle"; staffName: string | null; staffRole: string | null }) => Promise<{ ok: boolean }>;
  };
  sync?: {
    getStatus?: () => Promise<LocalSyncStatus>;
    runNow?: (options?: { branchId?: string; batchSize?: number }) => Promise<
      LocalSyncStatus & { ok?: boolean; busy?: boolean; pushed?: number; merged?: number }
    >;
    finalizeShiftClose?: (shiftId: string) => Promise<
      LocalSyncStatus & {
        ok: boolean;
        offline?: boolean;
        pushed?: number;
        merged?: number;
        error?: string;
        code?: string;
      }
    >;
    auto?: () => Promise<
      LocalSyncStatus & { ok?: boolean; busy?: boolean; skipped?: boolean; pushed?: number; merged?: number }
    >;
    pause?: () => Promise<LocalSyncStatus>;
    resume?: () => Promise<LocalSyncStatus>;
    getFailures?: () => Promise<Record<string, unknown>>;
    reconcile?: (options?: Record<string, unknown>) => Promise<Record<string, unknown>>;
    subscribe?: (cb: (status: LocalSyncStatus) => void) => () => void;
  };
  /** Persist one operation to local SQL Server. Resolves once committed. */
  write: (context: string, op: SyncOp) => Promise<{ ok: boolean; error?: string; code?: string; stage?: string | null; table?: string | null; sqlNumber?: number | null }>;
  /** Persist a related operation set in one SQL transaction. */
  writeBatch?: (context: string, ops: SyncOp[]) => Promise<{ ok: boolean; error?: string; code?: string; stage?: string | null; table?: string | null; sqlNumber?: number | null }>;
  /** Commit a complete workflow and its metadata exactly once. */
  commitAggregate?: (aggregate: {
    kind: "sale" | "payment" | "refund" | "shift" | "product" | "receiving" | "stock" | "transfer" | "booking" | "held_order" | "general" | "branch";
    operationId?: string;
    branchId?: string;
    operations: SyncOp[];
  }) => Promise<{ ok: boolean; replayed?: boolean; operationId?: string; error?: string; code?: string; stage?: string | null; table?: string | null; sqlNumber?: number | null }>;
  connect: (
    config: LocalDbConfig,
    cloud?: CloudBridgeConfig,
  ) => Promise<LocalDbTestResult & { cloudError?: string }>;
  configureCloud: (cloud: CloudBridgeConfig) => Promise<{ ok: boolean; error?: string }>;
  test: (config: LocalDbConfig) => Promise<LocalDbTestResult>;
  getDatabaseConfig?: () => Promise<Partial<LocalDbConfig> | null>;
  getConnectionAudit?: () => Promise<LocalConnectionAudit>;
  /** Writes one shareable diagnostic report and reveals it in the file manager. */
  collectDiagnostics?: () => Promise<{ ok: boolean; file?: string }>;
  /** Append a redacted connection/load event to the Electron support log. */
  logConnection?: (event: string, detail: Record<string, unknown>) => Promise<{ ok: boolean }>;
  openLogFolder?: () => Promise<unknown>;
  /** Forget the saved connection and drop every pool (escape hatch). */
  resetConnection?: () => Promise<{ ok: boolean; error?: string | null }>;
  /** Forget the saved connection (same as resetConnection, explicit name). */
  forgetConnection?: () => Promise<{ ok: boolean; error?: string | null }>;
  /** Delete the sealed credentials file and stop the background retry loop. */
  removeConnection?: () => Promise<{
    ok: boolean;
    removed?: boolean;
    error?: string | null;
  }>;
  /**
   * Rebuild the connection. With no argument the saved credentials are used;
   * pass the values on screen to retry those instead.
   */
  reconnect?: (override?: Partial<LocalDbConfig>) => Promise<LocalDbReconnectResult>;
  /** Ask the background loop for an immediate attempt. */
  retryConnection?: () => Promise<{ ok: boolean }>;

  /** Read the single master schema file — passive, never executes anything. */
  readSchema?: () => Promise<{
    ok: boolean;
    file?: string;
    text?: string;
    tables?: string[];
    error?: string;
  }>;
  /** Retired local-schema hook retained only for compatibility with older typings. */
  applySchema?: () => Promise<{ ok: boolean; file?: string; error?: string }>;
  /**
   * Per-table schema manifest compared live against the connected database.
   * When not connected, tables still come back with exists/present = null.
   */
  schemaStatus?: () => Promise<{
    ok: boolean;
    connected?: boolean;
    file?: string;
    text?: string;
    tables?: Array<{
      name: string;
      exists: boolean | null;
      columns: Array<{ name: string; type: string; present: boolean | null }>;
      missingColumns: string[];
      extraColumns: string[];
      columnCount: number | null;
    }>;
    unknownTables?: string[];
    warnings?: string[];
    error?: string;
  }>;
  /** Deep read-only inventory: nullability, defaults, keys, indexes, triggers. */
  schemaInventory?: () => Promise<{
    ok: boolean;
    connected?: boolean;
    tables?: Record<
      string,
      {
        columns: Record<string, { type: string | null; nullable: boolean; default: string | null }>;
        primaryKey: string[];
        foreignKeys: string[];
        constraints: string[];
        indexes: string[];
        triggers: string[];
      }
    >;
    error?: string;
  }>;
  /** Repair only the selected tables. Guarded batches — never drops data. */
  applySchemaTables?: (tables: string[]) => Promise<{
    ok: boolean;
    applied?: string[];
    unknownTables?: string[];
    batchCount?: number;
    errors?: Array<{ scope: string; code?: string; error?: string; permission?: boolean }>;
    /** True when the login lacks CREATE/ALTER rights — offer admin repair. */
    permission?: boolean;
    error?: string;
  }>;
  /** Runnable SQL script for the chosen tables (empty array = full file). */
  schemaTableSql?: (tables: string[]) => Promise<{
    ok: boolean;
    file?: string;
    tables?: string[];
    text?: string;
    error?: string;
  }>;
  status: () => Promise<LocalSyncStatus>;
  /** Transactional write probe on the operational pool (always rolled back). */
  verifyWrite?: () => Promise<LocalWriteCheck>;
  push: () => Promise<{ ok: boolean; pushed: number; failed: number; error?: string }>;
  pull: () => Promise<{ ok: boolean; merged: number; error?: string }>;
  /** One mutex-protected main-process sync cycle on Electron. */
  syncNow?: () => Promise<
    LocalSyncStatus & {
      ok: boolean;
      busy?: boolean;
      pushed?: number;
      failed?: number;
      merged?: number;
    }
  >;

  setSyncEnabled: (on: boolean) => Promise<void>;
  setSyncConfig?: (config: {
    intervalMs?: number;
    batchSize?: number;
    maxAttempts?: number;
    maxBackoffMs?: number;
  }) => Promise<unknown>;

  retryErrored: () => Promise<{ ok: boolean }>;
  retryRow?: (table: string, id: string) => Promise<{ ok: boolean; error?: string }>;
  /** Stop retrying a change that can never succeed (desktop shell only). */
  discardRow?: (table: string, id: string) => Promise<{ ok: boolean; error?: string }>;
  /** Prunes rows the central database has confirmed plus orphaned temp files. */
  housekeep?: (options?: { retentionDays?: number }) => Promise<{
    ok: boolean;
    error?: string;
    files?: number;
    bytes?: number;
    rows?: number;
  }>;
  snapshot: (options?: { salesOnly?: boolean }) => Promise<{
    ok: boolean;
    error?: string;
    products?: LocalSaleRow[];
    members?: LocalSaleRow[];
    stores?: LocalSaleRow[];
    shifts?: LocalSaleRow[];
    sales?: LocalSaleRow[];
    promotions?: LocalSaleRow[];
    tiers?: LocalSaleRow[];
    settings?: LocalSaleRow | null;
    settingFields?: LocalSaleRow[];
  }>;
  /** Branch-scoped, read-only query against this Electron terminal's SQL Server. */
  query?: (
    table: string,
    options?: {
      columns?: string;
      match?: Record<string, unknown>;
      in?: { column: string; values: unknown[] };
      orderBy?: { column: string; ascending?: boolean };
      limit?: number;
      offset?: number;
      cursor?: { column: string; value: string; id: string };
    },
  ) => Promise<{ ok: boolean; rows?: LocalSaleRow[]; error?: string; code?: string }>;
  /** Constant-memory SQL aggregation used by the blind shift-close workflow. */
  shiftExpectedTotals?: (shiftId: string) => Promise<{
    ok: boolean;
    expected_cash?: number;
    expected_card?: number;
    expected_digital?: number;
    total_sales?: number;
    error?: string;
    code?: string;
  }>;
  shiftCloseStart?: (value: {
    shiftId: string;
    reason: string;
    terminalId?: string | null;
  }) => Promise<{ ok: boolean; state?: ShiftState; replayed?: boolean; error?: string; code?: string }>;
  /** Trusted main-process blind count. Expected amounts never enter the renderer. */
  shiftCloseCount?: (value: {
    shiftId: string;
    cash: number;
    card: number | null;
    digital: number | null;
    clientKey?: string;
    terminalId?: string | null;
  }) => Promise<{
    ok: boolean;
    state?: ShiftState;
    replayed?: boolean;
    error?: string;
    code?: string;
  }>;
  shiftRecount?: (value: {
    shiftId: string;
    cash: number;
    card: number | null;
    digital: number | null;
    reason: string;
    terminalId?: string | null;
  }) => Promise<{ ok: boolean; state?: ShiftState; error?: string; code?: string }>;
  shiftVarianceApprove?: (value: {
    shiftId: string;
    note?: string | null;
  }) => Promise<{ ok: boolean; state?: ShiftState; replayed?: boolean; error?: string; code?: string }>;
  shiftReconciliationView?: (shiftId: string) => Promise<{
    ok: boolean;
    rows?: LocalSaleRow[];
    error?: string;
    code?: string;
  }>;
  /** Main-process notification emitted after a durable local aggregate commit. */
  analytics?: (from: string, to: string) => Promise<{ ok: boolean; error?: string; storeDays?: LocalSaleRow[]; itemDays?: LocalSaleRow[]; bills?: LocalSaleRow[]; directory?: LocalSaleRow[] }>;
  onReadProgress?: (cb: (progress: { table: string; completed: number }) => void) => () => void;
  onBusinessChanged?: (
    cb: (change: {
      kind: "sale" | "payment" | "refund" | "shift" | "product" | "receiving" | "stock" | "transfer" | "booking" | "held_order" | "general" | "branch";
      branchId?: string | null;
      operationId?: string | null;
      source?: "local" | "cloud";
      tables?: string[];
      changes?: { table: string; entityId?: string | null }[];
    }) => void,
  ) => () => void;
  findReceipt?: (value: string, branchId: string, proof?: { sessionToken?: string; cashierToken?: string; accessToken?: string }) => Promise<{ source: "local" | "cloud"; sale: LocalSaleRow; items?: LocalSaleRow[]; payments?: LocalSaleRow[] } | null>;
  refundReceipt?: (value: { saleId: string; refundId: string; branchId: string; reason?: string | null }) => Promise<{ ok: boolean; replayed?: boolean; error?: string; code?: string; stage?: string | null; table?: string | null; sqlNumber?: number | null }>;
  /** Device settings stored in the branch SQL database. */
  getSetting?: (key: string) => Promise<{ ok: boolean; value?: string | null; error?: string }>;
  setSetting?: (key: string, value: string | null) => Promise<{ ok: boolean; error?: string }>;
  onStatus: (cb: (s: LocalSyncStatus) => void) => () => void;

  /* ---- offline cashier sign-in, backed by the local SQL database ---- */
  staffRoster?: (storeId?: string | null) => Promise<{ ok: boolean; rows: LocalStaffRow[] }>;
  cacheStaffRoster?: (rows: Record<string, unknown>[]) => Promise<{ ok: boolean; written: number }>;
  verifyStaffPin?: (
    username: string,
    pin: string,
  ) => Promise<{
    ok: boolean;
    reason?: string;
    error?: string;
    staff?: {
      id: string;
      username: string;
      full_name: string;
      store_id: string | null;
      permissions: Record<string, boolean>;
      role_slug?: string;
    };
  }>;
  verifyApprovalPin?: PosBridge["verifyStaffPin"];
  rememberStaffPin?: (username: string, pin: string) => Promise<{ ok: boolean }>;
  forgetStaffPin?: (username: string) => Promise<{ ok: boolean }>;
  /** Hosted PIN verification performed by Electron main, outside Chromium. */
  cashierLogin?: (
    username: string,
    pin: string,
  ) => Promise<{
    ok?: boolean;
    status?: number;
    code?: string;
    error?: string;
    authTokenHash?: string;
    cashierToken?: string;
    sessionToken?: string;
    cashier?: {
      id: string;
      username: string;
      full_name: string;
      store_id: string | null;
      role: "admin" | "manager" | "staff";
      role_slug: string | null;
      permissions: Record<string, boolean>;
    };
  }>;

  /* ---- the bundled app server holds no privileged key: presence only ---- */
  serverKeyStatus?: () => Promise<{ ok: boolean; hasSigningKey: boolean }>;

  /* ---- address of the hosted backend this device talks to ---- */
  backendUrl?: () => Promise<{ ok: boolean; url?: string }>;
  setBackendUrl?: (value: string) => Promise<{ ok: boolean; url?: string; error?: string }>;

  /* ---- tenant cloud credentials sealed in the OS vault ---- */

  cloudKeyStatus?: () => Promise<{
    ok: boolean;
    configured: boolean;
    url: string;
    keyHint: string;
    encrypted: boolean;
  }>;
  /** Boot-time read of the sealed pair so the renderer can configure its client. */
  bootstrapCloudCredentials?: () => Promise<{ ok: boolean; url?: string; key?: string }>;
  setCloudCredentials?: (value: {
    url: string;
    key: string;
  }) => Promise<{ ok: boolean; error?: string; encrypted?: boolean }>;
  removeCloudCredentials?: () => Promise<{ ok: boolean; error?: string }>;
  /** Fired by the shell at launch when no cloud keys are configured yet. */
  onCloudSetupRequired?: (cb: (payload: { platform: string }) => void) => () => void;
};

/** A staff row mirrored into the till's local database. */
export type LocalStaffRow = {
  id: string;
  username: string;
  fullName: string;
  email: string;
  roleSlug: string;
  storeId: string | null;
  isActive: boolean;
  pinLength: number;
  permissions: Record<string, boolean>;
};

export type CloudBridgeConfig = {
  url: string;
  key: string;
  accessToken?: string;
  sessionToken?: string;
  cashierToken?: string;
  terminalToken?: string;
  branchId?: string;
};

declare global {
  interface Window {
    pos?: PosBridge;
    electronAPI?: ElectronDbApi;
  }
}

/* ------------------------- offline register API ------------------------- */

export type LocalSaleRow = Record<string, unknown>;

export type BranchInfo = { branchId: string | null; branchName: string | null };

export type ElectronDbApi = {
  getProducts: () => Promise<{ ok: boolean; error?: string; products?: LocalSaleRow[] }>;
  getPendingSyncCount: () => Promise<{
    ok: boolean;
    total: number;
    sales: number;
    error?: string;
  }>;
  getBranch: () => Promise<{ ok: boolean } & Partial<BranchInfo>>;
  setBranch: (branch: BranchInfo) => Promise<{ ok: boolean; error?: string }>;
};

/** The offline database API, or null in a plain browser. */
export const electronDb = (): ElectronDbApi | null =>
  typeof window === "undefined" ? null : (window.electronAPI ?? null);

const BRANCH_KEY = "pos.branch";

export const defaultBranch: BranchInfo = { branchId: null, branchName: null };

/** Branch identity for this till, mirrored locally so the UI can render it. */
export function readBranch(): BranchInfo {
  if (typeof window === "undefined") return defaultBranch;
  try {
    const raw = window.localStorage.getItem(BRANCH_KEY);
    return raw ? { ...defaultBranch, ...(JSON.parse(raw) as Partial<BranchInfo>) } : defaultBranch;
  } catch {
    return defaultBranch;
  }
}

export function writeBranch(branch: BranchInfo) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(BRANCH_KEY, JSON.stringify(branch));
  void electronDb()?.setBranch(branch);
}

/** True when running inside the Windows desktop shell. */
export const hasLocalDb = (): boolean => typeof window !== "undefined" && !!window.pos;

/** True when a real local SQL engine is reachable through the desktop shell. */
export const hasLocalSqlEngine = (): boolean =>
  typeof window !== "undefined" && typeof (window.pos as { database?: { getState?: unknown } })?.database?.getState === "function";

/** Read a device setting from the branch SQL database, if there is one. */
export async function readLocalSetting(key: string): Promise<string | null> {
  const bridge = localDb();
  if (!bridge?.getSetting) return null;
  try {
    const res = await bridge.getSetting(key);
    return res.ok ? (res.value ?? null) : null;
  } catch {
    return null;
  }
}

/** Store a device setting in the branch SQL database when one is present. */
export async function writeLocalSetting(key: string, value: string | null): Promise<boolean> {
  const bridge = localDb();
  if (!bridge?.setSetting) return false;
  try {
    return (await bridge.setSetting(key, value)).ok;
  } catch {
    return false;
  }
}

export const localDb = (): PosBridge | null =>
  typeof window === "undefined" ? null : (window.pos ?? null);

/**
 * Proves the till's own pool can write: one transaction that inserts, reads
 * back, then rolls back. Nothing customer-facing is touched.
 */
export async function verifyLocalWrite(timeoutMs = 30_000): Promise<LocalWriteCheck> {
  const bridge = localDb();
  if (!bridge?.verifyWrite) {
    return { ok: false, error: "Only the Windows desktop app can write to a local database." };
  }
  try {
    return await withIpcTimeout(
      bridge.verifyWrite(),
      timeoutMs,
      "The write check did not finish. The database accepted the sign-in but never answered the write.",
    );
  } catch (err) {
    return { ok: false, code: "ETIMEOUT", error: err instanceof Error ? err.message : String(err) };
  }
}

/** Single connection probe with explicit TLS options; reports latency. */
export async function testDirectConnection(
  params: DirectConnectionParams,
): Promise<LocalDbTestResult> {
  const bridge = localDb();
  if (!bridge) {
    return { ok: false, error: "Only the Windows desktop app can reach a local SQL Server." };
  }
  try {
    return await bridge.test({
      server: params.host,
      database: params.database,
      auth: params.authType,
      user: params.username ?? "",
      password: params.password ?? "",
      port: params.port,
      encrypt: params.encrypt,
      trustServerCertificate: params.trustServerCertificate,
      arithAbort: params.arithAbort,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

let cachedConfig: LocalDbConfig | null = null;

export function readLocalDbConfig(): LocalDbConfig {
  return cachedConfig ?? defaultLocalDbConfig;
}

/**
 * Load the canonical connection details from Electron's OS-encrypted store.
 * Browser storage is deliberately not a connection authority.
 */
export async function loadLocalDbConfig(): Promise<LocalDbConfig> {
  if (typeof window === "undefined") return defaultLocalDbConfig;
  const sealed = await localDb()?.getDatabaseConfig?.();
  if (sealed) {
    cachedConfig = { ...defaultLocalDbConfig, ...sealed };
    return cachedConfig;
  }
  cachedConfig = defaultLocalDbConfig;
  return cachedConfig;
}

/** Load form values without confusing defaults with persisted authority. */
export async function loadLocalDbConfigState(): Promise<{
  config: LocalDbConfig;
  configured: boolean;
}> {
  if (typeof window === "undefined") return { config: defaultLocalDbConfig, configured: false };
  const sealed = await localDb()?.getDatabaseConfig?.();
  if (!sealed) {
    cachedConfig = defaultLocalDbConfig;
    return { config: cachedConfig, configured: false };
  }
  cachedConfig = { ...defaultLocalDbConfig, ...sealed };
  return { config: cachedConfig, configured: true };
}

/**
 * Keep current wizard values in memory. The main process persists them only
 * after the operational connection has been verified.
 */
export async function writeLocalDbConfig(config: LocalDbConfig) {
  if (typeof window === "undefined") return;
  cachedConfig = config;
}

/**
 * Escape hatch for a stuck or unwanted connection: cancels anything in flight,
 * closes both pools and forgets the sealed credentials. Safe to call at any
 * time, including while the wizard is mid-run.
 */
export type LocalDbReconnectResult = {
  ok: boolean;
  stage?: string;
  activeDb?: string | null;
  serverName?: string | null;
  latencyMs?: number | null;
  error?: string | null;
  hint?: string | null;
};

/**
 * Rebuild the connection from the credentials already saved on this till.
 *
 * This is the fix for "Reconnecting…" that never recovered: it tears both
 * pools down, cancels anything wedged and opens the saved connection again,
 * without asking the operator to restart or to type the server details afresh.
 */
export async function reconnectLocalDatabase(
  override?: Partial<LocalDbConfig>,
): Promise<LocalDbReconnectResult> {
  const bridge = localDb();
  if (!bridge?.reconnect) {
    return { ok: false, error: "Only the Windows desktop app holds a local database connection." };
  }
  try {
    return await withIpcTimeout(
      bridge.reconnect(override),
      70_000,
      "The reconnect did not finish in time.",
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Nudge the background retry loop to attempt right now. */
export async function retryLocalDatabaseNow(): Promise<{ ok: boolean }> {
  const bridge = localDb();
  if (!bridge?.retryConnection) return { ok: false };
  try {
    return await withIpcTimeout(bridge.retryConnection(), 10_000, "The retry request timed out.");
  } catch {
    return { ok: false };
  }
}

export async function resetLocalDatabase(): Promise<{ ok: boolean; error?: string | null }> {
  const bridge = localDb();
  const forget = bridge?.forgetConnection ?? bridge?.resetConnection;
  if (!forget) {
    return { ok: false, error: "Only the Windows desktop app holds a local database connection." };
  }
  try {
    const res = await withIpcTimeout(
      forget(),
      15_000,
      "The reset did not finish in time. Restart the till if the connection stays stuck.",
    );
    cachedConfig = defaultLocalDbConfig;
    return res;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Delete the stored credentials for good. The shell unlinks the sealed file,
 * cancels anything in flight and stops the background retry loop, so the till
 * lands back on a clean "requires setup" state.
 */
export async function removeStoredConnection(): Promise<{
  ok: boolean;
  removed?: boolean;
  error?: string | null;
}> {
  const bridge = localDb();
  const remove = bridge?.removeConnection ?? bridge?.forgetConnection ?? bridge?.resetConnection;
  if (!remove) {
    return { ok: false, error: "Only the Windows desktop app holds a local database connection." };
  }
  try {
    const res = await withIpcTimeout(
      remove(),
      15_000,
      "Removing the saved connection did not finish in time.",
    );
    cachedConfig = defaultLocalDbConfig;
    return res;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
