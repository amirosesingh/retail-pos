const { savedRefund, assertRefundStorageReady } = require("./grouped-refund-native.cjs");
const { decodeFinancialRefundReceipt, decodeFinancialRefundOriginal, amountMinor } = require("./financial-refund-approval.cjs");
const { createHash } = require("node:crypto");
const { refundHeld } = require("./refund-command.cjs");
const { recordId } = require("./uuid-fields.cjs");
const { parseExactJson } = require("./shift-recovery-exact.cjs");
const { parseRefundApprovalJson,normalizeRefundSaleCreatedAt } = require("./refund-approval-evidence.cjs");

async function lockFinancialOrigin(request, row, scope) {
  const available=(await request().query(`SELECT CASE WHEN OBJECT_ID(N'dbo.pos_sync_shift_financial_events',N'U') IS NOT NULL
    AND OBJECT_ID(N'dbo.pos_sync_shift_financial_origins',N'U') IS NOT NULL AND OBJECT_ID(N'dbo.pos_sync_shift_financial_heads',N'U') IS NOT NULL THEN 1 ELSE 0 END ready;`)).recordset??[];
  if(available.length!==1||Number(available[0].ready)!==1)throw refundHeld();
  const rows=(await request().input("op",recordId(row.operation_id)).input("branch",scope.branchId).input("terminal",scope.terminalId).query(`
    SELECT TOP(2) e.operation_id,e.shift_id,CONVERT(varchar(30),e.sequence) sequence,e.payload_json,e.payload_hash,e.proof_json,
      o.origin_kind,o.local_aggregate_id,o.row_hash,o.server_basis_id,o.server_basis_hash,
      CONVERT(varchar(30),h.sequence) head_sequence,h.operation_id head_operation_id,h.payload_hash head_hash
    FROM dbo.pos_sync_shift_financial_events e WITH(UPDLOCK,HOLDLOCK)
    JOIN dbo.pos_sync_shift_financial_origins o WITH(UPDLOCK,HOLDLOCK)
      ON o.branch_id=e.branch_id AND o.shift_id=e.shift_id AND o.terminal_id=e.terminal_id
    JOIN dbo.pos_sync_shift_financial_heads h WITH(UPDLOCK,HOLDLOCK)
      ON h.branch_id=e.branch_id AND h.shift_id=e.shift_id AND h.terminal_id=e.terminal_id
    WHERE e.operation_id=@op AND e.branch_id=@branch AND e.terminal_id=@terminal AND e.event_kind=N'MUTATION' AND e.action=N'REFUND';`)).recordset??[];
  if(rows.length!==1)throw refundHeld();
  return rows;
}
function readLegacyFinancial(row, scope, saleId, databaseGuid, rows) {
  if(!rows||rows.length!==1)throw refundHeld();
  const found=rows[0];let proof,event;
  try {parseExactJson(found.proof_json,{maxBytes:8192,maxDepth:4});proof=JSON.parse(found.proof_json);
    parseExactJson(found.payload_json,{maxBytes:6*1024*1024,maxDepth:16});event=JSON.parse(found.payload_json);
  }catch{throw refundHeld();}
  const decoded=decodeFinancialRefundOriginal(found.payload_json,proof,{operationId:recordId(row.operation_id),saleId,branchId:scope.branchId,terminalId:scope.terminalId});
  const digest=createHash("sha256").update(decoded.payloadJson,"utf8").digest("hex");
  const origin=event.openingOrigin??event.cloudOrigin;
  if(found.payload_hash!==digest||recordId(found.shift_id)!==event.shiftId||recordId(row.sale_shift_id)!==event.shiftId||
      String(found.sequence)!==event.sequence||BigInt(found.head_sequence)<BigInt(found.sequence)||
      (String(found.head_sequence)===String(found.sequence)&&(recordId(found.head_operation_id)!==decoded.operationId||found.head_hash!==digest))||
      (event.openingOrigin
        ? found.origin_kind!=="OPEN"||recordId(found.local_aggregate_id)!==origin.localAggregateId||found.row_hash!==origin.rowHash
        : found.origin_kind!=="CLOUD_BASIS"||recordId(found.server_basis_id)!==origin.serverBasisId||found.server_basis_hash!==origin.serverBasisHash))throw refundHeld();
  // This is a new review of the retained event under today's verified source,
  // never an assertion that its old signature originally included a DB GUID.
  return {route:"financial",legacyFinancial:true,operationId:decoded.operationId,refundId:`financial-operation:${decoded.operationId}`,saleId,
    expectedSaleVersion:decoded.expectedSaleVersion,amountMinor:decoded.amountMinor,source:{projectOrigin:proof.projectOrigin,branchId:scope.branchId,terminalId:scope.terminalId,databaseGuid},
    payloadJson:decoded.payloadJson,attestation:proof,refundApproval:null,
    envelope:{version:2,route:"financial",operationJson:decoded.payloadJson,attestation:proof}};
}

