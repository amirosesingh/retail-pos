import { createRequire } from "node:module";
import bcrypt from "bcryptjs";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createOfflineStaffRefresh, matchesHostedStaffSession } = require("../../../electron/sync/offline-staff-refresh.cjs");
const { loadRegistry } = require("../../../electron/db/schema-registry.cjs");
const registry = loadRegistry();
const id = "7022f977-83e5-478e-bf78-3a3e3505516b";
const branchId = "8e617c44-0273-43b4-bad5-3a29b2f3feb8";
const foreignBranch = "77a1195c-6500-4e18-a85a-6f4720009b1e";
const databaseGuid = "eae65893-c32f-4f75-a85d-aa5fc84dbc71";
const username = "test-staff";
const permissions = { can_process_sale: true };
const pin = "test-only-current-pin";
const currentHash = bcrypt.hashSync(pin, 4);
const previousHash = bcrypt.hashSync("test-only-previous-pin", 4);
const hostedProof = { sessionToken: "test-hosted-session", cashierToken: "test-hosted-cashier" };
const authoritativeAccount = {
  id, user_id: username, store_id: branchId, role: "staff", role_slug: "staff",
  permissions, row_version: 17, is_active: true, email: "different@pos-internal.local",
  pin_hash: "fixture-approval-verifier", offline_login_pin_hash: "",
};

type RemoteAccount = typeof authoritativeAccount;
type Snapshot = { rows: RemoteAccount[]; cursor: string | null };
type CloudChange = { row_data: RemoteAccount };

it("allows the same hosted PIN session after desktop permission normalization", () => {
  const raw = { can_process_sale: true, "page:register": false };
  const expected = { ...hostedProof, id, username, branchId, level: "admin", permissions: raw };
  const actor = { authorId: id, canonicalSubject: username, branchId, source: "pos", level: "admin", permissions: raw };
  const adopted = { ...actor, permissions: { can_process_sale: false, "page:register": false, can_manage_sync_backup: true } };
  expect(matchesHostedStaffSession(actor, hostedProof, expected)).toBe(true);
  expect(matchesHostedStaffSession(adopted, { ...hostedProof, accessToken: "test-auth-enrichment" }, expected)).toBe(true);
  expect(matchesHostedStaffSession({ ...adopted, permissions: { ...adopted.permissions, can_process_refund: true } }, hostedProof, expected)).toBe(false);
  expect(matchesHostedStaffSession({ ...actor, branchId: foreignBranch }, hostedProof, expected)).toBe(false);
  expect(matchesHostedStaffSession(actor, { ...hostedProof, sessionToken: "test-new-session" }, expected)).toBe(false);
  expect(matchesHostedStaffSession(actor, { ...hostedProof, cashierToken: "test-different-cashier" }, expected)).toBe(false);
  expect(matchesHostedStaffSession(null, hostedProof, expected)).toBe(false);
});

