import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createCurrentLocalAdmission } = require("../../../../electron/current-local-admission.cjs");
const { createTerminalOnlineRecovery } = require("../../../../electron/terminal-online-recovery.cjs");
const { createSecureConfig } = require("../../../../electron/db/secure-config.cjs");
const activationBoundary = require("../../../../electron/verified-activation.cjs");
const folders: string[] = [];
const profile = { host: "fixture-sql", instanceName: "", port: 1433, database: "POS_Local_Beta", authMode: "sql", username: "fixture-user", password: "fixture-current-password",
  encrypt: true, trustServerCertificate: false, connectionTimeoutMs: 5000, requestTimeoutMs: 10000, retentionDays: 90 };
const original = { tokenId: "10000000-0000-4000-8000-000000000001", deviceType: "pc", deviceUse: "operations", locationId: "branch-a" };
const replacement = { ...original, tokenId: "20000000-0000-4000-8000-000000000002", deviceBindingProof: "a".repeat(64),
  supabaseUrl: "https://fixture-project.invalid", backendUrl: "https://fixture-relay.invalid" };

function fixture() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "pos-current-local-")); folders.push(folder);
  const { password: _oldPassword, ...oldFields } = profile;
  const oldProfile = { ...oldFields, database: "retained-old" };
  let active: typeof replacement | null = null, previous: object = original, available = true;
  const values = new Map<string, unknown>([["localDatabaseProfile", oldProfile], ["localDatabaseEnabled", true], ["backendUrl", replacement.backendUrl]]);
  const configStore = { get: vi.fn((key: string) => values.get(key)), getStrict: vi.fn((key: string) => values.get(key) ?? null),
    set: vi.fn((key: string, value: unknown) => { values.set(key, value); return { ok: true }; }) };
  const vault = { isEncryptionAvailable: () => available,
    encryptString: (value: string) => Buffer.from("fixture-vault:" + Buffer.from(value).toString("base64")),
    decryptString: (bytes: Buffer) => { if (!bytes.toString().startsWith("fixture-vault:")) throw Error("private fixture detail"); return Buffer.from(bytes.toString().slice(14), "base64").toString(); } };
  const terminalStore = { read: () => active, lastBinding: () => previous, wasProvisioned: () => true };
  const recovery = createTerminalOnlineRecovery({ app: { getPath: () => folder }, safeStorage: vault, configStore, terminalStore, activationBoundary,
    cloudCredentials: { read: () => ({ url: replacement.supabaseUrl, key: "fixture-publishable" }) } });
  recovery.begin({ evidence: { sealed: "old-opaque-seal", plain: "old-opaque-plain", key: "old-key" } });
  values.set("localDatabaseEnabled", false); recovery.bindReplacement(replacement); active = replacement; previous = replacement;
  const oldSecret = path.join(folder, "local-db-config.bin"), hold = path.join(folder, "terminal-online-recovery.bin");
  fs.writeFileSync(oldSecret, vault.encryptString(JSON.stringify({ password: "fixture-old-password" })));
  const oldBytes = fs.readFileSync(oldSecret), holdBytes = fs.readFileSync(hold);
  const create = () => createCurrentLocalAdmission({ app: { getPath: () => folder }, safeStorage: vault, onlineRecovery: recovery, terminalStore, activationBoundary });
  const admission = create(), secure = createSecureConfig({ app: { getPath: () => folder }, safeStorage: vault, configStore, recoveryLocal: admission });
  const intact = () => {
    expect(fs.readFileSync(oldSecret)).toEqual(oldBytes); expect(fs.readFileSync(hold)).toEqual(holdBytes);
    expect(values.get("localDatabaseProfile")).toBe(oldProfile); expect(values.get("localDatabaseEnabled")).toBe(false);
    expect(configStore.set).not.toHaveBeenCalled();
  };
  return { folder, admission, secure, recovery, values, configStore, create, intact, oldSecret, hold, filename: path.join(folder, "terminal-current-local.bin"),
    active: (value: typeof replacement | null) => { active = value; }, available: (value: boolean) => { available = value; } };
}

