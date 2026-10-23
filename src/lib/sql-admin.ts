/**
 * Typed renderer bridge to the desktop shell's SSMS-style administration
 * connection. In a browser the bridge is absent and every call resolves to a
 * friendly "desktop only" result, so no page can crash on the web build.
 */
export type SqlAdminCredentials = {
  server: string;
  database?: string;
  port?: number;
  /** The validated direct TCP port for this connection attempt. */
  resolvedPort?: number;
  auth: "windows" | "sql";
  user?: string;
  password?: string;
  domain?: string;
  encrypt?: boolean;
  trustServerCertificate?: boolean;
  /** Identity of the wizard run, so a stale result can be recognised. */
  attemptId?: string;
};

/** Terminal outcomes an attempt can reach — never an open-ended "loading". */
export type SqlAttemptStatus = "success" | "failed" | "cancelled" | "timed_out";

export type SqlAttemptStage =
  "port" | "instance_lookup" | "driver" | "tls" | "login" | "database" | "write";

export type SqlAdminFailure = {
  ok: false;
  error?: string;
  code?: string | null;
  originalMessage?: string | null;
  hint?: string | null;
  stage?: SqlAttemptStage;
  status?: SqlAttemptStatus;
  attemptId?: string | null;
  elapsedMs?: number;
  /** Every combination tried before giving up, newest last. */
  attempts?: SqlAttemptLog[];
};

/** One rejected combination from the connection ladder. */
export type SqlAttemptLog = { label: string; code?: string | null; error?: string };

/** The combination that finally completed the handshake. */
export type SqlResolvedTarget = {
  label: string;
  host: string;
  port: number | null;
  instanceName: string | null;
  usedPort: boolean;
  driver: string;
  auth: "windows" | "sql";
  encrypt: boolean;
  trustServerCertificate: boolean;
  browserAnswered: boolean;
};

export type SqlDatabase = { name: string; state: string };
export type SqlTable = { schema: string; name: string; type: "table" | "view" };
export type SqlColumn = {
  name: string;
  type: string;
  length: number | null;
  nullable: boolean;
  defaultValue: string | null;
};

export type SqlAdminConnectResult =
  | {
      ok: true;
      attemptId?: string | null;
      status?: "success";
      stage?: SqlAttemptStage;
      elapsedMs?: number;
      serverName: string | null;
      version: string | null;
      activeDb: string;
      usedTrustFallback: boolean;
      resolved?: SqlResolvedTarget;
      databases: SqlDatabase[];
    }
  | SqlAdminFailure;

export type SqlAdminStatus = {
  connected: boolean;
  /** True while a handshake is still walking the attempt ladder. */
  busy?: boolean;
  attemptId?: string | null;
  stage?: SqlAttemptStage | null;
  server: string | null;
  serverName: string | null;
  database: string | null;
  auth: "windows" | "sql" | null;
  usedTrustFallback: boolean;
};

export type SqlQueryResult =
  | {
      ok: true;
      columns: string[];
      rows: Record<string, unknown>[];
      rowCount: number;
      truncated: boolean;
      elapsedMs: number;
    }
  | (SqlAdminFailure & { elapsedMs?: number });

export type SqlPortProbe =
  | {
      ok: true;
      host: string;
      port: number | null;
      skipped?: boolean;
      hint?: string | null;
      instanceName?: string | null;
      browserAnswered?: boolean;
      elapsedMs: number;
    }
  | (SqlAdminFailure & {
      host?: string;
      port?: number;
      instanceName?: string | null;
      browserAnswered?: boolean;
      elapsedMs?: number;
    });

export type SqlLockResult =
  { ok: true; activeDb: string; usedTrustFallback: boolean } | SqlAdminFailure;

