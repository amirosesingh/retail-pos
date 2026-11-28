const guard = require("../ipc-guard.cjs");
const { stableUuid } = require("../db/repositories/aggregates.cjs");

const CHANNEL = "sync:recovery-evidence";
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const KINDS = new Set(["shift", "sale", "stock"]);
const QUERY_TIMEOUT_MS = 1000;
const CHECK_TIMEOUT_MS = 4000;
const unconfirmed = { ok: false, code: "ERECOVERY_EVIDENCE_UNAVAILABLE", error: "Evidence could not be confirmed for this saved batch." };
const denied = { ok: false, code: "PERMISSION_DENIED", error: "Sign in on this till with permission to manage database synchronization." };

// These column names come only from the three fixed evidence queries.
const digest = column => `LOWER(CONVERT(varchar(64),HASHBYTES('SHA2_256',
  CONVERT(varchar(max),${column} COLLATE Latin1_General_100_BIN2_UTF8)),2)) COLLATE Latin1_General_100_BIN2`;

async function readEvidence(query, scope, batchId, kind) {
  const { branchId: branch, terminalId: terminal } = scope;
  const params = { branch, terminal, batch: batchId };
  const journal = await query(`SELECT TOP (101) entity_type,
    LOWER(CONVERT(nvarchar(36),TRY_CONVERT(uniqueidentifier,
      JSON_VALUE(CASE WHEN ISJSON(entity_id)=1 THEN entity_id ELSE N'{}' END,'$.id')))) entity_id,
    CASE WHEN acknowledged_at IS NULL THEN 0 ELSE 1 END accepted,
    CONVERT(nvarchar(40),created_at,127) saved_at
    FROM dbo.sync_change_journal WITH(HOLDLOCK,NOWAIT)
    WHERE aggregate_id=TRY_CONVERT(uniqueidentifier,@batch) AND branch_id=@branch
      AND CONVERT(varbinary(256),branch_id)=CONVERT(varbinary(256),@branch)
    ORDER BY change_id;`, params);
  if (!journal.length || journal.length > 100 || journal.some(row => row.accepted !== 0 && row.accepted !== 1))
    return unconfirmed;
  const queuedRows = journal.filter(row => row.accepted === 0).length;

  const object = kind === "stock" ? "stock_history_movements"
    : kind === "shift" ? "pos_sync_shift_financial_origins" : "pos_sync_shift_financial_events";
  const [available] = await query("SELECT CASE WHEN OBJECT_ID(N'dbo.'+@object,N'U') IS NOT NULL THEN 1 ELSE 0 END ready;", { object });
  if (available?.ready !== 1) return unconfirmed;

  let reference, originalProof, receipt = null;
  if (kind === "stock") {
    if (journal.some(row => row.entity_type !== "stock_history_movements" || !UUID.test(row.entity_id ?? ""))) return unconfirmed;
    const ids = [...new Set(journal.map(row => row.entity_id))];
    const movements = await query(`SELECT LOWER(CONVERT(nvarchar(36),id)) id,
      LOWER(CONVERT(nvarchar(36),operation_id)) operation_id,
      CASE WHEN JSON_VALUE(proof.json,'$.algorithm')=N'Ed25519' AND LEN(JSON_VALUE(proof.json,'$.signature'))=86
        AND JSON_VALUE(proof.json,'$.payloadHash') COLLATE Latin1_General_100_BIN2=payload_hash
        THEN 1 ELSE 0 END original_proof,
      CASE WHEN ingested_cursor>0 AND ingested_at IS NOT NULL AND ${digest("payload_json")}=payload_hash
        THEN 1 ELSE 0 END has_receipt
      FROM dbo.stock_history_movements WITH(HOLDLOCK,NOWAIT)
      CROSS APPLY (VALUES(CASE WHEN ISJSON(author_proof_json)=1 THEN author_proof_json ELSE N'{}' END)) proof(json)
      WHERE upload_aggregate_id=TRY_CONVERT(uniqueidentifier,@batch)
        AND store_id=@branch AND terminal_id=@terminal
        AND CONVERT(varbinary(256),store_id)=CONVERT(varbinary(256),@branch)
        AND CONVERT(varbinary(256),terminal_id)=CONVERT(varbinary(256),@terminal)
        AND local_cursor IS NOT NULL
        AND id IN (SELECT TRY_CONVERT(uniqueidentifier,[value]) FROM OPENJSON(@ids));`, { ...params, ids: JSON.stringify(ids) });
    const operation = movements[0]?.operation_id;
    if (movements.length !== ids.length || !UUID.test(operation ?? "") || movements.some(row => row.operation_id !== operation)) return unconfirmed;
    reference = operation;
    originalProof = movements.every(row => row.original_proof === 1) ? "saved"
      : movements.some(row => row.original_proof === 1) ? "partial" : "missing";
    if (queuedRows === 0 && movements.every(row => row.has_receipt === 1)) receipt = "stock";
  } else {
    const shiftOpening = kind === "shift";
    // Only these two fixed statements may read financial evidence.
    const originals = await query(shiftOpening ? `SELECT TOP (2)
      LOWER(CONVERT(nvarchar(36),shift_id)) reference_id,opening_payload_hash payload_hash,
      CASE WHEN JSON_VALUE(proof.json,'$.action')=N'OPEN' AND JSON_VALUE(proof.json,'$.algorithm')=N'Ed25519'
        AND JSON_VALUE(proof.json,'$.payloadHash') COLLATE Latin1_General_100_BIN2=opening_payload_hash
        AND LEN(JSON_VALUE(proof.json,'$.signature'))=86 THEN 1 ELSE 0 END original_proof
      FROM dbo.pos_sync_shift_financial_origins WITH(HOLDLOCK,NOWAIT)
      CROSS APPLY (VALUES(CASE WHEN ISJSON(proof_json)=1 THEN proof_json ELSE N'{}' END)) proof(json)
      WHERE local_aggregate_id=TRY_CONVERT(uniqueidentifier,@batch) AND origin_kind=N'OPEN'
        AND ${digest("opening_payload_json")}=opening_payload_hash
        AND branch_id=@branch AND terminal_id=@terminal
        AND CONVERT(varbinary(256),branch_id)=CONVERT(varbinary(256),@branch)
        AND CONVERT(varbinary(256),terminal_id)=CONVERT(varbinary(256),@terminal);` : `SELECT TOP (2)
      JSON_VALUE(payload.json,'$.changes[0].saleId') reference_id,LOWER(CONVERT(nvarchar(36),shift_id)) shift_id,payload_hash,
      CASE WHEN JSON_VALUE(proof.json,'$.action')=N'SALE' AND JSON_VALUE(proof.json,'$.algorithm')=N'Ed25519'
        AND JSON_VALUE(proof.json,'$.payloadHash') COLLATE Latin1_General_100_BIN2=payload_hash
        AND LEN(JSON_VALUE(proof.json,'$.signature'))=86 THEN 1 ELSE 0 END original_proof
      FROM dbo.pos_sync_shift_financial_events WITH(HOLDLOCK,NOWAIT)
      CROSS APPLY (VALUES(CASE WHEN ISJSON(proof_json)=1 THEN proof_json ELSE N'{}' END)) proof(json)
      CROSS APPLY (VALUES(CASE WHEN ISJSON(payload_json)=1 THEN payload_json ELSE N'{}' END)) payload(json)
      WHERE operation_id=TRY_CONVERT(uniqueidentifier,@batch) AND event_kind=N'MUTATION' AND action=N'SALE'
        AND ${digest("payload_json")}=payload_hash
        AND (SELECT COUNT_BIG(*) FROM OPENJSON(payload.json,'$.changes'))=1
        AND branch_id=@branch AND terminal_id=@terminal
        AND CONVERT(varbinary(256),branch_id)=CONVERT(varbinary(256),@branch)
        AND CONVERT(varbinary(256),terminal_id)=CONVERT(varbinary(256),@terminal);`, params);
    const [original] = originals;
    if (originals.length !== 1 || !UUID.test(original.reference_id ?? "") || !HASH.test(original.payload_hash ?? "")) return unconfirmed;
    const entity = shiftOpening ? "shifts" : "sales";
    const parents = journal.filter(row => row.entity_type === entity);
    if ((shiftOpening && journal.length !== 1) || parents.length !== 1 || parents[0].entity_id !== original.reference_id)
      return unconfirmed;
    if (!shiftOpening && !UUID.test(original.shift_id ?? "")) return unconfirmed;
    reference = original.reference_id;
    originalProof = original.original_proof === 1 ? "saved" : "missing";
    const type = shiftOpening ? "financial_history_opened" : "financial_history_registered";
    const entityId = shiftOpening ? batchId : `${original.shift_id}:${batchId}`;
    const receiptId = stableUuid({ domain: "retail-pos.financial-history-ack.v1", type, entityId, payloadHash: original.payload_hash, terminalId: terminal });
    const exact = await query(`SELECT 1 present FROM dbo.local_operation_receipts WITH(HOLDLOCK,NOWAIT)
      WHERE operation_id=TRY_CONVERT(uniqueidentifier,@id)
        AND CONVERT(varbinary(max),operation_type)=CONVERT(varbinary(max),@type)
        AND CONVERT(varbinary(max),entity_id)=CONVERT(varbinary(max),@entity)
        AND CONVERT(varbinary(max),note)=CONVERT(varbinary(max),@note);`,
    { id: receiptId, type, entity: entityId, note: `${original.payload_hash}:${terminal}` });
    if (originalProof === "saved" && exact.length === 1) receipt = shiftOpening ? "opening" : "financial-metadata";
  }

  return { ok: true, batchId, kind, branchId: branch, reference, savedAt: journal[0].saved_at,
    savedRows: journal.length, queuedRows, originalProof, receipt };
}