function poolFixture(options: { guid?: string; control?: number; lock?: number; ledger?: number; unknownRows?: boolean; groupColumns?: string; onQuery?: (sql: string) => void } = {}) {
  const rows = new Map<string, unknown[]>([["dbo.sales", []], ["dbo.sync_change_journal", []], ["other.unknown_history", options.unknownRows ? [{ retained: true }] : []]]);
  const queries: string[] = [];
  let guid = options.guid ?? "30000000-0000-4000-8000-000000000003";
  const transaction = { begin: vi.fn(async () => {}), commit: vi.fn(async () => {}), rollback: vi.fn(async () => {}), request: () => {
    const request = { input: (_key: string, _value: unknown) => request, query: async (sql: string) => {
      queries.push(sql); options.onQuery?.(sql);
      if (sql.includes("current-local:identity")) return { recordset: [{ guid, name: profile.database, server: "fixture-sql", actual_id: 5, configured_id: 5, metadata_control: options.control ?? 1 }] };
      if (sql.includes("current-local:lock")) return { recordset: [{ result: options.lock ?? 0 }] };
      if (sql.includes("current-local:inventory")) return { recordset: [{ schema_name: "dbo", table_name: "pos_schema_migrations" },
        ...[...rows.keys()].map(name => { const [schema_name, table_name] = name.split("."); return { schema_name, table_name }; })] };
      if (sql.includes("current-local:ledger")) return { recordset: [{ total: options.ledger ?? 24, first_version: 1, last_version: 24 }] };
      if (sql.includes("current-local:default-group-columns")) {
        const columns = [["archived_at", "datetimeoffset", 10, 7, 1], ["code", "nvarchar", -1, 0, 0], ["created_at", "datetimeoffset", 10, 7, 0],
          ["id", "nvarchar", 900, 0, 0], ["is_active", "bit", 1, 0, 0], ["name", "nvarchar", -1, 0, 0], ["updated_at", "datetimeoffset", 10, 7, 0]]
          .map(([name, type_name, max_length, scale, nullable]) => ({ name, type_schema: "sys", type_name, max_length, scale, nullable, computed: 0, identity_column: 0 }));
        if (options.groupColumns === "extra") columns.push({ ...columns[0], name: "hidden_history" });
        if (options.groupColumns === "wrong type") columns[0].type_name = "nvarchar";
        return { recordset: columns };
      }
      if (sql.includes("current-local:default-group")) {
        expect(sql).toContain("COLLATE Latin1_General_100_BIN2"); expect(sql).toContain("DATALENGTH(name)=DATALENGTH(N'Default group')");
        const groups = rows.get("dbo.store_groups")!.slice(0, 2) as Record<string, unknown>[];
        return { recordset: [{ total: groups.length, matching_rows: groups.filter(group => group.id === "default" && group.code === "DEFAULT" &&
          group.name === "Default group" && group.is_active === 1 && group.archived_at === null && group.created_at != null && group.updated_at != null).length }] };
      }
      if (sql.includes("current-local:empty")) {
        expect(sql).toContain("WITH(TABLOCKX,HOLDLOCK)");
        const [, schema, table] = sql.match(/FROM \[([^\]]+)\]\.\[([^\]]+)\]/)!;
        return { recordset: rows.get(schema + "." + table) };
      }
      throw Error("Unexpected fixture query");
    } }; return request;
  } };
  return { pool: { transaction: () => transaction }, transaction, rows, queries, guid: (value: string) => { guid = value; } };
}
const ready = { schemaReady: true };
const defaultGroup = { id: "default", code: "DEFAULT", name: "Default group", is_active: 1, archived_at: null,
  created_at: "2026-11-14T09:00:00+08:00", updated_at: "2026-11-14T09:00:00+08:00" };
