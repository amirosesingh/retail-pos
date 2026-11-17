import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { PullWorker } = require("../../../electron/sync/pull-worker.cjs");
const { loadRegistry } = require("../../../electron/db/schema-registry.cjs");
const { bootstrapDiagnostic } = require("../../../electron/diagnostics.cjs");
const table = loadRegistry().tables.find((row: { cloudTable: string }) => row.cloudTable === "sale_items");
const ITEM = "00000000-0000-4000-8000-000000000001";
const SALE = "00000000-0000-4000-8000-000000000002";
const OTHER = "00000000-0000-4000-8000-000000000003";
type Change = { table_name: string; entity_id: string; tombstone: boolean; row_data?: Record<string, unknown> | null };
const change = (patch: Partial<Change> = {}): Change => ({ table_name: "sale_items", entity_id: JSON.stringify({ id: ITEM }),
  tombstone: false, row_data: { id: ITEM, sale_id: SALE, branch_id: null, product_id: OTHER }, ...patch });
type Proof = { ordinal: number; parent_id: string | null; parent_store: string | null; existing_id: string | null;
  existing_sale_id: string | null; existing_branch: string | null; existing_parent_id: string | null; existing_parent_store: string | null };
const proof = (patch: Partial<Proof> = {}): Proof => ({ ordinal: 0, parent_id: SALE, parent_store: "shop-a", existing_id: null,
  existing_sale_id: null, existing_branch: null, existing_parent_id: null, existing_parent_store: null, ...patch });
const existing = (patch: Partial<Proof> = {}) => proof({ existing_id: ITEM, existing_sale_id: SALE,
  existing_parent_id: SALE, existing_parent_store: "shop-a", ...patch });

function fixture(options: { proofs?: Proof[]; ready?: number } = {}) {
  const pool = {}, sql: string[] = [], inputs = new Map<string, unknown>(), events: string[] = [];
  class Transaction {
    parent = pool;
    async begin() { events.push("begin"); }
    async commit() { events.push("commit"); }
    async rollback() { events.push("rollback"); }
    request() {
      return { input(name: string, value: unknown) { inputs.set(name, value); return this; },
        async query(statement: string) { sql.push(statement); return { recordsets: [[{ ready: options.ready ?? 1 }], options.proofs ?? [proof()]] }; } };
    }
  }
  const connectionManager = { pool, sql: () => ({ Transaction, ISOLATION_LEVEL: { SERIALIZABLE: 4 } }) };
  const reader = { unacknowledged: vi.fn(async () => new Set()) };
  const checkpoints = { get: vi.fn(async () => ({ committed_cursor: 51 })), save: vi.fn(async () => { events.push("cursor"); }) };
  const cloud = { applyLocalBatch: vi.fn(async (_transaction: unknown, _table: unknown, _batch: { rows: Change[]; tombstones: Change[]; branchId?: string }) => { events.push("apply"); return { applied: 1 }; }),
    pullBatch: vi.fn(async () => ({ count: 1, cursor: 52, rows: [change()], tombstones: [] })),
    bootstrapPage: vi.fn(async () => { throw Error("Must not fetch parents from another branch"); }) };
  const publish = vi.fn();
  const worker = new PullWorker({ connectionManager, registry: { tables: [table] }, reader, checkpoints, cloud, publish });
  return { worker, cloud, reader, checkpoints, publish, transaction: new Transaction(), events, sql, inputs, pool };
}