function fixture() {
  let local = {
    ...authoritativeAccount, permissions: JSON.stringify(permissions), email: `${username}@terminal.invalid`,
    cashier_pin_hash: currentHash, cashier_store_id: branchId,
  };
  let current = true;
  let guid = databaseGuid;
  const log: string[] = [];
  const queries: string[] = [];
  const pending = new Set<string>();

  class Request {
    values = new Map<string, unknown>();

    constructor(private readonly transaction?: Transaction) {}

    input(name: string, value: unknown) {
      this.values.set(name, value);
      return this;
    }

    async query(sql: string) {
      queries.push(sql);
      expect([...this.values.values()]).not.toContain(pin);
      if (sql.includes("sys.database_recovery_status")) return { recordset: [{ database_guid: guid }] };
      if (sql.includes("dbo.app_users")) {
        expect(this.values).toEqual(new Map([["id", id], ["branch", branchId]]));
        const draft = this.transaction?.projected;
        const row = draft ? { ...local, row_version: draft.row_version, email: `${username}@pos-internal.local` } : local;
        return { recordset: [{ ...row }] };
      }
      throw new Error(`Unexpected test query: ${sql}`);
    }
  }

  class Transaction {
    projected: RemoteAccount | undefined;

    async begin(isolation: number) {
      expect(isolation).toBe(4);
      log.push("begin");
    }

    request() { return new Request(this); }

    async commit() {
      if (this.projected) {
        local.email = `${username}@pos-internal.local`;
        local.row_version = this.projected.row_version;
      }
      log.push("commit");
    }

    async rollback() { log.push("rollback"); }
  }

  const pool = { request: () => new Request() };
  const manager = { pool, sql: () => ({ Request, Transaction, ISOLATION_LEVEL: { SERIALIZABLE: 4 } }) };
  const withExclusive = vi.fn((work: () => unknown) => work());
  const coordinator = { withExclusive };
  const cloud = {
    bootstrapPage: vi.fn(async (): Promise<Snapshot> => ({ rows: [{ ...authoritativeAccount }], cursor: null })),
    applyLocalBatch: vi.fn(async (transaction: Transaction, _table: unknown, batch: { rows: CloudChange[] }) => {
      expect(transaction).toBeInstanceOf(Transaction);
      expect(batch.rows).toHaveLength(1);
      transaction.projected = batch.rows[0]?.row_data;
      log.push("upsert");
    }),
  };
  const reader = { unacknowledged: vi.fn(async () => pending) };
  const runApply = vi.fn((work: () => unknown) => work());
  const scope = {
    pool, id, branchId, username, role: "staff", roleSlug: "staff", permissions,
    assertCurrent() { if (!current) throw new Error("The test account context changed"); },
  };
  const refresh = createOfflineStaffRefresh({ cloud, manager, coordinator, registry, reader, runApply });
  return {
    cloud, log, pending, queries, reader, refresh, scope, withExclusive, state: () => ({ ...local }),
    setLocal: (values: Partial<typeof local>) => { local = { ...local, ...values }; },
    changeContext: () => { current = false; }, changeDatabase: () => { guid = foreignBranch; },
  };
}

