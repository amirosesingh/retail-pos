import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const { ShiftRecoveryMetadataInstaller, RecoveryMetadataGate, packageFiles, serverBackupFile } = require("../../../electron/db/shift-recovery-metadata.cjs");
const { ConnectionManager } = require("../../../electron/db/connection-manager.cjs");
const { DatabaseService } = require("../../../electron/db/service.cjs");
const guid = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const profile = { host: "isolated-fixture", instanceName: "fixture", database: "OwnedRecoveryFixture", authMode: "windows", connectionTimeoutMs: 5000, requestTimeoutMs: 1000 };
const manifest = packageFiles();

function fixture(prefix = 0, approved = true) {
  let current = true, state = prefix, transactions = 0, implicit = 0;
  const sessionOverrides:Record<string,unknown>={},target={configured_database_id:5,current_database_id:5,database_name:profile.database};
  const trace: Array<{ sql: string; inputs: Record<string, unknown> }> = [], pools: Array<{ closed: boolean; released: number; config: unknown }> = [];
  let intercept = async (_sql: string, _inputs: Record<string, unknown>): Promise<void> => {};
  const row = () => ({ contract: manifest.format, database_guid: guid, database_name: profile.database, core_state: "supported", metadata_state: manifest.prefixes[state].state,
    prefix: state, schema_fingerprint: manifest.prefixes[state].schemaFingerprint, reason: ["MISSING", "KNOWN_PREFIX", "KNOWN_PREFIX", "COMPLETE"][state],
    transaction_count: transactions, transaction_state: 0, implicit_transactions: implicit });
  let probe = row;
  const header = { DatabaseName: profile.database, BindingID: guid.toUpperCase(), BackupType: 1, Position: 1, IsCopyOnly: true, HasBackupChecksums: true, IsDamaged: false };
  class Pool {
    closed = false; released = 0; connection = { hasError: false, close: (done: () => void) => { done(); } };
    constructor(public config: unknown) { pools.push(this); }
    async connect() { return this; }
    async close() { this.closed = true; }
    acquire(_request: unknown, callback: (error: null, connection: unknown, config: unknown) => void) { callback(null, this.connection, this.config); }
    release() { this.released++; }
  }
  type Parent = { acquire: Pool["acquire"]; release: (connection: unknown) => void };
  class Request {
    inputs: Record<string, unknown> = {};
    constructor(private parent: Parent) {}
    input(key: string, typeOrValue: unknown, value?: unknown) { this.inputs[key] = arguments.length === 3 ? value : typeOrValue; return this; }
    async query(sql: string) {
      const connection = await new Promise(resolve => this.parent.acquire(this, (_error, value) => resolve(value)));
      try {
        trace.push({ sql, inputs: { ...this.inputs } }); await intercept(sql, this.inputs);
        if (sql === manifest.probe.text) return { recordset: [probe()] };
        if (sql === manifest.installer.text) { state = 3; return { recordset: [] }; }
        if (sql.startsWith("SELECT DB_ID(@configuredDatabase)")) return {recordset:[target]};
        if (sql.includes("InstanceDefaultBackupPath")) return { recordset: [{ backup_directory: "D:\\TrustedSQLBackup\\" }] };
        if (sql.startsWith("RESTORE HEADERONLY")) return { recordset: [header] };
        if (sql.startsWith("SELECT @@TRANCOUNT")) return { recordset: [{ transaction_count: transactions, transaction_state: 0, implicit_transactions: implicit,...sessionOverrides }] };
        return { recordset: [] };
      } finally { this.parent.release(connection); }
    }
  }
  const manager = new ConnectionManager({ driver: { ConnectionPool: Pool, Request, UniqueIdentifier: "uuid", VarChar: (n: number) => `varchar(${n})`,NVarChar:(n:number)=>`nvarchar(${n})` } });
  const verified = vi.fn(), assertCurrent = () => { if (!current) throw Object.assign(Error("Changed fixture source"), { code: "ERECOVERY_METADATA_CONTEXT" }); };
  const installer = new ShiftRecoveryMetadataInstaller({ manager, verified, approvedArtifactHash: approved ? manifest.installer.sha256 : null });
  return { installer, manager, trace, pools, header, verified, sessionOverrides,target,assertCurrent,run: () => installer.prepare({ profile,expectedDatabaseGuid:guid,expectedDatabaseName:profile.database,assertCurrent }),
    setCurrent: (value: boolean) => { current = value; }, setTransaction: (value: number) => { transactions = value; }, setImplicit: (value: number) => { implicit = value; },
    intercept: (value: typeof intercept) => { intercept = value; }, probe: (value: typeof row) => { probe = value; }, row };
}