export type SqlAdminBridge = {
  connectInstance: (credentials: SqlAdminCredentials) => Promise<SqlAdminConnectResult>;
  /** Abort the running handshake and drop the half-open pool. */
  cancel?: (attemptId?: string) => Promise<{ ok: boolean; cancelled?: boolean }>;
  /** Raw 2-second TCP reachability probe — names firewall/port problems. */
  probePort?: (credentials: SqlAdminCredentials) => Promise<SqlPortProbe>;
  /** Re-point the administration pool at the operator's chosen database. */
  lockDatabase?: (credentials: SqlAdminCredentials) => Promise<SqlLockResult>;
  listDatabases: () => Promise<{ ok: true; databases: SqlDatabase[] } | SqlAdminFailure>;
  getTables: (
    dbName: string,
  ) => Promise<{ ok: true; tables: SqlTable[] } | (SqlAdminFailure & { tables: SqlTable[] })>;
  getTableColumns: (
    dbName: string,
    tableName: string,
    schemaName?: string,
  ) => Promise<{ ok: true; columns: SqlColumn[] } | (SqlAdminFailure & { columns: SqlColumn[] })>;
  executeQuery: (dbName: string, queryText: string) => Promise<SqlQueryResult>;
  /**
   * Elevated schema repair: signs in with an administrator login, replays the
   * guarded master-schema batches for the chosen tables, then disconnects.
   */
  repair?: (payload: {
    credentials: SqlAdminCredentials;
    database: string;
    tables: string[];
  }) => Promise<SqlAdminRepairResult>;
  disconnect: () => Promise<{ ok: boolean }>;
  status: () => Promise<SqlAdminStatus>;
  /**
   * Protected database calls use the verified staff account's
   * can_manage_sync_backup permission from the central database.
   */
  unlock?: (
    username: string,
    pin: string,
  ) => Promise<{
    ok: boolean;
    name?: string;
    level?: "admin" | "supervisor" | "staff";
    expiresAt?: number;
    error?: string;
  }>;
  /** Ask the desktop process to validate and adopt the current online session. */
  adoptSession?: (proof: {
    accessToken?: string;
    sessionToken?: string;
    cashierToken?: string;
    terminalToken?: string;
  }, terminalConfig?: import("@/core/activation/terminal-tokens").TerminalConfig | null) => Promise<{ ok: boolean; level?: "admin" | "supervisor" | "staff"; error?: string }>;
  lockAdmin?: () => Promise<{ ok: boolean }>;
  adminStatus?: () => Promise<{
    unlocked: boolean;
    name?: string;
    source?: "pos" | "manual";
    level?: "admin" | "supervisor" | "staff";
    expiresAt?: number;
  }>;
};

export type SqlAdminRepairResult =
  | {
      ok: true;
      stage: "repair";
      ran: number;
      total: number;
      repairedTables?: string[];
      unknownTables?: string[];
      results?: { ok: boolean; error?: string }[];
    }
  | (SqlAdminFailure & { stage?: "prepare" | "connect" | "repair"; ran?: number; total?: number });

declare global {
  interface Window {
    sqlAdmin?: SqlAdminBridge;
  }
}

export const sqlAdmin = (): SqlAdminBridge | null =>
  typeof window === "undefined" ? null : (window.sqlAdmin ?? null);

export const hasSqlAdmin = (): boolean => !!sqlAdmin();

export const DESKTOP_ONLY: SqlAdminFailure = {
  ok: false,
  error: "A local SQL Server can only be reached from the Windows desktop app.",
  code: "EWEB",
  hint: null,
};

/** Same read-only gate the main process enforces, so mistakes are caught early. */
const FORBIDDEN =
  /\b(insert|update|delete|merge|drop|create|alter|truncate|grant|revoke|deny|backup|restore|exec|execute|sp_\w*|xp_\w*|shutdown|reconfigure|openrowset|opendatasource|bulk|waitfor|into)\b/i;

export function checkReadOnly(text: string): string | null {
  // Strip literals and comments first, so a commented-out prefix cannot hide a
  // second statement from the structural checks.
  const stripped = text
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .trim()
    .replace(/;+\s*$/, "");
  if (!stripped) return "Enter a query to run.";
  if (stripped.includes(";")) return "Run one statement at a time — remove the extra ';'.";
  if (!/^(select|with)\b/i.test(stripped)) return "Only SELECT statements can be run here.";
  if (FORBIDDEN.test(stripped))
    return "This editor is read-only — statements that change data or schema are blocked.";
  return null;
}
