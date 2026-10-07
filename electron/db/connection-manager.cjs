const { performance } = require("node:perf_hooks");
const { safeError } = require("./errors.cjs");

function escapeOdbc(value) {
  return `{${String(value ?? "").replaceAll("}", "}}")}}`;
}

function connectionString(profile, database = profile.database || "master") {
  const directPort = Number.isInteger(profile.port) && profile.port > 0;
  const server = directPort
    ? `tcp:${profile.host},${profile.port}`
    : `tcp:${profile.host}\\${profile.instanceName}`;
  const parts = [
    "Driver={ODBC Driver 18 for SQL Server}",
    `Server=${server}`,
    `Database=${escapeOdbc(database)}`,
    `Encrypt=${profile.encrypt ? "Yes" : "No"}`,
    `TrustServerCertificate=${profile.trustServerCertificate ? "Yes" : "No"}`,
    `Connection Timeout=${Math.max(1, Math.ceil(profile.connectionTimeoutMs / 1000))}`,
  ];
  if (profile.authMode === "windows") parts.push("Trusted_Connection=Yes");
  else parts.push(`UID=${escapeOdbc(profile.username)}`, `PWD=${escapeOdbc(profile.password)}`);
  return `${parts.join(";")};`;
}

function defaultDriver() {
  return require("mssql/msnodesqlv8");
}

class ConnectionManager {
  constructor({ driver = null } = {}) {
    this.driver = driver;
    this.pool = null;
    this.profile = null;
  }
  sql() {
    return this.driver ?? defaultDriver();
  }
  async open(profile) {
    const sql = this.sql();
    const pool = new sql.ConnectionPool({
      connectionString: connectionString(profile),
      pool: { min: 0, max: 10, idleTimeoutMillis: 30_000 },
      requestTimeout: profile.requestTimeoutMs,
    });
    try {
      await pool.connect();
    } catch (error) {
      await pool.close().catch(() => undefined);
      throw error;
    }
    pool.on?.("error", () => { pool.__posConnectionFaulted = true; });
    const previous = this.pool;
    this.pool = pool;
    this.profile = { ...profile, password: undefined };
    // Swap only after the replacement is connected. Reads already in flight
    // may finish on the former pool while every new read sees the new owner.
    if (previous && previous !== pool) await previous.close().catch(() => undefined);
    return pool;
  }
  isConnected() {
    const pool = this.pool;
    if (!pool || pool.__posConnectionFaulted) return false;
    if (typeof pool.connected === "boolean") return pool.connected;
    if (typeof pool.healthy === "boolean") return pool.healthy;
    return true;
  }
  markFaulted() {
    if (this.pool) this.pool.__posConnectionFaulted = true;
  }
  async close() {
    const pool = this.pool;
    this.pool = null;
    this.profile = null;
    if (pool) await pool.close();
  }
  async temporary(profile, database, work) {
    const sql = this.sql();
    const pool = new sql.ConnectionPool({
      connectionString: connectionString(profile, database),
      pool: { min: 0, max: 1, idleTimeoutMillis: 1000 },
      requestTimeout: profile.requestTimeoutMs,
    });
    try {
      await pool.connect();
      return await work(pool);
    } finally {
      await pool.close().catch(() => undefined);
    }
  }
  async testServer(profile) {
    const start = performance.now();
    try {
      return await this.temporary(profile, "master", async (pool) => {
        const result = await pool.request().query(`SELECT
          CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)) AS version,
          CAST(SERVERPROPERTY('Edition') AS nvarchar(128)) AS edition,
          ORIGINAL_LOGIN() AS login_name,
          HAS_PERMS_BY_NAME(NULL, NULL, 'VIEW ANY DATABASE') AS can_list_databases`);
        const row = result.recordset?.[0] ?? {};
        return {
          ok: true,
          version: row.version,
          edition: row.edition,
          loginName: row.login_name,
          canListDatabases: Boolean(row.can_list_databases),
          latencyMs: Math.round(performance.now() - start),
        };
      });
    } catch (error) {
      return { ...safeError(error), latencyMs: Math.round(performance.now() - start) };
    }
  }
}

module.exports = { ConnectionManager, connectionString, escapeOdbc };