afterEach(() => {
  vi.restoreAllMocks();
  for (const folder of folders.splice(0)) {
    if (!path.resolve(folder).startsWith(path.resolve(os.tmpdir()) + path.sep + "pos-current-local-")) throw Error("Unsafe test cleanup");
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

describe("current local target under retained online recovery", () => {
  it("allows read-only fresh inspection without creating admission or touching retained setup", async () => {
    const f = fixture(), sql = poolFixture();
    expect(f.admission.canConfigure()).toBe(true); expect(f.admission.canUseCurrent()).toBe(false);
    expect(f.secure.profile()).toBeNull(); expect(f.secure.credentials()).toBeNull(); expect(f.secure.enabled()).toBe(false);
    expect(await f.admission.inspect(sql.pool, profile, ready)).toMatchObject({ ok: true, fresh: true });
    expect(f.admission.hasAdmission()).toBe(false); expect(sql.transaction.commit).toHaveBeenCalledOnce(); f.intact();
  });

  it.each(["sql", "windows"])("seals the new %s profile while old profile, password and quarantine remain byte-identical", async authMode => {
    const f = fixture(), sql = poolFixture(), next = authMode === "sql" ? profile : { ...profile, authMode, username: "", password: "" };
    await f.admission.admit(sql.pool, next, ready);
    expect(f.secure.save(next)).not.toHaveProperty("password");
    expect(f.secure.credentials()).toEqual(next); expect(f.secure.profile()).not.toHaveProperty("password");
    expect(f.secure.enabled()).toBe(true); expect(f.admission.pending()).toBe(true); expect(f.admission.canUseCurrent()).toBe(true);
    expect(fs.readFileSync(f.filename).toString()).not.toContain(profile.password);
    expect(f.recovery.status()).toEqual({ pending: true, replacementBound: true }); f.intact();
  });

  it("restores populated admitted storage by its pinned GUID after restart without requiring it to stay empty", async () => {
    const f = fixture(), sql = poolFixture(); await f.admission.admit(sql.pool, profile, ready);
    sql.rows.get("dbo.sales")!.push({ pendingSale: "retained" }); sql.queries.length = 0;
    const reopened = f.create();
    expect(await reopened.assertPool(sql.pool, reopened.credentials())).toMatchObject({ ok: true, fresh: false });
    expect(sql.queries.some(query => query.includes("current-local:empty"))).toBe(false); f.intact();
  });

  it("refuses GUID replacement without replacing the current sealed credentials or histories", async () => {
    const f = fixture(), sql = poolFixture(); await f.admission.admit(sql.pool, profile, ready); const before = fs.readFileSync(f.filename);
    sql.guid("40000000-0000-4000-8000-000000000004");
    await expect(f.admission.admit(sql.pool, { ...profile, password: "replacement-password" }, ready)).rejects.toMatchObject({ code: "ECURRENT_LOCAL_TARGET" });
    expect(fs.readFileSync(f.filename)).toEqual(before); expect(f.secure.credentials()).toEqual(profile); f.intact();
  });

  it("refuses a physical database swap between inspection and first admission", async () => {
    const f = fixture(), sql = poolFixture();
    const inspected = await f.admission.inspect(sql.pool, profile, ready);
    sql.guid("40000000-0000-4000-8000-000000000004");
    await expect(f.admission.admit(sql.pool, profile, { ...ready, expectedDatabase: inspected.database }))
      .rejects.toMatchObject({ code: "ECURRENT_LOCAL_TARGET" });
    expect(f.admission.hasAdmission()).toBe(false); f.intact();
  });

  it.each(["dbo.sales", "dbo.sync_change_journal", "other.unknown_history"])("refuses saved rows in %s including unknown/private tables", async table => {
    const f = fixture(), sql = poolFixture(); sql.rows.get(table)!.push({ saved: true });
    await expect(f.admission.admit(sql.pool, profile, ready)).rejects.toMatchObject({ code: "ECURRENT_LOCAL_FRESH" });
    expect(f.admission.hasAdmission()).toBe(false); expect(sql.transaction.rollback).toHaveBeenCalledOnce(); f.intact();
  });

  it.each([false, true])("allows the exact built-in group seed or an empty group table, seeded=%s", async seeded => {
    const f = fixture(), sql = poolFixture(); sql.rows.set("dbo.store_groups", seeded ? [{ ...defaultGroup }] : []);
    await expect(f.admission.admit(sql.pool, profile, ready)).resolves.toMatchObject({ ok: true, fresh: true }); f.intact();
  });

  it.each([{ id: "DEFAULT" }, { id: "default " }, { code: "default" }, { code: "DEFAULT " },
    { name: "Default group " }, { name: "Different group" }, { is_active: 0 }, { archived_at: "2026-11-14" }, { created_at: null }, { updated_at: null }])(
    "refuses a changed built-in seed %j", async changed => {
      const f = fixture(), sql = poolFixture(); sql.rows.set("dbo.store_groups", [{ ...defaultGroup, ...changed }]);
      await expect(f.admission.admit(sql.pool, profile, ready)).rejects.toMatchObject({ code: "ECURRENT_LOCAL_FRESH" });
      expect(f.admission.hasAdmission()).toBe(false); f.intact();
    });

  it("refuses a second group even alongside the exact built-in seed", async () => {
    const f = fixture(), sql = poolFixture(); sql.rows.set("dbo.store_groups", [{ ...defaultGroup }, { ...defaultGroup, id: "another" }]);
    await expect(f.admission.admit(sql.pool, profile, ready)).rejects.toMatchObject({ code: "ECURRENT_LOCAL_FRESH" }); f.intact();
  });

  it.each(["extra", "wrong type"])("refuses unreviewed group column shape: %s", async groupColumns => {
    const f = fixture(), sql = poolFixture({ groupColumns }); sql.rows.set("dbo.store_groups", [{ ...defaultGroup }]);
    await expect(f.admission.admit(sql.pool, profile, ready)).rejects.toMatchObject({ code: "ECURRENT_LOCAL_VERIFY" }); f.intact();
  });

  it.each([{ control: 0 }, { lock: -1 }])("refuses incomplete metadata visibility or target locking", async options => {
    const f = fixture(), sql = poolFixture(options);
    await expect(f.admission.admit(sql.pool, profile, ready)).rejects.toMatchObject({ code: "ECURRENT_LOCAL_VERIFY" });
    expect(f.admission.hasAdmission()).toBe(false); f.intact();
  });

  it("requires actual schema readiness and the complete reviewed migration ledger", async () => {
    const f = fixture(), sql = poolFixture({ ledger: 23 });
    await expect(f.admission.admit(sql.pool, profile, { schemaReady: false })).rejects.toMatchObject({ code: "ECURRENT_LOCAL_SCHEMA" });
    expect(sql.transaction.begin).not.toHaveBeenCalled();
    await expect(f.admission.admit(sql.pool, profile, ready)).rejects.toMatchObject({ code: "ECURRENT_LOCAL_SCHEMA" }); f.intact();
  });

  it("preserves disabled current identity/credentials and denies removal or further re-registration", async () => {
    const f = fixture(), sql = poolFixture(); await f.admission.admit(sql.pool, profile, ready);
    f.secure.setEnabled(false);
    expect(f.secure.enabled()).toBe(false); expect(f.admission.canUseCurrent()).toBe(true); expect(f.secure.credentials()).toEqual(profile);
    expect(() => f.secure.remove()).toThrow(expect.objectContaining({ code: "ECURRENT_LOCAL_RETAINED" }));
    expect(() => f.admission.assertNoCurrentAdmission()).toThrow(expect.objectContaining({ code: "ECURRENT_LOCAL_RETAINED" })); f.intact();
  });

  it("refuses stale active proofs and context changes rather than falling back to old credentials", async () => {
    const f = fixture(), sql = poolFixture(); await f.admission.admit(sql.pool, profile, ready);
    f.active({ ...replacement, deviceBindingProof: "b".repeat(64) });
    expect(f.admission.canConfigure()).toBe(false); expect(f.admission.canUseCurrent()).toBe(false);
    expect(() => f.secure.credentials()).toThrow(expect.objectContaining({ code: "ECURRENT_LOCAL_CONTEXT" })); f.intact();
  });

  it("retains the protected slot and refuses corrupt storage or a missing original quarantine", async () => {
    const f = fixture(), sql = poolFixture(); await f.admission.admit(sql.pool, profile, ready); fs.writeFileSync(f.filename, "unreadable-fixture");
    expect(f.admission.hasAdmission()).toBe(true); expect(f.admission.canConfigure()).toBe(false);
    expect(() => f.secure.credentials()).toThrow(expect.objectContaining({ code: "ECURRENT_LOCAL_STORE" }));
    fs.unlinkSync(f.hold);
    expect(f.admission.pending()).toBe(true); expect(f.admission.canUseCurrent()).toBe(false);
    expect(() => f.secure.credentials()).toThrow(expect.objectContaining({ code: "ECURRENT_LOCAL_CONTEXT" }));
  });

  it("does not permit generic profile saving without a prior verified admission", async () => {
    const f = fixture(); expect(() => f.secure.save(profile)).toThrow(expect.objectContaining({ code: "ECURRENT_LOCAL_TARGET" }));
    expect(f.admission.hasAdmission()).toBe(false); f.intact();
  });

  it("detects registration changing while a fresh database is inspected", async () => {
    const f = fixture(); let inventories = 0;
    const sql = poolFixture({ onQuery: query => { if (query.includes("current-local:inventory") && ++inventories === 2) f.active(null); } });
    await expect(f.admission.admit(sql.pool, profile, ready)).rejects.toMatchObject({ code: "ECURRENT_LOCAL_CONTEXT" });
    expect(f.admission.hasAdmission()).toBe(false); f.intact();
  });

  it("keeps prior secrets and removes only its temporary file if atomic admission saving fails", async () => {
    const f = fixture(), sql = poolFixture(); vi.spyOn(fs, "renameSync").mockImplementation(() => { throw Error("private fixture error"); });
    await expect(f.admission.admit(sql.pool, profile, ready)).rejects.toMatchObject({ code: "ECURRENT_LOCAL_STORE" });
    expect(fs.readdirSync(f.folder).filter(name => name.startsWith("terminal-current-local"))).toEqual([]); f.intact();
  });
});
