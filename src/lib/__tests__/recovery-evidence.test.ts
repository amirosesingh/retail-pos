import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { CHANNEL, installRecoveryEvidenceIpc } = require("../../../electron/sync/recovery-evidence.cjs");
const { stableUuid } = require("../../../electron/db/repositories/aggregates.cjs");
const batchId = "11111111-1111-4111-8111-111111111111";
const recordId = "22222222-2222-4222-8222-222222222222";
const operationId = "33333333-3333-4333-8333-333333333333";
const savedAt = "2026-11-26T04:20:32.0000000+00:00";
const scope = { branchId: "branch-a", terminalId: "till-a", fingerprint: "fixture-db-a" };
type Request = { batchId: string; kind: string };
type Handler = (event: string, request: Request) => Promise<unknown>;

function fixture(timeoutMs?: number) {
  const rows = [{ entity_type: "stock_history_movements", entity_id: recordId, accepted: 0, saved_at: savedAt }];
  const state = { scope, epoch: 1, trusted: true, access: true, connected: true, available: true };
  const movement = { id: recordId, operation_id: operationId, original_proof: 0, has_receipt: 0 };
  const original = { reference_id: recordId, shift_id: operationId, payload_hash: "a".repeat(64), original_proof: 1 };
  const exact = { exists: false };
  const query = vi.fn(async (text: string, inputs: Record<string, unknown>) => {
    if (text.includes("FROM dbo.sync_change_journal")) return rows;
    if (text.includes("OBJECT_ID")) return [{ ready: state.available ? 1 : 0 }];
    if (text.includes("FROM dbo.stock_history_movements")) return [movement];
    if (text.includes("FROM dbo.pos_sync_shift_financial_")) return [original];
    if (text.includes("FROM dbo.local_operation_receipts")) return exact.exists ? [{ present: 1 }] : [];
    throw new Error("Unexpected verification query " + Object.keys(inputs).join(","));
  });
  let handler!: Handler;
  const begin = vi.fn(async () => {});
  const commit = vi.fn(async () => {});
  const rollback = vi.fn(async () => {});
  class Transaction {
    async begin() { await begin(); }
    async commit() { await commit(); }
    async rollback() { await rollback(); }
  }
  class SqlRequest {
    private inputs: Record<string, unknown> = {};
    input(key: string, value: unknown) { this.inputs[key] = value; }
    async query(text: string) { return { recordset: await query(text, this.inputs) }; }
  }
  installRecoveryEvidenceIpc({
    ipcMain: { handle: (channel: string, fn: Handler) => { expect(channel).toBe(CHANNEL); handler = fn; } },
    manager: { pool: {}, sql: () => ({ Transaction, Request: SqlRequest, ISOLATION_LEVEL: { SERIALIZABLE: 4 } }) },
    session: { hasPosAuthority: () => state.trusted, hasLevel: () => false, hasPermission: () => state.access,
      epoch: () => state.epoch, touch: vi.fn() },
    isPosSender: (event: string) => event === "pos",
    readScope: () => state.scope, canCheck: () => state.connected, timeoutMs,
  });
  return { state, rows, movement, original, exact, query, begin, commit, rollback,
    call: (kind = "stock") => handler("pos", { batchId, kind }), handler };
}

