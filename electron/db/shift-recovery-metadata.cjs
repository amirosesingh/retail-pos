"use strict";
// Main-only optional metadata preparation. No business writes, generic SQL IPC,
// financial activation, queue acknowledgement or checkpoint authority.
const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { AsyncLocalStorage } = require("node:async_hooks");
const { databaseName } = require("./backup.cjs");

const FORMAT = "retail.shift-recovery-metadata.v1";
// These pins are part of the reviewed application, independent of the supplied
// manifest. Even rollout-OFF may execute only this exact read-only probe.
const PACKAGE_HASHES = Object.freeze({
  manifest:"92F1B5718284628C073869F0378792EE614D85B0F7AECC9F165E6E5F7F961364",
  installer:"EA7FE2C83130B7A7890B06F737EC6E8743302118E144C468C41084AFC5B9C760",
  probe:"FA83689F2800306DD28238B94E91AA7E27DC43C6691D62A5BECDE95BB177CDAE",
});
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9A-F]{64}$/;
const MESSAGE = "Recovery support could not be prepared safely. Existing local work has not been changed.";
const fail = (code) => { throw Object.assign(new Error(MESSAGE), { code }); };
const unavailable = code => Object.freeze({ available: false, state: "held", code, reason: MESSAGE });
const BUSY = () => ({ ok: false, ...unavailable("ERECOVERY_METADATA_BUSY"), error: "Database preparation is in progress. Retry after it finishes." });
const sha = value => createHash("sha256").update(value).digest("hex").toUpperCase();
function shouldRetryRecoveryMetadata({approvedArtifactHash,snapshot,paused}) {
  return approvedArtifactHash===PACKAGE_HASHES.installer && paused!==true && snapshot?.state==="enabled_bootstrapping" &&
    snapshot.recoveryMetadata?.available===false && snapshot.recoveryMetadata.code==="ERECOVERY_METADATA_BUSY";
}
const controls = new Set([
  "database:retry-startup", "database:set-enabled", "database:migrate", "database:migrate-saved",
  "database:provision-connect", "database:save-connect", "database:disconnect", "database:remove-configuration",
  "database:restore", "database:backup", "sync:reconcile", "terminal:write", "terminal:clear",
  "config:write", "config:set", "config:reset", "cloud:set", "cloud:remove",
  "settings:set", "backend:set", "db:set-branch", "pos:connect", "pos:configure-cloud", "pos:remove",
  "pos:forget", "pos:apply-schema", "pos:restore", "pos:set-sync-config", "pos:set-sync-enabled",
  "sqladmin:connect", "sqladmin:query", "sqladmin:repair", "sqladmin:disconnect",
  "pos:remove-connection", "pos:forget-connection", "pos:apply-schema-tables", "pos:restore-drill",
  "admin:adopt-session",
]);

function packageFiles(directory = path.join(__dirname, "../../database/sqlserver/recovery")) {
  const read = (name, limit) => {
    const file = path.join(directory, name), stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > limit) fail("ERECOVERY_METADATA_PACKAGE");
    const bytes = fs.readFileSync(file), text = bytes.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(bytes)) fail("ERECOVERY_METADATA_PACKAGE");
    return { bytes, text };
  };
  const manifestFile=read("shift-recovery-metadata.manifest.json", 65536);
  if(sha(manifestFile.bytes)!==PACKAGE_HASHES.manifest)fail("ERECOVERY_METADATA_PACKAGE");
  const manifest = JSON.parse(manifestFile.text);
  if (manifest.format !== FORMAT || manifest.coreSchemaVersion !== 24 || !Array.isArray(manifest.prefixes) || manifest.prefixes.length !== 4 ||
      !Array.isArray(manifest.modules) || manifest.modules.map(value => value.id).join(",") !== "028_retained_shift_evidence,029_legacy_shift_recovery,030_reviewed_shift_adoption") fail("ERECOVERY_METADATA_PACKAGE");
  for (const [kind, name, limit] of [["installer", "shift-recovery-metadata.sql", 2 * 1024 * 1024], ["probe", "shift-recovery-metadata-probe.sql", 1024 * 1024]]) {
    if (manifest[kind]?.file !== name || manifest[kind].sha256!==PACKAGE_HASHES[kind]) fail("ERECOVERY_METADATA_PACKAGE");
    const file = read(name, limit);
    if (sha(file.bytes) !== manifest[kind].sha256) fail("ERECOVERY_METADATA_PACKAGE");
    manifest[kind].text = file.text;
  }
  for (let i = 0; i < 4; i++) if (manifest.prefixes[i]?.prefix !== i || manifest.prefixes[i].state !== ["absent", "prefix", "prefix", "matching"][i] || !HASH.test(manifest.prefixes[i].schemaFingerprint)) fail("ERECOVERY_METADATA_PACKAGE");
  return manifest;
}