// Reauthorizes the original operation only. It never runs refund/stock writes,
// changes a financial chain, or manufactures journal/acceptance records.
async function readPendingOriginal(manager, scope, saleId, operationId = null, transaction = null) {
  scope.assertCurrent();
  const request = () => transaction ? transaction.request() : manager.pool.request();
  await assertRefundStorageReady({request});
  // Match the financial writer's receipt -> head/origin -> sale order. The
  // first read locates evidence only; branch/sale authority is proven below.
  const located=(await request().input("sale",saleId).input("op",operationId).query(`
    SELECT TOP(2) operation_id,refund_evidence_json FROM dbo.local_operation_receipts WITH(UPDLOCK,HOLDLOCK)
    WHERE operation_type=N'refund' AND TRY_CONVERT(uniqueidentifier,entity_id)=TRY_CONVERT(uniqueidentifier,@sale)
      AND (@op IS NULL OR operation_id=TRY_CONVERT(uniqueidentifier,@op)) ORDER BY operation_id;`)).recordset??[];
  if(!located.length)return null;
  if(located.length!==1)throw refundHeld();
  let financial=located[0].refund_evidence_json==null;
  if(!financial)try {parseExactJson(located[0].refund_evidence_json,{maxBytes:6*1024*1024+64*1024,maxDepth:24});
    const value=JSON.parse(located[0].refund_evidence_json);financial=value?.version===2&&value.route==="financial";
  }catch{throw refundHeld();}
  const financialRows=financial?await lockFinancialOrigin(request,located[0],scope):null;
  const rows = (await request().input("sale", saleId).input("branch", scope.branchId).input("op", operationId).query(`
    SELECT TOP(2) r.operation_id,r.entity_id,r.note,r.refund_branch_id,r.refund_evidence_json,r.refund_acceptance_json,
      CONVERT(varchar(128),s.total_amount) total_amount,s.row_version,s.is_refunded,s.shift_id sale_shift_id,s.created_at sale_created_at,
      (SELECT COUNT_BIG(*) FROM dbo.sync_change_journal j WITH(UPDLOCK,HOLDLOCK)
        WHERE j.aggregate_id=r.operation_id AND j.branch_id=@branch AND j.acknowledged_at IS NULL) pending_count,
      (SELECT MAX(j.last_error) FROM dbo.sync_change_journal j WITH(UPDLOCK,HOLDLOCK)
        WHERE j.aggregate_id=r.operation_id AND j.branch_id=@branch AND j.acknowledged_at IS NULL) last_error
    FROM dbo.local_operation_receipts r WITH(UPDLOCK,HOLDLOCK)
    JOIN dbo.sales s WITH(UPDLOCK,HOLDLOCK) ON s.id=TRY_CONVERT(uniqueidentifier,r.entity_id) AND s.store_id=@branch
    WHERE r.operation_type=N'refund' AND s.id=TRY_CONVERT(uniqueidentifier,@sale)
      AND (@op IS NULL OR r.operation_id=TRY_CONVERT(uniqueidentifier,@op)) ORDER BY r.operation_id;`)).recordset ?? [];
  scope.assertCurrent();
  if (!rows.length) return null;
  if (rows.length !== 1) throw refundHeld();
  const row = rows[0];
  if (row.refund_acceptance_json !== null && row.refund_acceptance_json !== undefined) return null;
  if (!row.is_refunded || !Number.isSafeInteger(Number(row.pending_count)) || Number(row.pending_count) < 1) return null;
  const db = (await request().query("SELECT LOWER(CONVERT(varchar(36),database_guid)) database_guid FROM sys.database_recovery_status WHERE database_id=DB_ID();")).recordset ?? [];
  if(db.length!==1||typeof db[0].database_guid!=="string")throw refundHeld();
  let envelope=null;
  if(row.refund_evidence_json!=null)try {
    parseExactJson(row.refund_evidence_json, {maxBytes:6*1024*1024+64*1024,maxDepth:24});envelope = JSON.parse(row.refund_evidence_json);
  } catch { throw refundHeld(); }
  const id = recordId(row.operation_id);
  let result;
  if(row.refund_evidence_json==null){
    result=readLegacyFinancial(row,scope,saleId,db[0].database_guid,financialRows);envelope=result.envelope;
  }else if (envelope?.version === 2 && envelope.route === "financial") {
    const original=readLegacyFinancial(row,scope,saleId,db[0].database_guid,financialRows);
    const decoded = decodeFinancialRefundReceipt(envelope, {operationId:id,saleId,branchId:scope.branchId});
    if(decoded.payloadJson!==original.payloadJson||decoded.attestation.signature!==original.attestation.signature)throw refundHeld();
    result = {route:"financial",operationId:id,refundId:decoded.basis.refundKey,saleId,
      expectedSaleVersion:decoded.basis.expectedSaleVersion,amountMinor:decoded.basis.amountMinor,
      source:decoded.source,payloadJson:decoded.payloadJson,attestation:decoded.attestation,refundApproval:decoded.refundApproval};
  } else {
    const saved = savedRefund(row, scope.branchId);
    result = {route:"grouped",operationId:id,refundId:saved.command.refundKey,saleId,
      expectedSaleVersion:String(saved.command.expectedSaleVersion),amountMinor:amountMinor(row.total_amount),
      source:saved.scope,payloadJson:saved.refundJson,attestation:saved.attestation,refundApproval:saved.refundApproval};
  }
  if (result.saleId !== saleId || amountMinor(row.total_amount) !== result.amountMinor ||
      BigInt(String(row.row_version)) !== BigInt(result.expectedSaleVersion)+1n ||
      result.source.branchId !== scope.branchId || result.source.terminalId !== scope.terminalId) throw refundHeld();
  if (db[0].database_guid !== result.source.databaseGuid) throw refundHeld();
  let saleCreatedAt;
  try{if(row.sale_created_at==null)throw refundHeld();saleCreatedAt=normalizeRefundSaleCreatedAt(new Date(row.sale_created_at).toISOString());}catch{throw refundHeld();}
  if(result.refundApproval&&parseRefundApprovalJson(result.refundApproval.approvalJson).basis.saleCreatedAt!==saleCreatedAt)throw refundHeld();
  scope.assertCurrent();
  const held = /REFUND_APPROVAL_REQUIRED|APPROVAL_(?:DENIED|EXPIRED|REQUIRED)|original authorization/i.test(String(row.last_error ?? ""));
  return {...result,saleCreatedAt,branchId:scope.branchId,requiresApproval:!result.refundApproval || held,originalEvidence:row.refund_evidence_json,envelope};
}