describe("native saved verification evidence", () => {
  it("reads the exact stock batch on this till and distinguishes missing proof from saved acceptance", async () => {
    const f = fixture();
    expect(await f.call()).toMatchObject({ ok: true, batchId, kind: "stock", branchId: scope.branchId, reference: operationId,
      savedAt, savedRows: 1, queuedRows: 1, originalProof: "missing", receipt: null });
    f.movement.has_receipt = 1;
    expect(await f.call()).toMatchObject({ ok: true, queuedRows: 1, receipt: null });
    f.rows[0].accepted = 1;
    expect(await f.call()).toMatchObject({ ok: true, queuedRows: 0, originalProof: "missing", receipt: "stock" });
    const stock = f.query.mock.calls.find(([text]) => text.includes("FROM dbo.stock_history_movements"));
    expect(stock?.[1]).toEqual({ branch: scope.branchId, terminal: scope.terminalId, batch: batchId, ids: JSON.stringify([recordId]) });
    expect(f.query.mock.calls.every(([text]) => text.startsWith("SELECT"))).toBe(true);
  });

  it("uses the same opening receipt identity and keeps financial metadata separate from sale acceptance", async () => {
    const f = fixture();
    f.rows[0].entity_type = "shifts";
    expect(await f.call("shift")).toMatchObject({ ok: true, originalProof: "saved", receipt: null, queuedRows: 1 });
    f.exact.exists = true;
    expect(await f.call("shift")).toMatchObject({ ok: true, receipt: "opening", queuedRows: 1 });
    const receipt = f.query.mock.calls.find(([text]) => text.includes("FROM dbo.local_operation_receipts"));
    const type = "financial_history_opened";
    expect(receipt?.[1]).toEqual({ id: stableUuid({ domain: "retail-pos.financial-history-ack.v1",
      type, entityId: batchId, payloadHash: f.original.payload_hash, terminalId: scope.terminalId }),
    type, entity: batchId, note: `${f.original.payload_hash}:${scope.terminalId}` });
    f.rows[0].entity_type = "sales";
    f.rows[0].accepted = 1;
    expect(await f.call("sale")).toMatchObject({ ok: true, kind: "sale", receipt: "financial-metadata", queuedRows: 0 });
  });

  it("refuses unexpected input, untrusted frames and sessions without POS authority", async () => {
    const f = fixture();
    expect(await f.handler("iframe", { batchId, kind: "stock" })).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    f.state.trusted = false;
    expect(await f.call()).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    f.state.trusted = true;
    f.state.access = false;
    expect(await f.call()).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    f.state.access = true;
    expect(await f.call("extra")).toMatchObject({ ok: false, code: "EBADARG" });
    expect(await f.handler("pos", { batchId: "unsafe", kind: "stock" })).toMatchObject({ ok: false, code: "EBADARG" });
    expect(f.query).not.toHaveBeenCalled();
  });

  it.each(["session", "database", "branch", "terminal"])("discards a result after a %s change", async subject => {
    const f = fixture();
    f.commit.mockImplementationOnce(async () => {
      if (subject === "session") f.state.epoch++;
      if (subject === "database") f.state.scope = { ...scope, fingerprint: "other" };
      if (subject === "branch") f.state.scope = { ...scope, branchId: "branch-b" };
      if (subject === "terminal") f.state.scope = { ...scope, terminalId: "till-b" };
    });
    expect(await f.call()).toMatchObject({ ok: false, code: "ERECOVERY_EVIDENCE_UNAVAILABLE" });
  });

  it("stops reading as soon as authority changes during the journal request", async () => {
    const f = fixture();
    f.query.mockImplementationOnce(async () => {
      f.state.access = false;
      return f.rows;
    });
    expect(await f.call()).toMatchObject({ ok: false, code: "ERECOVERY_EVIDENCE_UNAVAILABLE" });
    expect(f.query).toHaveBeenCalledOnce();
    expect(f.commit).not.toHaveBeenCalled();
    expect(f.rollback).toHaveBeenCalledOnce();
  });

  it("returns a bounded result and releases a delayed SQL lease without reading it", async () => {
    const f = fixture(10);
    let acquire!: () => void;
    f.begin.mockReturnValueOnce(new Promise<void>(resolve => { acquire = resolve; }));
    expect(await f.call()).toMatchObject({ ok: false, code: "ERECOVERY_EVIDENCE_UNAVAILABLE" });
    expect(await f.call()).toMatchObject({ ok: false, code: "ERECOVERY_EVIDENCE_UNAVAILABLE" });
    expect(f.begin).toHaveBeenCalledOnce();
    expect(f.query).not.toHaveBeenCalled();
    acquire();
    await vi.waitFor(() => expect(f.rollback).toHaveBeenCalledOnce());
    expect(f.query).not.toHaveBeenCalled();
    expect(await f.call()).toMatchObject({ ok: true });
  });

  it("holds an unknown, incomplete, mixed or old-schema batch", async () => {
    const f = fixture();
    f.state.available = false;
    expect(await f.call()).toMatchObject({ ok: false });
    f.state.available = true;
    f.rows.push({ ...f.rows[0], entity_type: "sales" });
    expect(await f.call()).toMatchObject({ ok: false });
    f.rows[0].entity_type = "shifts";
    expect(await f.call("shift")).toMatchObject({ ok: false });
    f.rows[0].entity_type = "sales";
    expect(await f.call("sale")).toMatchObject({ ok: false });
    f.rows.length = 0;
    expect(await f.call()).toMatchObject({ ok: false });
  });
});