function installRecoveryEvidenceIpc({ ipcMain, manager, session, isPosSender, readScope, canCheck, timeoutMs = CHECK_TIMEOUT_MS }) {
  let reading = false;
  ipcMain.handle(CHANNEL, async (event, value) => {
    const allowed = () => isPosSender(event) && session.hasPosAuthority() &&
      (session.hasLevel("admin") || session.hasPermission("can_manage_sync_backup"));
    if (!allowed()) return denied;
    try {
      const input = guard.plainObject(value, { name: "verification request" });
      if (Object.keys(input).length !== 2 || !Object.hasOwn(input, "batchId") || !KINDS.has(input.kind)) throw new guard.BadArg("Choose a saved verification case.");
      const batchId = guard.uuid(input.batchId, { name: "saved batch" });
      if (reading || !canCheck() || !manager.pool) return unconfirmed;
      const scope = { ...readScope() }, pool = manager.pool, epoch = session.epoch();
      if (!scope.fingerprint || !scope.branchId || !scope.terminalId) return unconfirmed;
      let expired = false, timer;
      const assertCurrent = () => {
        if (expired || !allowed() || session.epoch() !== epoch || pool !== manager.pool || !canCheck())
          throw new Error("Verification context changed.");
        const current = readScope();
        if (current?.fingerprint !== scope.fingerprint || current?.branchId !== scope.branchId || current?.terminalId !== scope.terminalId)
          throw new Error("Verification scope changed.");
      };
      const read = async () => {
        let transaction;
        try {
          assertCurrent();
          session.touch();
          const sql = manager.sql();
          transaction = new sql.Transaction(pool, { requestTimeout: QUERY_TIMEOUT_MS });
          await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
          const query = async (text, inputs) => {
            assertCurrent();
            const request = new sql.Request(transaction, { requestTimeout: QUERY_TIMEOUT_MS });
            for (const [name, parameter] of Object.entries(inputs)) request.input(name, parameter);
            const result = await request.query(text);
            assertCurrent();
            return result.recordset ?? [];
          };
          const checked = await readEvidence(query, scope, batchId, input.kind);
          assertCurrent();
          await transaction.commit();
          transaction = null;
          assertCurrent();
          return checked;
        } catch {
          if (transaction) await Promise.resolve().then(() => transaction.rollback()).catch(() => undefined);
          return unconfirmed;
        } finally {
          reading = false;
        }
      };
      reading = true;
      const deadline = new Promise(resolve => {
        timer = setTimeout(() => { expired = true; resolve(unconfirmed); }, timeoutMs);
      });
      // A delayed pool lease rolls back before reading. Keep it single-flight
      // through cleanup so repeated clicks cannot queue abandoned transactions.
      return await Promise.race([read(), deadline]).finally(() => clearTimeout(timer));
    } catch (error) {
      if (error instanceof guard.BadArg) return { ok: false, code: "EBADARG", error: "Choose a saved verification case." };
      return unconfirmed;
    }
  });
}

module.exports = { CHANNEL, installRecoveryEvidenceIpc };