describe("Main-only recovery metadata preparation", () => {
  it.each([0, 1, 2])("backs up a known whole-module prefix %s then executes the unchanged SQL-owned transaction once", async prefix => {
    const f = fixture(prefix); expect(await f.run()).toEqual({ available: true, state: "matching", installed: true, backupVerified: true });
    const statements = f.trace.map(entry => entry.sql);
    expect(statements.filter(sql => sql === manifest.installer.text)).toHaveLength(1);
    expect(statements.findIndex(sql => sql.startsWith("BACKUP DATABASE"))).toBeLessThan(statements.findIndex(sql => sql.startsWith("RESTORE VERIFYONLY")));
    expect(statements.findIndex(sql => sql.startsWith("RESTORE HEADERONLY"))).toBeLessThan(statements.indexOf(manifest.installer.text));
    expect(statements.filter(sql => sql !== manifest.installer.text).join("\n")).not.toMatch(/\b(?:BEGIN|COMMIT|ROLLBACK)\s+TRAN|\b(?:INIT|FORMAT)\b/);
    const ddl = f.trace.find(entry => entry.sql === manifest.installer.text)!;
    expect(ddl.inputs).toEqual({ expectedDatabaseGuid: guid, expectedSchemaFingerprint: manifest.prefixes[prefix].schemaFingerprint });
    const backup = f.trace.find(entry => entry.sql.startsWith("BACKUP DATABASE"))!;
    expect(backup.inputs.backupFile).toMatch(/^D:\\TrustedSQLBackup\\Retail_Recovery_.*\.bak$/);
    expect(f.verified).toHaveBeenCalledTimes(1); expect(f.pools).toHaveLength(1);
    expect(f.pools[0]).toMatchObject({ closed: true, released: 1, config: { pool: { max: 1 }, requestTimeout: 300000 } });
  });
  it("leaves an exact already-installed schema usable without backup or rollout activation", async () => {
    const f = fixture(3, false); expect(await f.run()).toEqual({ available: true, state: "matching", installed: false });
    expect(f.trace.some(entry => /BACKUP DATABASE|RESTORE/.test(entry.sql) || entry.sql === manifest.installer.text)).toBe(false);
    expect(f.verified).toHaveBeenCalledTimes(1);
  });
  it("requires the primary pool GUID even on a matching temporary schema",async()=>{
    const f=fixture(3);
    expect(await f.installer.prepare({profile,expectedDatabaseGuid:"bbbbbbbb-bbbb-4bbb-8bbb-000000000001",expectedDatabaseName:profile.database,assertCurrent:f.assertCurrent})).toMatchObject({available:false,code:"ERECOVERY_METADATA_CONTEXT"});
    expect(f.verified).not.toHaveBeenCalled();expect(f.trace.some(entry=>/BACKUP DATABASE/.test(entry.sql)||entry.sql===manifest.installer.text)).toBe(false);
  });
  it("reports only fixed actual phases before their waits, without paths or falsely completing data recovery",async()=>{
    const f=fixture(),progress:unknown[]=[];
    expect(await f.installer.prepare({profile,expectedDatabaseGuid:guid,expectedDatabaseName:profile.database,assertCurrent:f.assertCurrent,onProgress:(value:unknown)=>progress.push(value)})).toMatchObject({available:true});
    expect(progress).toEqual(["metadata_packagecheck","metadata_probe","metadata_backing_up","metadata_verifying_backup","metadata_installing","metadata_readback"].map(phase=>({phase})));
    expect(JSON.stringify(progress)).not.toContain(".bak");
  });
  it("does not let a broken progress subscriber turn a safe database operation into a failure",async()=>{
    const f=fixture(3);expect(await f.installer.prepare({profile,expectedDatabaseGuid:guid,expectedDatabaseName:profile.database,assertCurrent:f.assertCurrent,onProgress:()=>{throw Error("Subscriber closed");}})).toMatchObject({available:true});
  });
  it("uses SQL-native identity for a valid configured-name case alias without changing the configuration",async()=>{
    const f=fixture(3),alias={...profile,database:profile.database.toLowerCase()};
    expect(await f.installer.prepare({profile:alias,expectedDatabaseGuid:guid,expectedDatabaseName:profile.database,assertCurrent:f.assertCurrent})).toMatchObject({available:true});
    expect(alias.database).toBe(profile.database.toLowerCase());
    const foreign=fixture();foreign.target.configured_database_id=9;
    expect(await foreign.run()).toMatchObject({available:false,code:"ERECOVERY_METADATA_CONTEXT"});
    expect(foreign.trace.some(entry=>entry.sql===manifest.probe.text)).toBe(false);
  });
  it("accepts actual provider autocommit XACT_STATE1 only with no ambient/implicit transaction",async()=>{
    const f=fixture(3);f.sessionOverrides.transaction_state=1;
    f.probe(()=>({...f.row(),transaction_state:1}));
    expect(await f.run()).toMatchObject({available:true});
  });
  it.each([null,"0",false,-1])("rejects unknown/non-native transaction count %j",async value=>{
    const f=fixture();f.sessionOverrides.transaction_count=value;
    expect(await f.run()).toMatchObject({available:false,code:"ERECOVERY_METADATA_CONTEXT"});
    expect(f.trace.some(entry=>entry.sql===manifest.probe.text)).toBe(false);
  });
  it.each([null,"1",false,-1])("rejects unknown/non-native transaction state %j",async value=>{
    const f=fixture();f.sessionOverrides.transaction_state=value;
    expect(await f.run()).toMatchObject({available:false,code:"ERECOVERY_METADATA_CONTEXT"});
  });
  it("rejects an unknown IsDamaged flag rather than treating null as a good backup",async()=>{
    const f=fixture();Object.assign(f.header,{IsDamaged:null});
    expect(await f.run()).toMatchObject({available:false,code:"ERECOVERY_METADATA_BACKUP_VERIFY"});
    expect(f.trace.some(entry=>entry.sql===manifest.installer.text)).toBe(false);
  });
  it("keeps normal rollout OFF even with an approved-looking environment/settings value", async () => {
    const f = fixture(0, false); expect(await f.run()).toMatchObject({ available: false, code: "ERECOVERY_METADATA_APPROVAL_REQUIRED" });
    expect(f.trace.some(entry => /BACKUP DATABASE|RESTORE/.test(entry.sql) || entry.sql === manifest.installer.text)).toBe(false); expect(f.verified).not.toHaveBeenCalled();
    const wrong = fixture(); wrong.installer.approvedArtifactHash = "A".repeat(64);
    expect(await wrong.run()).toMatchObject({ available: false, code: "ERECOVERY_METADATA_APPROVAL_REQUIRED" });
  });
  it.each(["core", "partial", "fingerprint", "guid", "database"])("refuses %s mismatch before backup/DDL", async mismatch => {
    const f = fixture(); f.probe(() => ({ ...f.row(), ...(mismatch === "core" ? { core_state: "unknown" } : mismatch === "partial" ? { metadata_state: "unknown" } : mismatch === "fingerprint" ? { schema_fingerprint: "F".repeat(64) } : mismatch === "guid" ? { database_guid: "not-a-guid" } : { database_name: "Foreign" }) }));
    expect(await f.run()).toMatchObject({ available: false });
    expect(f.trace.some(entry => /BACKUP DATABASE|RESTORE/.test(entry.sql) || entry.sql === manifest.installer.text)).toBe(false);
  });
  it.each(["backup", "verify", "header", "ddl"])("refuses %s failure without acknowledgement or false capability", async stage => {
    const f = fixture(); f.intercept(async sql => {
      if (stage === "backup" && sql.startsWith("BACKUP DATABASE") || stage === "verify" && sql.startsWith("RESTORE VERIFYONLY") || stage === "header" && sql.startsWith("RESTORE HEADERONLY") || stage === "ddl" && sql === manifest.installer.text) throw Error("Owned fixture refusal");
    });
    expect(await f.run()).toMatchObject({ available: false }); expect(f.verified).not.toHaveBeenCalled(); expect(f.pools[0].closed).toBe(true);
    if (stage !== "ddl") expect(f.trace.some(entry => entry.sql === manifest.installer.text)).toBe(false);
  });
  it.each(["BindingID", "DatabaseName", "BackupType", "Position", "IsCopyOnly", "HasBackupChecksums", "IsDamaged"])("requires verified header %s", async field => {
    const f = fixture(); Object.assign(f.header, { [field]: field === "BindingID" ? "foreign" : field === "DatabaseName" ? "Foreign" : field === "IsDamaged" ? true : 0 });
    expect(await f.run()).toMatchObject({ available: false, code: "ERECOVERY_METADATA_BACKUP_VERIFY" });
    expect(f.trace.some(entry => entry.sql === manifest.installer.text)).toBe(false);
  });
  it("holds changed sources after the awaited backup and preserves the original connection owner", async () => {
    const f = fixture(); f.intercept(async sql => { if (sql.startsWith("BACKUP DATABASE")) f.setCurrent(false); });
    expect(await f.run()).toMatchObject({ code: "ERECOVERY_METADATA_CONTEXT" }); expect(f.verified).not.toHaveBeenCalled();
    expect(f.trace.some(entry => entry.sql.startsWith("RESTORE") || entry.sql === manifest.installer.text)).toBe(false); expect(f.pools[0].closed).toBe(true);
  });
  it("rejects replacement GUID or schema after backup before SQL installation", async () => {
    const f = fixture(); let probes = 0; f.probe(() => ({ ...f.row(), ...(probes++ === 0 ? {} : { database_guid: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001" }) }));
    expect(await f.run()).toMatchObject({ code: "ERECOVERY_METADATA_CONTEXT" }); expect(f.trace.some(entry => entry.sql === manifest.installer.text)).toBe(false);
  });
  it.each(["transaction", "implicit"])("rejects inherited %s before any table/backup read", async kind => {
    const f = fixture(); if (kind === "transaction") f.setTransaction(1); else f.setImplicit(2);
    expect(await f.run()).toMatchObject({ code: "ERECOVERY_METADATA_CONTEXT" });
    expect(f.trace.every(entry => entry.sql.startsWith("SELECT @@TRANCOUNT"))).toBe(true); expect(f.pools[0].closed).toBe(true);
  });
  it("recovers crash-after-commit by verifying the exact installed schema without repeating DDL", async () => {
    const f = fixture(); let lost = true;
    f.intercept(async sql => { if (lost && sql === manifest.probe.text && f.trace.some(entry => entry.sql === manifest.installer.text)) { lost = false; throw Error("lost readback"); } });
    expect(await f.run()).toMatchObject({ available: false });
    expect(await f.run()).toEqual({ available: true, state: "matching", installed: false });
    expect(f.trace.filter(entry => entry.sql === manifest.installer.text)).toHaveLength(1);
  });
  it.each([null, "", "relative", "\\\\server\\share", "\\\\?\\C:\\backup", "C:\\backup\\..\\other", "C:\\backup:stream", "file://C:/backup", "https://backup.test", "C:\\backup\n", "/var/../tmp", "//server/share"])("refuses untrusted SQL backup directory %j", value => {
    expect(() => serverBackupFile(value, guid)).toThrow();
  });
  it("uses the trusted SQL directory without client path resolution or overwriting", () => {
    expect(serverBackupFile("/var/opt/mssql/backup/", guid)).toMatch(/^\/var\/opt\/mssql\/backup\/Retail_Recovery_.*\.bak$/);
    expect(serverBackupFile("D:\\Backup", guid)).not.toBe(serverBackupFile("D:\\Backup", guid));
  });
});

function serviceFixture(prepare: (value: Record<string, unknown>) => Promise<unknown>) {
  let saved = { ...profile }, connected = false;
  const config = { enabled: () => true, profile: () => saved, credentials: () => saved, save: (value: typeof saved) => { saved = value; return value; } };
  const manager = { pool: {} as object, profile: saved, open: vi.fn(async () => { connected = true; manager.pool = {}; }), close: vi.fn(async () => { connected = false; }), isConnected: () => connected };
  const publish = vi.fn(), validator = vi.fn(async () => ({ ok: true, ready: true }));
  const service = new DatabaseService({ secureConfig: config, manager, validator, prepareRecoveryMetadata: prepare, publish });
  return { service, manager, publish, changeProfile: () => { saved = { ...saved, database: "Foreign" }; } };
}
describe("actual DatabaseService optional startup hook", () => {
  it("uses the exactly validated saved profile with an enabled hook and still verifies current credentials",async()=>{
    const prepare=vi.fn(async(input:Record<string,unknown>)=>{(input.assertCurrent as()=>void)();return{available:false,state:"held",code:"ERECOVERY_METADATA_APPROVAL_REQUIRED"};});
    const f=serviceFixture(prepare);await f.service.validate(profile);
    expect(await f.service.saveAndConnect(profile)).toMatchObject({ok:true,state:{tradingReady:true,recoveryMetadata:{available:false}}});
    expect(prepare).toHaveBeenCalledTimes(1);expect(prepare.mock.calls[0][0].profile).toBe(profile);expect(f.manager.close).not.toHaveBeenCalled();
  });
  it("refuses stale enabled-hook save completion if the saved credentials/profile changes during preparation",async()=>{
    const f=serviceFixture(async()=>{f.changeProfile();return{available:true};});await f.service.validate(profile);
    expect(await f.service.saveAndConnect(profile)).toMatchObject({ok:false,code:"ERECOVERY_METADATA_CONTEXT"});
    expect(f.service.snapshot().tradingReady).toBe(false);expect(f.manager.close).not.toHaveBeenCalled();
  });
  it("waits for preparation before schema-ready publication and preserves existing bootstrap admission", async () => {
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const f = serviceFixture(async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); return { available: true, installed: true }; });
    const run = f.service.restore(); await started;
    expect(f.service.snapshot().tradingReady).toBe(false); release();
    expect(await run).toMatchObject({ state: "enabled_bootstrapping", tradingReady: true, recoveryMetadata: { available: true, installed: true } });
    expect(f.manager.close).not.toHaveBeenCalled();
  });
  it.each(["ERECOVERY_METADATA_BACKUP_VERIFY", "ERECOVERY_METADATA_APPROVAL_REQUIRED", "ERECOVERY_METADATA_SCHEMA"])("retains qualified core behavior on optional %s refusal without claiming recovered data", async code => {
    const f = serviceFixture(async () => ({ available: false, state: "held", code }));
    expect(await f.service.restore()).toMatchObject({ state: "enabled_bootstrapping", tradingReady: true, recoveryMetadata: { available: false, code } });
    expect(f.manager.close).not.toHaveBeenCalled();
    // Only the existing lifecycle/cache proof, not metadata, may make data ready.
    expect(f.publish.mock.calls.every(([state]) => state.state !== "enabled_ready")).toBe(true);
  });
  it("does not publish stale readiness or close a newly selected pool after a profile change", async () => {
    const f = serviceFixture(async () => { f.changeProfile(); f.manager.pool = {}; return { available: true }; });
    expect(await f.service.restore()).toMatchObject({ tradingReady: false, recoveryMetadata: null }); expect(f.manager.close).not.toHaveBeenCalled();
  });
  it("keeps the existing no-hook DatabaseService path compatible", async () => {
    const f = serviceFixture(async () => ({})); f.service.prepareRecoveryMetadata = null;
    expect(await f.service.restore()).toMatchObject({ state: "enabled_bootstrapping", tradingReady: true, recoveryMetadata: null });
  });
  it("does not let metadata preparation resume a paused coordinator", async () => {
    const gate = new RecoveryMetadataGate(), coordinator = { paused: true, withExclusive: async (work: () => Promise<unknown>) => work() };
    expect(await gate.prepare({ coordinator, assertCurrent: () => {}, isBusy: () => false, work: async () => ({ available: true }) })).toEqual({ available: true });
    expect(coordinator.paused).toBe(true);
  });
});