it.runIf(process.env.RETAIL_POS_RECOVERY_EVIDENCE_SQLSERVER_TEST === "1")(
  "reads saved evidence from a disposable SQL Server after reconnect", async () => {
    const { createLocal } = require("../../../scripts/lib/shift-protocol-integration-fixture.cjs");
    const { StockHistoryStore } = require("../../../electron/db/stock-history.cjs");
    const { StockHistoryOutbox } = require("../../../electron/db/stock-history-outbox.cjs");
    const contract = require("../../../electron/db/stock-history-contract.cjs");
    const local = await createLocal(scope.branchId, { extraTables: ["products"] });
    try {
      const manager = local.manager;
      await manager.pool.request().batch("ALTER TABLE dbo.sync_change_journal ADD created_at datetimeoffset(7) NOT NULL DEFAULT SYSDATETIMEOFFSET();");
      for (const schema of ["026_shift_financial_operations.sql", "031_stock_history_effective_ledger.sql"])
        await manager.pool.request().batch(readFileSync("database/sqlserver/prepared/" + schema, "utf8"));
      let handler!: Handler;
      let till = scope.terminalId;
      installRecoveryEvidenceIpc({
        ipcMain: { handle: (_channel: string, fn: Handler) => { handler = fn; } }, manager,
        session: { hasPosAuthority: () => true, hasLevel: () => true, epoch: () => 1, touch() {} },
        isPosSender: () => true, canCheck: () => true, readScope: () => ({ ...scope, terminalId: till }),
      });
      const stockAt = "2026-11-26T04:20:32.0000000Z";
      const stock = new StockHistoryStore(manager);
      const movementContext = contract.normalizeContext({ operationId, branchId: scope.branchId,
        terminalId: scope.terminalId, kind: "sale" }, stockAt);
      const products = (quantity: number) => [{ id: recordId, name: "Fixture", stock_by_store: { [scope.branchId]: quantity } }];
      const [movement] = contract.changes(movementContext, products(3), products(2));
      const stockBatchId = contract.uploadAggregateId(operationId, scope.branchId);
      const sql = manager.sql(), tx = new sql.Transaction(manager.pool);
      await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      try {
        await stock.ensureHead(tx, scope.branchId);
        await stock.insertMovements(tx, scope.branchId, [movement]);
        await tx.commit();
      } catch (error) { await tx.rollback(); throw error; }

      expect(await handler("pos", { batchId: stockBatchId, kind: "stock" })).toMatchObject({
        ok: true, reference: operationId, savedRows: 1, queuedRows: 1, originalProof: "missing", receipt: null, savedAt: expect.any(String),
      });
      till = "till-other";
      expect(await handler("pos", { batchId: stockBatchId, kind: "stock" })).toMatchObject({ ok: false });
      till = scope.terminalId;
      const outbox = new StockHistoryOutbox(manager);
      const pending = await outbox.pending(stockBatchId, scope.branchId, till);
      await outbox.acknowledge(pending, { ok: true, version: 1, branchId: scope.branchId, terminalId: till,
        receipts: [{ id: movement.id, payloadHash: movement.payload_hash, ingestedCursor: "1", acceptedAt: stockAt, effectIds: [recordId] }] });
      await local.restart();
      expect(await handler("pos", { batchId: stockBatchId, kind: "stock" })).toMatchObject({
        ok: true, queuedRows: 0, originalProof: "missing", receipt: "stock",
      });
      const sha256 = (raw: string) => createHash("sha256").update(raw, "utf8").digest("hex");
      const openingPayload = JSON.stringify({ label: "Café" });
      const hash = sha256(openingPayload);
      const proof = (action: string, payloadHash: string) =>
        JSON.stringify({ action, payloadHash, algorithm: "Ed25519", signature: "a".repeat(86) });
      const openingRequest = manager.pool.request().input("batch", batchId).input("shift", recordId).input("branch", scope.branchId)
        .input("terminal", till).input("proof", proof("OPEN", hash)).input("hash", hash)
        .input("payload", openingPayload).input("entity", JSON.stringify({ id: recordId }));
      await openingRequest.query(`INSERT dbo.pos_sync_shift_financial_origins
        (branch_id,shift_id,terminal_id,origin_kind,local_aggregate_id,row_hash,opening_payload_json,opening_payload_hash,proof_json,origin_version,created_at)
        VALUES(@branch,@shift,@terminal,'OPEN',@batch,@hash,@payload,@hash,@proof,1,SYSDATETIMEOFFSET());
        INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version,aggregate_id)
        VALUES(N'shifts',@entity,N'insert',@branch,1,@batch);`);
      expect(await handler("pos", { batchId, kind: "shift" })).toMatchObject({
        ok: true, reference: recordId, originalProof: "saved", receipt: null, queuedRows: 1,
      });
      const type = "financial_history_opened";
      const id = stableUuid({ domain: "retail-pos.financial-history-ack.v1", type, entityId: batchId, payloadHash: hash, terminalId: till });
      await manager.pool.request().input("id", id).input("type", type).input("batch", batchId).input("note", `${hash}:${till}`)
        .query("INSERT dbo.local_operation_receipts(operation_id,operation_type,entity_id,note) VALUES(@id,@type,@batch,@note+N' ');");
      expect(await handler("pos", { batchId, kind: "shift" })).toMatchObject({ ok: true, receipt: null, queuedRows: 1 });
      await manager.pool.request().input("id", id).input("note", `${hash}:${till}`)
        .query("UPDATE dbo.local_operation_receipts SET note=@note WHERE operation_id=@id;");
      expect(await handler("pos", { batchId, kind: "shift" })).toMatchObject({ ok: true, receipt: "opening", queuedRows: 1 });

      const saleId = "44444444-4444-4444-8444-444444444444";
      const salePayload = JSON.stringify({ changes: [{ saleId }] }), saleHash = sha256(salePayload);
      await manager.pool.request().input("batch", operationId).input("shift", recordId).input("branch", scope.branchId)
        .input("terminal", till).input("proof", proof("SALE", saleHash)).input("hash", saleHash)
        .input("payload", salePayload).input("entity", JSON.stringify({ id: saleId }))
        .query(`INSERT dbo.pos_sync_shift_financial_events
          (branch_id,shift_id,terminal_id,sequence,operation_id,event_kind,action,predecessor_hash,payload_json,payload_hash,proof_json)
          VALUES(@branch,@shift,@terminal,1,@batch,'MUTATION','SALE',@hash,@payload,@hash,@proof);
          INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version,aggregate_id)
          VALUES(N'sales',@entity,N'insert',@branch,1,@batch);`);
      expect(await handler("pos", { batchId: operationId, kind: "sale" })).toMatchObject({
        ok: true, reference: saleId, originalProof: "saved", receipt: null, queuedRows: 1,
      });
      const metadataType = "financial_history_registered", entityId = `${recordId}:${operationId}`;
      const metadataId = stableUuid({ domain: "retail-pos.financial-history-ack.v1", type: metadataType, entityId, payloadHash: saleHash, terminalId: till });
      await manager.pool.request().input("id", metadataId).input("type", metadataType).input("entity", entityId).input("note", `${saleHash}:${till}`)
        .query("INSERT dbo.local_operation_receipts(operation_id,operation_type,entity_id,note) VALUES(@id,@type,@entity,@note);");
      expect(await handler("pos", { batchId: operationId, kind: "sale" })).toMatchObject({
        ok: true, receipt: "financial-metadata", queuedRows: 1,
      });
    } finally { await local.close(); }
  }, 90_000,
);