function probeRow(result, manifest, expectedName) {
  const rows = result?.recordset;
  if (!Array.isArray(rows) || rows.length !== 1) fail("ERECOVERY_METADATA_SCHEMA");
  const row = rows[0];
  if (row.contract !== FORMAT || !GUID.test(row.database_guid) || row.database_name !== expectedName ||
      row.transaction_count !== 0 || ![0,1].includes(row.transaction_state) || row.implicit_transactions !== 0) fail("ERECOVERY_METADATA_CONTEXT");
  if (row.core_state !== "supported" || !["absent", "prefix", "matching"].includes(row.metadata_state)) fail("ERECOVERY_METADATA_SCHEMA");
  const known = manifest.prefixes.find(value => value.prefix === row.prefix);
  if (!known || known.state !== row.metadata_state || known.schemaFingerprint !== row.schema_fingerprint) fail("ERECOVERY_METADATA_SCHEMA");
  return row;
}

// The directory must come from this SQL Server's own configuration. The path is
// never resolved on the client and no fallback/UNC/device/ADS path is accepted.
function serverBackupFile(value, databaseGuid) {
  if (!GUID.test(databaseGuid) || typeof value !== "string" || value.length > 2048 || /[\x00-\x1f<>"|?*]/.test(value) || /(?:^|[\\/])\.\.?([\\/]|$)/.test(value) || value.includes("://")) fail("ERECOVERY_METADATA_BACKUP_PATH");
  const windows = /^[A-Za-z]:[\\/]/.test(value), unix = /^\/(?!\/)/.test(value);
  if ((!windows && !unix) || (windows ? value.slice(2).includes(":") : value.includes(":")) || (unix && value.includes("\\"))) fail("ERECOVERY_METADATA_BACKUP_PATH");
  const name = `Retail_Recovery_${databaseGuid}_${randomUUID()}.bak`;
  return value.replace(/[\\/]+$/, "") + (windows ? "\\" : "/") + name;
}

async function pin(manager, pool, work) {
  const sql = manager.sql();
  const lease = await new Promise((resolve, reject) => pool.acquire(new sql.Request(pool), (error, connection, config) => error ? reject(error) : resolve({ connection, config })));
  let active = false, discard = false;
  const parent = { config: lease.config, connected: true,
    acquire(_request, callback) { if (active) return queueMicrotask(() => callback(Object.assign(Error(MESSAGE), { code: "EREQINPROG" }))); active = true; queueMicrotask(() => callback(null, lease.connection, lease.config)); },
    release(connection) { if (connection === lease.connection) active = false; },
  };
  const request = () => new sql.Request(parent);
  try { return await work(request); }
  finally {
    // A failed/cancelled SQL-owned script must not return a live transaction to
    // even this dedicated pool. We never touch an inherited caller transaction.
    try {
      const state = (await request().query("SELECT @@TRANCOUNT transaction_count;"))?.recordset?.[0];
      if (!state || state.transaction_count !== 0) discard = true;
    } catch { discard = true; }
    try { if (discard) { lease.connection.hasError = true; await new Promise(resolve => lease.connection.close(() => resolve())); } }
    finally { pool.release(lease.connection); }
  }
}

class ShiftRecoveryMetadataInstaller {
  constructor({ manager, loadPackage = packageFiles, approvedArtifactHash = null, verified = () => {} }) {
    if (!manager || typeof loadPackage !== "function" || typeof verified !== "function") fail("ERECOVERY_METADATA_CONTEXT");
    Object.assign(this, { manager, loadPackage, approvedArtifactHash, verified });
  }
  async prepare({ profile, expectedDatabaseGuid, expectedDatabaseName, assertCurrent, onProgress = () => {} }) {
    if (typeof assertCurrent !== "function" || !GUID.test(expectedDatabaseGuid) || typeof expectedDatabaseName!=="string" || !expectedDatabaseName || expectedDatabaseName.length>128 || !profile?.database || /^(?:master|model|msdb|tempdb)$/i.test(profile.database)) return unavailable("ERECOVERY_METADATA_CONTEXT");
    try {
      assertCurrent();
      const report=phase=>{assertCurrent();try{onProgress({phase});}catch{/* Progress never changes database work. */}assertCurrent();};
      report("metadata_packagecheck");
      const manifest = this.loadPackage();
      const result = await this.manager.temporary({ ...profile, requestTimeoutMs: 300000 }, profile.database, pool => pin(this.manager, pool, async request => {
        assertCurrent();
        // No FROM before this guard: implicit transactions cannot be allowed to
        // create an outer transaction during the otherwise read-only probe.
        const session = (await request().query("SELECT @@TRANCOUNT transaction_count,XACT_STATE() transaction_state,CONVERT(int,@@OPTIONS&2) implicit_transactions;"))?.recordset?.[0];
        assertCurrent();
        if (!session || session.transaction_count !== 0 || ![0,1].includes(session.transaction_state) || session.implicit_transactions !== 0) fail("ERECOVERY_METADATA_CONTEXT");
        const target=(await request().input("configuredDatabase",this.manager.sql().NVarChar(128),profile.database)
          .query("SELECT DB_ID(@configuredDatabase) configured_database_id,DB_ID() current_database_id,DB_NAME() database_name;"))?.recordset;
        assertCurrent();
        if(target?.length!==1 || !Number.isInteger(target[0].current_database_id) || target[0].current_database_id<5 || target[0].configured_database_id!==target[0].current_database_id || target[0].database_name!==expectedDatabaseName)fail("ERECOVERY_METADATA_CONTEXT");
        const canonicalName=target[0].database_name;
        const probe = async () => {
          assertCurrent(); const value = await request().query(manifest.probe.text); assertCurrent();
          const row=probeRow(value, manifest, canonicalName);
          if(row.database_guid!==expectedDatabaseGuid)fail("ERECOVERY_METADATA_CONTEXT");
          return row;
        };
        report("metadata_probe");
        const before = await probe();
        if (before.metadata_state === "matching") return { available: true, state: "matching", installed: false };
        // Preparation approval is not rollout approval. Main must explicitly
        // pin the reviewed artifact after a separate deployment decision.
        if (this.approvedArtifactHash !== manifest.installer.sha256) return unavailable("ERECOVERY_METADATA_APPROVAL_REQUIRED");
        const property = (await request().query("SELECT CONVERT(nvarchar(2048),SERVERPROPERTY('InstanceDefaultBackupPath')) backup_directory;"))?.recordset;
        assertCurrent();
        if (property?.length !== 1) fail("ERECOVERY_METADATA_BACKUP_PATH");
        const file = serverBackupFile(property[0].backup_directory, before.database_guid);
        const db = databaseName(canonicalName);
        const backupRequest=()=>request().input("backupFile",this.manager.sql().NVarChar(2200),file);
        report("metadata_backing_up");
        await backupRequest().query(`BACKUP DATABASE ${db} TO DISK=@backupFile WITH COPY_ONLY,CHECKSUM;`);
        assertCurrent();
        report("metadata_verifying_backup");
        await backupRequest().query("RESTORE VERIFYONLY FROM DISK=@backupFile WITH CHECKSUM;");
        assertCurrent();
        const headers = (await backupRequest().query("RESTORE HEADERONLY FROM DISK=@backupFile;"))?.recordset;
        if (headers?.length !== 1 || headers[0].DatabaseName !== before.database_name || String(headers[0].BindingID ?? "").toLowerCase() !== before.database_guid ||
            headers[0].BackupType !== 1 || headers[0].Position !== 1 || ![true,1].includes(headers[0].IsCopyOnly) || ![true,1].includes(headers[0].HasBackupChecksums) || ![false,0].includes(headers[0].IsDamaged)) fail("ERECOVERY_METADATA_BACKUP_VERIFY");
        assertCurrent();
        const backedUp = await probe();
        if (backedUp.database_guid !== before.database_guid || backedUp.schema_fingerprint !== before.schema_fingerprint) fail("ERECOVERY_METADATA_CONTEXT");
        const ddl = request().input("expectedDatabaseGuid", this.manager.sql().UniqueIdentifier, before.database_guid)
          .input("expectedSchemaFingerprint", this.manager.sql().VarChar(64), before.schema_fingerprint);
        assertCurrent();
        report("metadata_installing");
        await ddl.query(manifest.installer.text); // The artifact, not JS, owns BEGIN/COMMIT.
        assertCurrent();
        report("metadata_readback");
        const after = await probe();
        if (after.database_guid !== before.database_guid || after.metadata_state !== "matching") fail("ERECOVERY_METADATA_SCHEMA");
        return { available: true, state: "matching", installed: true, backupVerified: true };
      }));
      assertCurrent(); if (result.available) await this.verified(result); assertCurrent();
      return Object.freeze(result);
    } catch (error) {
      const code = /^ERECOVERY_METADATA_/.test(String(error?.code ?? "")) ? error.code : "ERECOVERY_METADATA_PREPARATION";
      return unavailable(code);
    }
  }
}

// Independent of the shutdown barrier: neither owner's finally can unseal the
// other. Accepted business calls finish BEFORE taking the coordinator lease.
class RecoveryMetadataGate {
  constructor() { this.active = new Set(); this.control = new Set(); this.context = new AsyncLocalStorage(); this.preparing = false; }
  run(work) {
    if (this.preparing) return Promise.resolve(BUSY());
    const operation = Promise.resolve().then(work); this.active.add(operation);
    operation.then(() => this.active.delete(operation), () => this.active.delete(operation)); return operation;
  }
  runControl(work) {
    if (this.preparing) return Promise.resolve(BUSY());
    const token = {}, operation = this.context.run(token, () => Promise.resolve().then(work)); this.control.add(token);
    operation.finally(() => this.control.delete(token)).catch(() => {}); return operation;
  }
  install(ipcMain) {
    const original = ipcMain.handle.bind(ipcMain);
    ipcMain.handle = (channel, listener) => original(channel, controls.has(channel)
      ? (event, ...args) => this.runControl(() => listener(event, ...args))
      : ["business:reserve-stock", "approval:authorize-offline-discount"].includes(channel)
        ? (event, ...args) => this.run(() => listener(event, ...args)) : listener);
  }
  async prepare({ coordinator, assertCurrent, isBusy, work, timeoutMs = 5000 }) {
    const current = this.context.getStore();
    if (this.preparing || [...this.control].some(value => value !== current) || isBusy()) return unavailable("ERECOVERY_METADATA_BUSY");
    this.preparing = true;
    const within = async promise => {
      let timer;
      try { return await Promise.race([promise.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); })]); }
      finally { clearTimeout(timer); }
    };
    let cancelled = false;
    try {
      if (!await within(Promise.allSettled([...this.active]))) return unavailable("ERECOVERY_METADATA_BUSY");
      assertCurrent(); if (isBusy()) return unavailable("ERECOVERY_METADATA_BUSY");
      let entered;
      const entry = new Promise(resolve => { entered = resolve; });
      const operation = coordinator.withExclusive(async () => {
        if (cancelled) return unavailable("ERECOVERY_METADATA_BUSY");
        entered(); assertCurrent(); if (isBusy()) return unavailable("ERECOVERY_METADATA_BUSY");
        return work();
      });
      operation.catch(() => entered());
      if (!await within(entry)) { cancelled = true; operation.catch(() => {}); return unavailable("ERECOVERY_METADATA_BUSY"); }
      return await operation;
    } finally { this.preparing = false; }
  }
}

module.exports = { ShiftRecoveryMetadataInstaller, RecoveryMetadataGate, packageFiles, serverBackupFile, shouldRetryRecoveryMetadata, PACKAGE_HASHES };