describe("ordinary native sale-item download scope", () => {
  it.each([null, "", "   ", "shop-a"])("accepts child branch %s only with the locked same-branch sale parent", async branch => {
    const f = fixture();
    const entry = change({ row_data: { id: ITEM, sale_id: SALE, branch_id: branch, product_id: OTHER } });
    await expect(f.worker.applyTable(f.transaction, table, [entry], "shop-a")).resolves.toMatchObject({ applied: 1 });
    expect(f.cloud.applyLocalBatch).toHaveBeenCalledWith(f.transaction, table, { rows: [entry], tombstones: [], branchId: "shop-a" });
    expect(f.cloud.bootstrapPage).not.toHaveBeenCalled();
    expect(f.inputs.get("changes")).toBe(JSON.stringify([{ id: ITEM, saleId: SALE, tombstone: false }]));
    expect(f.sql[0]).toContain("transaction_isolation_level=4"); expect(f.sql[0]).toContain("UPDLOCK,HOLDLOCK");
    expect(f.sql[0]).not.toContain("owner_store_id");
  });

  it("keeps an equal replay within the same sale and branch", async () => {
    const f = fixture({ proofs: [existing()] });
    await f.worker.applyTable(f.transaction, table, [change()], "shop-a");
    await f.worker.applyTable(f.transaction, table, [change()], "shop-a");
    expect(f.cloud.applyLocalBatch).toHaveBeenCalledTimes(2);
  });

  it.each(["", "   "])("keeps a legacy blank existing label unchanged on replay/tombstone: %j", async branch => {
    const f = fixture({ proofs: [existing({ existing_branch: branch })] });
    await f.worker.applyTable(f.transaction, table, [change({ row_data: { id: ITEM, sale_id: SALE, branch_id: branch } })], "shop-a");
    await f.worker.applyTable(f.transaction, table, [change({ tombstone: true, row_data: null })], "shop-a");
    expect(f.cloud.applyLocalBatch).toHaveBeenCalledTimes(2);
    expect(f.cloud.applyLocalBatch.mock.calls[0][2].rows[0].row_data.branch_id).toBe(branch);
  });

  it.each([
    ["foreign explicit child", change({ row_data: { id: ITEM, sale_id: SALE, branch_id: "shop-b" } }), proof()],
    ["foreign parent", change(), proof({ parent_store: "shop-b" })],
    ["case-mismatched text parent", change(), proof({ parent_store: "SHOP-A" })],
    ["foreign existing child", change(), existing({ existing_branch: "shop-b" })],
    ["foreign existing parent", change(), existing({ existing_parent_store: "shop-b" })],
    ["reparented existing child", change(), existing({ existing_sale_id: OTHER, existing_parent_id: OTHER })],
  ] as const)("refuses %s before pending reads or writes", async (_label, entry, row) => {
    const f = fixture({ proofs: [row] });
    await expect(f.worker.applyTable(f.transaction, table, [entry], "shop-a")).rejects.toMatchObject({ code: "SYNC_BRANCH_FORBIDDEN", table: "sale_items" });
    expect(f.cloud.applyLocalBatch).not.toHaveBeenCalled(); expect(f.reader.unacknowledged).not.toHaveBeenCalled();
    expect(f.checkpoints.save).not.toHaveBeenCalled(); expect(f.cloud.bootstrapPage).not.toHaveBeenCalled();
  });

  it("defers a missing parent without inventing or fetching a sale", async () => {
    const f = fixture({ proofs: [proof({ parent_id: null, parent_store: null })] });
    await expect(f.worker.applyTable(f.transaction, table, [change()], "shop-a")).rejects.toMatchObject({ code: "ESYNC_DOWNLOAD_PARENT_MISSING" });
    expect(f.cloud.applyLocalBatch).not.toHaveBeenCalled(); expect(f.cloud.bootstrapPage).not.toHaveBeenCalled();
  });

  it.each([false, true])("accepts a tombstone only for an absent or verified own child (present=%s)", async present => {
    const f = fixture({ proofs: [present ? existing({ parent_id: null, parent_store: null }) : proof({ parent_id: null, parent_store: null })] });
    const entry = change({ tombstone: true, row_data: null });
    await expect(f.worker.applyTable(f.transaction, table, [entry], "shop-a")).resolves.toMatchObject({ applied: 1 });
    expect(f.cloud.applyLocalBatch).toHaveBeenCalledWith(f.transaction, table, { rows: [], tombstones: [entry], branchId: "shop-a" });
    expect(f.sql[0]).toContain("saved.id=input.id"); expect(f.sql[0]).toContain("saved_parent.id=saved.sale_id");
  });

  it("never deletes another branch's legacy-null child", async () => {
    const f = fixture({ proofs: [existing({ parent_id: null, parent_store: null, existing_parent_store: "shop-b" })] });
    await expect(f.worker.applyTable(f.transaction, table, [change({ tombstone: true, row_data: null })], "shop-a")).rejects.toMatchObject({ code: "SYNC_BRANCH_FORBIDDEN" });
    expect(f.cloud.applyLocalBatch).not.toHaveBeenCalled();
  });

  it.each([0, 2])("requires the same caller-owned serializable transaction (ready=%s)", async ready => {
    const f = fixture({ ready });
    await expect(f.worker.applyTable(f.transaction, table, [change()], "shop-a")).rejects.toMatchObject({ code: "ELOCAL_PENDING_UNVERIFIED" });
    f.transaction.parent = {};
    await expect(f.worker.applyTable(f.transaction, table, [change()], "shop-a")).rejects.toMatchObject({ code: "ELOCAL_PENDING_UNVERIFIED" });
    expect(f.cloud.applyLocalBatch).not.toHaveBeenCalled();
  });

  it("rejects mismatched row/entity identities and preserves pending upload barriers", async () => {
    const f = fixture();
    await expect(f.worker.applyTable(f.transaction, table, [change({ entity_id: JSON.stringify({ id: OTHER }) })], "shop-a")).rejects.toMatchObject({ code: "ESYNC_ENTITY" });
    f.reader.unacknowledged.mockResolvedValueOnce(new Set([JSON.stringify({ id: ITEM })]));
    await expect(f.worker.applyTable(f.transaction, table, [change()], "shop-a")).rejects.toMatchObject({ code: "ELOCAL_UPLOAD_PENDING" });
    expect(f.cloud.applyLocalBatch).not.toHaveBeenCalled();
  });

  it("refuses an in-page attempt to associate the same child with another sale", async () => {
    const f = fixture();
    await expect(f.worker.applyTable(f.transaction, table, [change(), change({ row_data: { id: ITEM, sale_id: OTHER, branch_id: null } })], "shop-a"))
      .rejects.toMatchObject({ code: "SYNC_BRANCH_FORBIDDEN" });
    expect(f.sql).toHaveLength(0); expect(f.cloud.applyLocalBatch).not.toHaveBeenCalled();
  });

  it.each([JSON.stringify({ id: ITEM, extra: true }), JSON.stringify([ITEM]), "null"])("refuses noncanonical entity keys before pending checks: %s", async key => {
    const f = fixture();
    await expect(f.worker.applyTable(f.transaction, table, [change({ entity_id: key })], "shop-a"))
      .rejects.toMatchObject({ code: "ESYNC_ENTITY" });
    expect(f.sql).toHaveLength(0); expect(f.reader.unacknowledged).not.toHaveBeenCalled(); expect(f.cloud.applyLocalBatch).not.toHaveBeenCalled();
  });

  it("preserves the existing raw UUID tombstone wire contract", async () => {
    const f = fixture({ proofs: [proof({ parent_id: null, parent_store: null })] });
    await f.worker.applyTable(f.transaction, table, [change({ entity_id: ITEM.toUpperCase(), tombstone: true, row_data: null })], "shop-a");
    expect(f.cloud.applyLocalBatch).toHaveBeenCalledOnce();
  });

  it("tags the original native apply error using only known registry context", async () => {
    const f = fixture(), error = Object.assign(new Error("statement terminated"), { code: "EREQUEST", number: 547 });
    f.cloud.applyLocalBatch.mockRejectedValueOnce(error);
    await expect(f.worker.applyTable(f.transaction, table, [change()], "shop-a")).rejects.toBe(error);
    expect(error).toMatchObject({ code: "EREQUEST", number: 547, table: "sale_items" });
    expect(bootstrapDiagnostic(error, ["sale_items"])).toEqual({ table: "sale_items", bootstrapPhase: "local_apply" });
  });

  it("rolls back a rejected ordinary feed page without cursor, notification or progress", async () => {
    const f = fixture({ proofs: [proof({ parent_store: "shop-b" })] }), progress = vi.fn();
    await expect(f.worker.run({ branchId: "shop-a", skipMembership: true, onProgress: progress })).rejects.toMatchObject({ code: "SYNC_BRANCH_FORBIDDEN" });
    expect(f.events).toEqual(["begin", "rollback"]); expect(f.checkpoints.save).not.toHaveBeenCalled();
    expect(f.publish).not.toHaveBeenCalled(); expect(progress).not.toHaveBeenCalled(); expect(f.cloud.bootstrapPage).not.toHaveBeenCalled();
  });

  it("commits an authorized ordinary page before advancing progress", async () => {
    const f = fixture();
    await expect(f.worker.run({ branchId: "shop-a", skipMembership: true, onProgress: () => f.events.push("progress") })).resolves.toMatchObject({ merged: 1 });
    expect(f.events).toEqual(["begin", "apply", "cursor", "commit", "progress"]);
  });

  it("does not query or change the writer for empty/unrelated table batches", async () => {
    const f = fixture();
    await expect(f.worker.applyTable(f.transaction, table, [], "shop-a")).resolves.toEqual({ applied: 0, conflicts: 0 });
    expect(f.sql).toHaveLength(0);
    const unrelated = { ...table, cloudTable: "products", sqlServerTable: "products" };
    await f.worker.applyTable(f.transaction, unrelated, [change()], "shop-a");
    expect(f.sql).toHaveLength(0);
  });
});