function publicPendingStatus(pending) {
  if (!pending) return {ok:true,pending:false,requiresApproval:false};
  const {operationId,saleId,refundId,branchId,amountMinor:minor,expectedSaleVersion,route,requiresApproval}=pending;
  return {ok:true,pending:true,requiresApproval,operationId,saleId,refundId,branchId,amountMinor:minor,expectedSaleVersion,route};
}

async function attachPendingApproval(manager, {scope,saleId,operationId,admission,author}) {
  const sql=manager.sql(),tx=new sql.Transaction(manager.pool);
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  try {
    scope.assertCurrent();author.assertCurrent();
    const pending=await readPendingOriginal(manager,scope,saleId,operationId,tx);
    if (!pending) throw refundHeld();
    if(pending.refundApproval&&admission.matchesSavedEvidence(pending.refundApproval)){
      await admission.verify(tx,true);admission.assertCurrent();author.assertCurrent();scope.assertCurrent();
      await tx.commit();admission.complete();return {ok:true,operationId};
    }
    await admission.verify(tx,false);
    const refundApproval=await admission.captureEvidence(tx,{anchorKind:pending.route,payloadJson:pending.payloadJson,
      attestation:pending.attestation,source:pending.source,author,operationId,saleId,expectedSaleVersion:pending.expectedSaleVersion});
    const envelope=pending.route==="grouped"
      ? {version:2,route:"grouped",refundJson:pending.envelope.refundJson,attestation:pending.envelope.attestation,
        journal:pending.envelope.journal,refundApproval}
      : {version:2,route:"financial",operationJson:pending.envelope.operationJson,attestation:pending.envelope.attestation,refundApproval};
    await tx.request().input("op",operationId).input("branch",scope.branchId).input("before",pending.originalEvidence)
      .input("after",JSON.stringify(envelope)).query(`
      UPDATE dbo.local_operation_receipts SET refund_branch_id=@branch,refund_evidence_json=@after
      WHERE operation_id=@op AND operation_type=N'refund' AND (refund_branch_id=@branch OR refund_branch_id IS NULL) AND refund_acceptance_json IS NULL
        AND ((@before IS NULL AND refund_evidence_json IS NULL) OR CONVERT(varbinary(max),refund_evidence_json)=CONVERT(varbinary(max),@before));
      IF @@ROWCOUNT<>1 THROW 51042,'The original refund approval could not be saved.',1;`);
    admission.assertCurrent();author.assertCurrent();scope.assertCurrent();
    await tx.commit();admission.complete();return {ok:true,operationId};
  } catch(error) {await Promise.resolve(tx.rollback()).catch(()=>undefined);throw error;}
}
module.exports={readPendingOriginal,publicPendingStatus,attachPendingApproval};
