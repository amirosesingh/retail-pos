"use strict";

// Main-only current SQL slot. The previous profile/secret/quarantine are never
// rewritten here. A replacement registration is not proof of local recovery.
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const { databaseProfile } = require("./ipc-guard.cjs");
const FILE = "terminal-current-local.bin";
const LIMIT = 64 * 1024;
const GUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const messages = Object.freeze({
  ECURRENT_LOCAL_STORE: "The protected current local connection could not be read or saved. Previous local work has been kept.",
  ECURRENT_LOCAL_CONTEXT: "The active registration or online connection changed. Verify the current setup before connecting local SQL.",
  ECURRENT_LOCAL_SCHEMA: "Validate the current managed SQL schema before connecting this local database.",
  ECURRENT_LOCAL_FRESH: "This local database contains saved records. Choose a fresh managed database; retained work must be recovered separately.",
  ECURRENT_LOCAL_TARGET: "The current local database identity changed. Keep its saved setup and pending work for verified recovery.",
  ECURRENT_LOCAL_VERIFY: "The local database identity or complete contents could not be verified. No local setup was replaced.",
  ECURRENT_LOCAL_RETAINED: "The current local connection must be kept for its saved work. Disable local SQL instead of removing or replacing it.",
  ECURRENT_LOCAL_BUSY: "Another current local connection check is running. Retry when it finishes.",
});
const fail = code => { throw Object.assign(new Error(messages[code]), { code }); };
const plain = value => Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype);
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const stable = value => JSON.stringify(value, (_key, item) => plain(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const hash = value => createHash("sha256").update(stable(value)).digest("hex");
const origin = value => {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash ? url.href.replace(/\/+$/, "") : null; }
  catch { return null; }
};
const quote = name => "[" + name.replaceAll("]", "]]") + "]";
const profileOf = value => {
  try { const profile = databaseProfile(value, { requireDatabase: true }); return { ...profile, retentionDays: profile.retentionDays ?? 90 }; }
  catch { fail("ECURRENT_LOCAL_STORE"); }
};
const redact = profile => { const { password: _password, ...publicProfile } = profile; return publicProfile; };
const validDatabase = value => exact(value, ["guid", "name", "server"]) && typeof value.guid === "string" && GUID.test(value.guid) &&
  typeof value.name === "string" && value.name.length > 0 && value.name.length <= 128 &&
  typeof value.server === "string" && value.server.length > 0 && value.server.length <= 512;
const DEFAULT_GROUP_COLUMNS = [
  ["archived_at", "datetimeoffset", 10, 7, 1], ["code", "nvarchar", -1, 0, 0],
  ["created_at", "datetimeoffset", 10, 7, 0], ["id", "nvarchar", 900, 0, 0],
  ["is_active", "bit", 1, 0, 0], ["name", "nvarchar", -1, 0, 0], ["updated_at", "datetimeoffset", 10, 7, 0],
].map(([name, type_name, max_length, scale, nullable]) => ({ name, type_schema: "sys", type_name, max_length, scale, nullable, computed: 0, identity_column: 0 }));

function createCurrentLocalAdmission({ app, safeStorage, onlineRecovery, terminalStore, activationBoundary }) {
  const filename = () => path.join(app.getPath("userData"), FILE);
  let admitting = false;
  const hasAdmission = () => {
    try { fs.statSync(filename()); return true; }
    catch (error) { return error?.code !== "ENOENT"; }
  };
  const pending = () => onlineRecovery.pending() || hasAdmission();
  function authority() {
    try {
      const retained = onlineRecovery.read(), active = terminalStore.read({ strict: true });
      if (!retained?.replacement || !active) fail("ECURRENT_LOCAL_CONTEXT");
      onlineRecovery.assertReplacement(active);
      const binding = activationBoundary.binding(active), proof = active.deviceBindingProof?.toLowerCase();
      const project = origin(retained.online?.cloud?.url), backend = origin(retained.online?.backend);
      if (!activationBoundary.sameBinding(binding, retained.replacement.binding) || !/^[a-f0-9]{64}$/.test(proof ?? "") ||
          proof !== retained.replacement.proof || !project || !backend) fail("ECURRENT_LOCAL_CONTEXT");
      return { binding, proof, project, backend,
        retainedKey: hash({ createdAt: retained.createdAt, previous: retained.previous.binding, source: retained.source.profile }) };
    } catch { fail("ECURRENT_LOCAL_CONTEXT"); }
  }
  function validateRecord(record) {
    if (!exact(record, ["version", "createdAt", "authority", "database", "profile", "enabled"]) || record.version !== 1 ||
        typeof record.createdAt !== "string" || !Number.isFinite(Date.parse(record.createdAt)) || typeof record.enabled !== "boolean" ||
        !validDatabase(record.database) || !exact(record.authority, ["binding", "proof", "project", "backend", "retainedKey"]) ||
        !exact(record.authority.binding, ["id", "platform", "mode", "branchId"]) ||
        typeof record.authority.proof !== "string" || !/^[a-f0-9]{64}$/.test(record.authority.proof) ||
        typeof record.authority.retainedKey !== "string" || !/^[a-f0-9]{64}$/.test(record.authority.retainedKey) ||
        !origin(record.authority.project) || !origin(record.authority.backend) ||
        stable(profileOf(record.profile)) !== stable(record.profile)) fail("ECURRENT_LOCAL_STORE");
    return record;
  }
  function read() {
    let bytes;
    try { bytes = fs.readFileSync(filename()); }
    catch (error) { if (error?.code === "ENOENT") return null; fail("ECURRENT_LOCAL_STORE"); }
    try {
      if (!safeStorage.isEncryptionAvailable() || !bytes.length || bytes.length > LIMIT) fail("ECURRENT_LOCAL_STORE");
      const text = safeStorage.decryptString(bytes);
      if (typeof text !== "string" || Buffer.byteLength(text) > LIMIT) fail("ECURRENT_LOCAL_STORE");
      return validateRecord(JSON.parse(text));
    } catch { fail("ECURRENT_LOCAL_STORE"); }
  }
  function currentRecord() {
    const current = authority(), record = read();
    if (record && stable(record.authority) !== stable(current)) fail("ECURRENT_LOCAL_CONTEXT");
    return record;
  }
  function write(record) {
    const temporary = filename() + ".tmp-" + randomUUID(); let fd;
    try {
      validateRecord(record);
      if (stable(record.authority) !== stable(authority()) || !safeStorage.isEncryptionAvailable()) fail("ECURRENT_LOCAL_CONTEXT");
      const bytes = safeStorage.encryptString(JSON.stringify(record));
      if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > LIMIT) fail("ECURRENT_LOCAL_STORE");
      fd = fs.openSync(temporary, "wx", 0o600); fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      fs.renameSync(temporary, filename());
      if (stable(read()) !== stable(record)) fail("ECURRENT_LOCAL_STORE");
    } catch (error) { if (Object.hasOwn(messages, error?.code)) throw error; fail("ECURRENT_LOCAL_STORE"); }
    finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* Preserve the primary failure. */ }
      try { fs.unlinkSync(temporary); } catch { /* Never delete a durable admission. */ } }
  }
  async function identity(request, profile) {
    const rows = (await request.input("configuredDatabase", profile.database).query(`-- current-local:identity
      SELECT LOWER(CONVERT(varchar(36),database_guid)) guid,DB_NAME() name,
        LOWER(CONVERT(nvarchar(512),SERVERPROPERTY('ServerName'))) server,
        DB_ID() actual_id,DB_ID(@configuredDatabase) configured_id,
        HAS_PERMS_BY_NAME(DB_NAME(),N'DATABASE',N'CONTROL') metadata_control
      FROM sys.database_recovery_status WHERE database_id=DB_ID();`)).recordset;
    const row = rows?.[0];
    if (rows?.length !== 1 || !validDatabase({ guid: row.guid, name: row.name, server: row.server }) ||
        !Number.isInteger(row.actual_id) || row.actual_id < 5 || row.actual_id !== row.configured_id || row.metadata_control !== 1)
      fail("ECURRENT_LOCAL_VERIFY");
    return { guid: row.guid, name: row.name, server: row.server };
  }
  async function proveFresh(transaction) {
    const inventory = async () => {
      const rows = (await transaction.request().query(`-- current-local:inventory
        SELECT s.name schema_name,t.name table_name FROM sys.tables t JOIN sys.schemas s ON s.schema_id=t.schema_id
        WHERE t.is_ms_shipped=0 ORDER BY s.name COLLATE Latin1_General_100_BIN2,t.name COLLATE Latin1_General_100_BIN2;`)).recordset;
      if (!Array.isArray(rows) || !rows.length || rows.length > 1024 || !rows.some(row => row.schema_name === "dbo" && row.table_name === "pos_schema_migrations") ||
          rows.some(row => typeof row.schema_name !== "string" || !row.schema_name || row.schema_name.length > 128 || typeof row.table_name !== "string" || !row.table_name || row.table_name.length > 128)) fail("ECURRENT_LOCAL_VERIFY");
      return rows;
    };
    const before = await inventory();
    for (const table of before) {
      const target = quote(table.schema_name) + "." + quote(table.table_name);
      if (table.schema_name === "dbo" && table.table_name === "pos_schema_migrations") {
        const rows = (await transaction.request().query(`-- current-local:ledger
          SELECT COUNT(*) total,MIN(version) first_version,MAX(version) last_version FROM ${target} WITH(TABLOCKX,HOLDLOCK);`)).recordset;
        if (rows?.length !== 1 || rows[0].total !== 24 || rows[0].first_version !== 1 || rows[0].last_version !== 24) fail("ECURRENT_LOCAL_SCHEMA");
      } else if (table.schema_name === "dbo" && table.table_name === "store_groups") {
        // The reviewed installer seeds this one parent. It is schema setup,
        // not evidence that any real branch/catalogue/history can be adopted.
        // Lock first, then inspect columns so DDL cannot add hidden payload.
        const seed = (await transaction.request().query(`-- current-local:default-group
          SELECT COUNT(*) total,COALESCE(SUM(CASE WHEN
            id COLLATE Latin1_General_100_BIN2=N'default' AND DATALENGTH(id)=DATALENGTH(N'default')
            AND code COLLATE Latin1_General_100_BIN2=N'DEFAULT' AND DATALENGTH(code)=DATALENGTH(N'DEFAULT')
            AND name COLLATE Latin1_General_100_BIN2=N'Default group' AND DATALENGTH(name)=DATALENGTH(N'Default group')
            AND is_active=1 AND archived_at IS NULL AND created_at IS NOT NULL AND updated_at IS NOT NULL
            THEN 1 ELSE 0 END),0) matching_rows
          FROM(SELECT TOP(2) id,code,name,is_active,archived_at,created_at,updated_at FROM ${target} WITH(TABLOCKX,HOLDLOCK)) seed;`)).recordset;
        if (seed?.length !== 1 || ![0, 1].includes(seed[0].total) || seed[0].matching_rows !== seed[0].total) fail("ECURRENT_LOCAL_FRESH");
        const columns = (await transaction.request().query(`-- current-local:default-group-columns
          SELECT c.name,SCHEMA_NAME(ty.schema_id) type_schema,ty.name type_name,c.max_length,c.scale,
            CONVERT(int,c.is_nullable) nullable,CONVERT(int,c.is_computed) computed,CONVERT(int,c.is_identity) identity_column
          FROM sys.columns c JOIN sys.types ty ON ty.user_type_id=c.user_type_id
          WHERE c.object_id=OBJECT_ID(N'dbo.store_groups',N'U') ORDER BY c.name COLLATE Latin1_General_100_BIN2;`)).recordset;
        if (stable(columns) !== stable(DEFAULT_GROUP_COLUMNS)) fail("ECURRENT_LOCAL_VERIFY");
      } else {
        const rows = (await transaction.request().query(`-- current-local:empty
          SELECT TOP (1) 1 retained_row FROM ${target} WITH(TABLOCKX,HOLDLOCK);`)).recordset;
        if (!Array.isArray(rows)) fail("ECURRENT_LOCAL_VERIFY");
        if (rows.length) fail("ECURRENT_LOCAL_FRESH");
      }
    }
    if (stable(before) !== stable(await inventory())) fail("ECURRENT_LOCAL_VERIFY");
  }
  async function check(pool, value, { schemaReady = false, assertCurrent = () => {}, expectedDatabase } = {}, mode) {
    if (mode !== "assert" && schemaReady !== true) fail("ECURRENT_LOCAL_SCHEMA");
    if (expectedDatabase !== undefined && !validDatabase(expectedDatabase)) fail("ECURRENT_LOCAL_TARGET");
    const expectedIdentity = expectedDatabase === undefined ? null : stable(expectedDatabase);
    const profile = profileOf(value), context = authority();
    assertCurrent(); const transaction = pool.transaction(); let begun = false;
    try {
      await transaction.begin(); begun = true;
      const lock = (await transaction.request().query(`-- current-local:lock
        DECLARE @lock int; EXEC @lock=sys.sp_getapplock @Resource=N'RetailPOS.CurrentLocalAdmission.v1',@LockOwner=N'Transaction',@LockMode=N'Exclusive',@LockTimeout=5000;
        SELECT @lock result;`)).recordset;
      if (lock?.length !== 1 || !Number.isInteger(lock[0].result) || lock[0].result < 0) fail("ECURRENT_LOCAL_VERIFY");
      assertCurrent(); const record = currentRecord(), database = await identity(transaction.request(), profile);
      if (expectedIdentity !== null && stable(database) !== expectedIdentity) fail("ECURRENT_LOCAL_TARGET");
      if (record && stable(record.database) !== stable(database)) fail("ECURRENT_LOCAL_TARGET");
      if (mode === "assert" && (!record || stable(record.profile) !== stable(profile))) fail("ECURRENT_LOCAL_TARGET");
      if (!record) await proveFresh(transaction);
      assertCurrent();
      if (stable(context) !== stable(authority()) || stable(database) !== stable(await identity(transaction.request(), profile))) fail("ECURRENT_LOCAL_CONTEXT");
      if (mode === "admit") write({ version: 1, createdAt: record?.createdAt ?? new Date().toISOString(), authority: context,
        database, profile, enabled: true });
      await transaction.commit(); begun = false; assertCurrent();
      return { ok: true, fresh: !record, database, ...(mode === "admit" ? { profile: redact(profile) } : {}) };
    } catch (error) {
      if (begun) await transaction.rollback().catch(() => {});
      if (Object.hasOwn(messages, error?.code)) throw error;
      fail("ECURRENT_LOCAL_VERIFY");
    }
  }
  return {
    pending, hasAdmission,
    canConfigure: () => { try { currentRecord(); return true; } catch { return false; } },
    canUseCurrent: () => { try { return Boolean(currentRecord()); } catch { return false; } },
    assertNoCurrentAdmission: () => { if (hasAdmission()) fail("ECURRENT_LOCAL_RETAINED"); },
    profile: () => { const record = currentRecord(); return record ? redact(record.profile) : null; },
    credentials: () => { const record = currentRecord(); return record ? { ...record.profile } : null; },
    enabled: () => currentRecord()?.enabled === true,
    setEnabled: value => { const record = currentRecord(); if (!record) { if (value === true) fail("ECURRENT_LOCAL_TARGET"); return { ok: true }; }
      write({ ...record, enabled: value === true }); return { ok: true }; },
    save: value => { const record = currentRecord(); if (!record || stable(record.profile) !== stable(profileOf(value))) fail("ECURRENT_LOCAL_TARGET"); return redact(record.profile); },
    remove: () => { if (hasAdmission()) fail("ECURRENT_LOCAL_RETAINED"); return { ok: true }; },
    inspect: (pool, profile, options) => check(pool, profile, options, "inspect"),
    admit: async (pool, profile, options) => {
      if (admitting) fail("ECURRENT_LOCAL_BUSY"); admitting = true;
      try { return await check(pool, profile, options, "admit"); } finally { admitting = false; }
    },
    assertPool: (pool, profile, options) => check(pool, profile, options, "assert"),
  };
}
module.exports = { createCurrentLocalAdmission };