describe("offline PIN refresh after verified hosted sign-in", () => {
  it("reprojects just the matching branch staff alias without changing the stored PIN", async () => {
    const f = fixture();
    await expect(f.refresh(f.scope, pin)).resolves.toBe(true);
    expect(f.cloud.bootstrapPage).toHaveBeenCalledWith({ table: "app_users", branchId, historyDays: 90, cursor: null, limit: 100 });
    expect(f.cloud.applyLocalBatch).toHaveBeenCalledTimes(1);
    expect(f.reader.unacknowledged).toHaveBeenCalledWith(expect.objectContaining({ cloudTable: "app_users" }),
      [JSON.stringify({ id })], expect.anything(), expect.objectContaining({ branchId }));
    expect(f.log).toEqual(["begin", "upsert", "commit"]);
    expect(f.state()).toMatchObject({ email: `${username}@pos-internal.local`, cashier_pin_hash: currentHash });
    expect(f.queries.every(sql => !/sync_checkpoints|pin_attempts|(?:UPDATE|DELETE)\s+dbo\./i.test(sql))).toBe(true);

    await f.refresh(f.scope, pin);
    expect(f.cloud.bootstrapPage).toHaveBeenCalledTimes(1);
    expect(f.cloud.applyLocalBatch).toHaveBeenCalledTimes(1);
  });

  it("reads the provider's bounded staff pages before taking the local sync lease", async () => {
    const f = fixture();
    const otherAccounts = Array.from({ length: 100 }, (_, index) => ({
      ...authoritativeAccount, id: `87fa617c-44c8-4417-9fc0-${String(index).padStart(12, "0")}`,
    }));
    f.cloud.bootstrapPage
      .mockImplementationOnce(async () => {
        expect(f.withExclusive).not.toHaveBeenCalled();
        return { rows: otherAccounts, cursor: "staff-page-2" };
      })
      .mockImplementationOnce(async () => {
        expect(f.withExclusive).not.toHaveBeenCalled();
        return { rows: [authoritativeAccount], cursor: null };
      });
    await expect(f.refresh(f.scope, pin)).resolves.toBe(true);
    expect(f.cloud.bootstrapPage).toHaveBeenNthCalledWith(1, expect.objectContaining({ cursor: null, limit: 100 }));
    expect(f.cloud.bootstrapPage).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor: "staff-page-2" }));
    expect(f.withExclusive).toHaveBeenCalledTimes(1);
    expect(f.cloud.applyLocalBatch).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      rows: [{ entity_id: JSON.stringify({ id }), row_data: authoritativeAccount, tombstone: false }], tombstones: [],
    });
  });

  it.each([
    ["a previously rotated PIN", { cashier_pin_hash: previousHash }],
    ["a cashier from another branch", { cashier_store_id: foreignBranch }],
  ])("does not make %s usable when the sync feed is behind", async (_reason, local) => {
    const f = fixture();
    f.setLocal(local);
    await expect(f.refresh(f.scope, pin)).resolves.toBe(false);
    expect(f.cloud.applyLocalBatch).not.toHaveBeenCalled();
    expect(f.state().email).toBe(`${username}@terminal.invalid`);
  });

  it("rechecks the selected cashier verifier inside the SQL transaction", async () => {
    const f = fixture();
    f.cloud.bootstrapPage.mockImplementation(async () => {
      f.setLocal({ cashier_pin_hash: previousHash });
      return { rows: [{ ...authoritativeAccount }], cursor: null };
    });
    await expect(f.refresh(f.scope, pin)).resolves.toBe(false);
    expect(f.log).toEqual(["begin", "rollback"]);
    expect(f.cloud.applyLocalBatch).not.toHaveBeenCalled();
  });

  it.each([
    ["a named account", { email: "cashier@example.invalid" }],
    ["a different branch", { store_id: foreignBranch }],
    ["a different user", { user_id: "other-staff" }],
    ["an inactive account", { is_active: false }],
    ["an older authoritative revision", { row_version: 16 }],
    ["an account with a changed role", { role: "admin" }],
    ["an account with changed permissions", { permissions: { can_process_sale: false } }],
  ])("keeps the current alias when the hosted snapshot is %s", async (_reason, values) => {
    const f = fixture();
    f.cloud.bootstrapPage.mockResolvedValue({ rows: [{ ...authoritativeAccount, ...values }], cursor: null });
    await expect(f.refresh(f.scope, pin)).resolves.toBe(false);
    expect(f.cloud.applyLocalBatch).not.toHaveBeenCalled();
    expect(f.state().email).toBe(`${username}@terminal.invalid`);
  });

  it("leaves pending local evidence intact", async () => {
    const f = fixture();
    f.pending.add(JSON.stringify({ id }));
    await expect(f.refresh(f.scope, pin)).resolves.toBe(false);
    expect(f.pending).toEqual(new Set([JSON.stringify({ id })]));
    expect(f.log).toEqual(["begin", "rollback"]);
    expect(f.cloud.applyLocalBatch).not.toHaveBeenCalled();
  });

  it("rejects a duplicate hosted account before opening a local transaction", async () => {
    const f = fixture();
    f.cloud.bootstrapPage.mockResolvedValue({ rows: [authoritativeAccount, authoritativeAccount], cursor: null });
    await expect(f.refresh(f.scope, pin)).rejects.toThrow(/duplicate account/i);
    expect(f.log).toEqual([]);
  });

  it("rolls back if the signed-in account changes during apply", async () => {
    const f = fixture();
    f.cloud.applyLocalBatch.mockImplementationOnce(async (transaction, _table, batch) => {
      transaction.projected = batch.rows[0]?.row_data;
      f.changeContext();
    });
    await expect(f.refresh(f.scope, pin)).rejects.toThrow(/account context changed/i);
    expect(f.log).toEqual(["begin", "rollback"]);
    expect(f.state().email).toBe(`${username}@terminal.invalid`);
  });

  it("does not apply a downloaded profile to a different physical database", async () => {
    const f = fixture();
    f.cloud.bootstrapPage.mockImplementation(async () => {
      f.changeDatabase();
      return { rows: [{ ...authoritativeAccount }], cursor: null };
    });
    await expect(f.refresh(f.scope, pin)).resolves.toBe(false);
    expect(f.cloud.applyLocalBatch).not.toHaveBeenCalled();
    expect(f.log).toEqual(["begin", "rollback"]);
    expect(f.state().email).toBe(`${username}@terminal.invalid`);
  });
});
