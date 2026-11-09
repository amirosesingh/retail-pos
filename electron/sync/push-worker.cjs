const {prepareFinancialOpening,prepareFinancialHistory,assertFinancialHistoryAcknowledgement}=require("./financial-history-ack.cjs");
const { recordId } = require("./uuid-fields.cjs");
const { retryDelay } = require("./retry.cjs");
const { stableUuid } = require("../db/repositories/aggregates.cjs");
const { ACTIVITY_TABLES } = require("./event-policy.cjs");
const { assertShiftClosureAcknowledgement } = require("./shift-closure-ack.cjs");
const {prepareShiftFinancialBasis,assertShiftFinancialAcknowledgement}=require("./shift-financial-ack.cjs");
const cashRoute = require("./cash-checkout-route.cjs");
const refundRoute = require("./grouped-refund-native.cjs");

function groupBy(values, key) {
  const groups = new Map();
  for (const value of values) {
    const name = key(value);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(value);
  }
  return groups;
}

async function uploadRows(table, rows) {
  if (table !== "activity_events") return rows;
  const { unconfirmedShiftClosureActivityRow } = await import("../shift-closure-activity.mjs");
  // A local audit event can upload independently of its shift transaction.
  // Never turn that report into proof that the central closure was saved.
  return rows.map(unconfirmedShiftClosureActivityRow);
}

function collapseChanges(changes) {
  const latest = new Map();
  for (const change of changes)
    latest.set(`${change.entity_type}\u0000${change.entity_id}`, change);
  return [...latest.values()];
}

function assertBatchAcknowledgement(acknowledgement, batchId) {
  if (acknowledgement?.ok === false)
    throw new Error(acknowledgement?.error ?? "Cloud did not acknowledge the upload.");
  // A replay may omit the applied count, and a valid versioned no-op may return zero.
  if (acknowledgement?.ok !== true || recordId(acknowledgement.batch_id) !== recordId(batchId))
    throw Object.assign(new Error("The cloud did not confirm this upload batch. Saved changes remain pending."), {
      code: "ESYNC_ACK_UNCONFIRMED",
    });
}

const SHIFT_GRAPH_TABLES = new Set(["shifts", "shift_cash_counts", "shift_reconciliations",
  "shift_close_events", "shift_notifications", "shift_variance_alerts"]);

/** Bind each CLOSED parent to the current count graph before hashing/sending.
 * Older journal groups must not pair a later recount parent with original-only
 * children. Only their queue IDs are acknowledged, even when rows are enriched. */
async function includeClosedShiftGraphs(operations, reader, registry, branchId) {
  const closed = operations.flatMap(operation => operation.table === "shifts" && !operation.deletePhase
    ? (operation.rows ?? []).filter(row => String(row.status ?? "").toUpperCase() === "CLOSED" ||
      String(row.state ?? "").toUpperCase() === "CLOSED" ||
      (row.closed_at !== null && row.closed_at !== undefined && row.closed_at !== "")) : []);
  if (!closed.length) return false;
  const branch = recordId(branchId);
  const ids = new Set(closed.map(row => recordId(row.id)));
  const fail = () => { throw Object.assign(new Error("The current shift closure graph is unavailable; its upload remains pending."), {
    code: "ESHIFT_CLOSURE_SNAPSHOT", table: "shifts",
  }); };
  if (ids.size !== closed.length || closed.some(row => !row.id || recordId(row.store_id) !== branch) ||
      typeof reader.closedShiftGraphs !== "function") fail();
  const graphs = await reader.closedShiftGraphs(branch, [...ids]);
  if (!Array.isArray(graphs)) fail();
  const captured = new Map();
  for (const graph of graphs) {
    if (!SHIFT_GRAPH_TABLES.has(graph?.table) || captured.has(graph.table) || !Array.isArray(graph.rows)) fail();
    const seen = new Set();
    for (const row of graph.rows) {
      const key = recordId(row?.id);
      if (!key || seen.has(key) || recordId(row.store_id) !== branch ||
          !ids.has(recordId(graph.table === "shifts" ? row.id : row.shift_id))) fail();
      seen.add(key);
    }
    captured.set(graph.table, graph.rows);
  }
  if ([...SHIFT_GRAPH_TABLES].some(table => !captured.has(table))) fail();
  const parents = captured.get("shifts");
  if (parents.length !== ids.size || parents.some(row => row.status !== "CLOSED" || row.state !== "CLOSED" ||
      !row.closed_at || !Number.isSafeInteger(Number(row.row_version)) || Number(row.row_version) < 1)) fail();
  for (const id of ids) {
    const counts = new Set(captured.get("shift_cash_counts").filter(row => recordId(row.shift_id) === id).map(row => recordId(row.id)));
    if (!counts.size || !captured.get("shift_reconciliations").some(row => recordId(row.shift_id) === id && counts.has(recordId(row.count_id)))) fail();
  }
  for (const [table, rows] of captured) {
    const existing = operations.find(operation => operation.table === table && !operation.deletePhase);
    if (existing) existing.rows = [...(existing.rows ?? []).filter(row =>
      !ids.has(recordId(table === "shifts" ? row.id : row.shift_id))), ...rows];
    else if (rows.length) {
      const metadata = registry.tables.find(item => item.cloudTable === table);
      if (!metadata) fail();
      operations.push({ table, rows, deletePhase: false, changes: [], dependencyOrder: metadata.dependencyOrder });
    }
  }
  return true;
}

// Batch only independent log writes. Sales, payments and mixed transactions
// retain their original atomic boundary and idempotency key.
function batchAuditAggregates(aggregates, limit = 100) {
  const result = [];
  let group = [];
  let rows = 0;
  const flush = () => {
    if (group.length === 1) result.push(group[0]);
    else if (group.length) result.push({
      aggregateId: stableUuid({ auditAggregates: group.map(item => item.aggregateId) }),
      changes: group.flatMap(item => item.changes),
      originals: group,
    });
    group = []; rows = 0;
  };
  for (const aggregate of aggregates) {
    const audit = aggregate.changes.length > 0 && aggregate.changes.every(change =>
      ["audit_logs", "activity_events"].includes(change.entity_type) && ["insert", "update"].includes(change.operation));
    if (!audit || rows + aggregate.changes.length > limit) flush();
    if (!audit) result.push(aggregate);
    else { group.push(aggregate); rows += aggregate.changes.length; }
  }
  flush();
  return result;
}

/**
 * Older desktop builds could commit a branch-owned row before its branch
 * column was projected. SQL Server also compares text identifiers without
 * case or trailing-space sensitivity under the supported collation, while
 * PostgreSQL's sync guard compares them exactly. The local database belongs
 * to one registered branch, so repair a missing or SQL-equivalent value at
 * the upload boundary. A genuinely different non-empty branch remains
 * rejected as possible cross-branch corruption.
 */
function rowsForBranch(table, rows, branchId) {
  const tableName = typeof table === "string" ? table : table?.cloudTable;
  const columns = new Set((typeof table === "string" ? [] : table?.columns ?? []).map((column) => column.cloudColumn));
  const branchColumn = typeof table === "string"
    ? tableName === "sale_items" ? "branch_id" : tableName === "audit_logs" ? "store_id" : null
    : table?.scope === "branch" && table?.direction !== "pull"
      ? columns.has("store_id") ? "store_id" : columns.has("branch_id") ? "branch_id" : null
      : null;
  if (!branchColumn) return rows;
  const authoritative = recordId(String(branchId ?? "").trim());
  return rows.map((row) => {
    const supplied = String(row?.[branchColumn] ?? "").trim();
    const equivalent =
      !supplied || recordId(supplied) === authoritative;
    return equivalent ? { ...row, [branchColumn]: authoritative } : row;
  });
}

function changeKey(change) {
  if (change?.key && typeof change.key === "object") return change.key;
  const encoded = change?.entityId ?? change?.entity_id;
  if (typeof encoded !== "string") return {};
  try {
    return JSON.parse(encoded);
  } catch {
    return {};
  }
}

function isSharedPosFieldChange(change) {
  const key = changeKey(change);
  return String(key.scope ?? "").toLowerCase() === "global" &&
    String(key.scope_id ?? "") === "" &&
    String(key.key ?? "").startsWith("pos_field:");
}

/** A child-only retry must carry its locally owned parent into the same cloud transaction. */
async function includeMissingParents(operations, reader, registry, branchId, {exactFinancial=false}={}) {
  branchId = recordId(branchId);
  const completed = (operations.find(op => op.table === "held_orders" && !op.deletePhase)?.rows ?? []).filter(row => row.status === "completed");
  if (completed.length) {
    const parents = await reader.ticketCompletionParents(completed, branchId);
    for (const parent of parents) {
      const existing = operations.find(op => op.table === parent.table && !op.deletePhase);
      if (existing) existing.rows.push(...parent.rows.filter(row => !existing.rows.some(saved => saved.id === row.id)));
      else operations.push({table: parent.table, rows: parent.rows, deletePhase: false, changes: [], dependencyOrder: registry.tables.find(table => table.cloudTable === parent.table).dependencyOrder});
    }
  }
  for (const [childName, parentName, foreignKey, belongs] of [
    ["booking_payments", "bookings", "booking_id", (row) => row.store_id === branchId],
    ["payment_transactions", "bookings", "booking_id", (row) => row.store_id === branchId],
    ["payment_transactions", "sales", "sale_id", (row) => row.store_id === branchId],
    ["purchase_order_items", "purchase_orders", "po_id", (row) => row.store_id === branchId],
    ["sale_items", "sales", "sale_id", (row) => row.store_id === branchId],
    ["stock_transfer_items", "stock_transfers", "transfer_id", (row) =>
      row.from_store_id === branchId || row.to_store_id === branchId],
  ]) {
    const children = operations.find((op) => op.table === childName && !op.deletePhase);
    if (!children?.rows?.length) continue;
    const parent = operations.find((op) => op.table === parentName && !op.deletePhase);
    const present = new Set((parent?.rows ?? []).map((row) => String(row.id)));
    const ids = [...new Set(children.rows.map((row) => String(row[foreignKey] ?? "")))]
      .filter((id) => id && !present.has(id));
    if (!ids.length) continue;
    const table = registry.tables.find((item) => item.cloudTable === parentName);
    const rows = rowsForBranch(table,
      await reader.rows(table, ids.map((id) => ({ key: { id } })), { branchId,exactFinancial }), branchId);
    const found = new Set(rows.filter(belongs).map((row) => String(row.id)));
    if (ids.some((id) => !found.has(id)))
      throw Object.assign(new Error(`${childName} has no ${parentName} parent in this terminal branch.`), {
        code: "SYNC_BRANCH_FORBIDDEN", table: childName,
      });
    if (parent) parent.rows.push(...rows);
    else operations.push({ table: parentName, dependencyOrder: table.dependencyOrder,
      deletePhase: false, changes: [], rows });
  }
}

/**
 * Global and cluster settings are normally read-only cache entries on a
 * terminal. The one exception is a pos_field:* settings_scoped row: explicit
 * settings saves use those rows for source-neutral, field-level conflict
 * resolution. Old databases can expose other rows downloaded before the CLOUD
 * change-tracking context was introduced as local changes; do not upload them
 * or cached rows belonging to a previous branch/terminal. Unknown scope types
 * remain in the batch so the server rejects malformed writes.
 */
function terminalWritableChanges(tableName, changes, { branchId = "", terminalId = "" } = {}) {
  branchId = recordId(branchId);
  terminalId = recordId(terminalId);
  if (!["settings_overrides", "settings_scoped"].includes(tableName)) return changes;
  return changes.filter((change) => {
    const key = changeKey(change);
    const scope = String(key.scope ?? "")
      .trim()
      .toLowerCase();
    const scopeId = recordId(String(key.scope_id ?? "").trim());
    const fieldWrite =
      tableName === "settings_scoped" &&
      scope === "global" &&
      String(key.key ?? "").startsWith("pos_field:");
    if (["global", "cluster"].includes(scope) && !fieldWrite) return false;
    if (scope === "branch" && branchId && scopeId !== branchId) return false;
    if (scope === "terminal" && terminalId && scopeId !== terminalId) return false;
    return true;
  });
}

class PushWorker {
  constructor({ reader, cloud, checkpoints, registry, validateAuthor, validateClosingStart, validateFinancialBasis, financialHistoryEnabled=false, validateFinancialOperation,
    uploadCashCheckout = null, uploadGroupedRefund = null }) {
    this.financialHistoryEnabled=financialHistoryEnabled===true;
    this.validateFinancialOperation=validateFinancialOperation;
    this.validateAuthor = validateAuthor;
    this.validateClosingStart = validateClosingStart;
    this.validateFinancialBasis = validateFinancialBasis;
    this.reader = reader;
    this.cloud = cloud;
    this.checkpoints = checkpoints;
    this.registry = registry;
    this.uploadCashCheckout = uploadCashCheckout;
    this.uploadGroupedRefund = uploadGroupedRefund;
  }
  async assertLegacyCashWrites(branchId, operations) {
    if (this.reader.assertLegacyCashWrites) {
      const keys = operations.flatMap(({ table, rows, changes }) => cashRoute.cashRowKeys(table, [...(rows ?? []), ...(changes ?? [])]));
      if (keys.length) await this.reader.assertLegacyCashWrites(branchId, keys);
    }
    if (this.reader.assertLegacyRefundWrites) {
      const keys = operations.flatMap(({ table, rows, changes }) => refundRoute.refundKeys(table, [...(rows ?? []), ...(changes ?? [])]));
      if (keys.length) await this.reader.assertLegacyRefundWrites(branchId, keys);
    }
  }
  async retry(work) {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        return await work();
      } catch (error) {
        // A full request timeout has already spent the network deadline.
        // Leave it to the durable scheduler rather than block this pass for
        // another four deadlines and keep login/focus callers waiting.
        if (error?.code === "ETIMEDOUT" || ["TimeoutError","AbortError"].includes(error?.name)) throw error;
        if (/^(?:ESYNC_SHIFT_AUTHOR_|ESHIFT_AUTHOR_)/.test(String(error?.code??""))) throw error;
        // A semantic closing conflict needs review, not five immediate retries
        // of the same immutable facts (even if a gateway reports it as 500).
        if ([error?.code, error?.message].some(value =>
          /^SYNC_SHIFT_CLOSURE_(CONFLICT|DUPLICATE)$/.test(String(value ?? "")))) throw error;
        const status = Number(error?.status ?? 0);
        const retryable = status === 408 || status === 429 || status >= 500 ||
          ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "TimeoutError", "AbortError"].includes(error?.code ?? error?.name) ||
          error instanceof TypeError || (!status && !error?.code);
        if (!retryable) throw error;
        if (attempt === 5) throw error;
        await new Promise((resolve) => setTimeout(resolve, retryDelay(attempt, { maxMs: 5000 })));
      }
    }
    throw new Error("The synchronization retry loop ended unexpectedly.");
  }
  async registerFinancialHistory(branchId,terminalId,onProgress){
    if(!this.financialHistoryEnabled)return;
    const seen=new Set();
    for(let page=0;page<100;page++){
      const items=await this.reader.financialHistory?.(branchId,terminalId,100)??[];if(!items.length)return;
      for(const raw of items){
        const item=prepareFinancialHistory(raw,branchId,terminalId),key=item.shiftId+':'+item.operationId+':'+item.payloadHash;
        if(seen.has(key))throw Object.assign(new Error('The metadata receipt was not persisted. Work remains pending.'),{code:'EFINANCIAL_HISTORY_UNCONFIRMED',table:'shifts'});seen.add(key);
        let ack;
        if(item.kind==='MUTATION'){
          const proof=this.validateFinancialOperation?this.validateFinancialOperation(item.proof):item.proof;
          ack=await this.retry(()=>this.cloud.pushFinancialEvent({branchId,operationJson:item.payloadJson,proof}));
        }else if(item.kind==='OBSERVE'){
          ack=await this.retry(()=>this.cloud.pushFinancialObservation({branchId,operationJson:item.payloadJson}));
        }else{
          const intent=item.intent,shiftAuthor=this.validateAuthor?this.validateAuthor(intent.shiftAuthor):intent.shiftAuthor;
          const shiftClosingStart=intent.shiftClosingStart&&(this.validateClosingStart?this.validateClosingStart(intent.shiftClosingStart):intent.shiftClosingStart);
          let financial=prepareShiftFinancialBasis(intent,branchId,shiftAuthor);
          if(financial&&this.validateFinancialBasis)financial=prepareShiftFinancialBasis({...intent,shiftFinancialBasis:{basisJson:financial.basisJson,proof:this.validateFinancialBasis(financial.proof)}},branchId,shiftAuthor);
          const shiftIntent={version:intent.version,intentId:intent.intentId,shiftId:intent.shiftId,kind:intent.kind,baseToken:intent.baseToken,predecessorIntentId:intent.predecessorIntentId,predecessorIntentHash:intent.predecessorIntentHash,payloadJson:intent.payloadJson};
          ack=await this.retry(()=>this.cloud.registerFinancialBoundary({batchId:intent.intentId,branchId,shiftIntent,shiftAuthor,...(shiftClosingStart?{shiftClosingStart}:{}),shiftFinancialBasis:financial}));
        }
        assertFinancialHistoryAcknowledgement(item,ack);
        if(typeof this.reader.acknowledgeFinancialHistory!=='function')throw Object.assign(new Error('Durable financial metadata acknowledgements are unavailable.'),{code:'EFINANCIAL_HISTORY_UNCONFIRMED',table:'shifts'});
        await this.reader.acknowledgeFinancialHistory(item,ack);
        onProgress({direction:'push',table:'financial_history_metadata',completed:1});
      }
    }
  }
  async pushAggregates(branchId, batchSize, isolate = false, onProgress = () => {}, includeActivity = true) {
    branchId = recordId(branchId);
    this.pushErrors = []; this.blockedTables = new Set();
    this.cashUploadHeld = null;
    this.refundUploadHeld = null;
    let pushed = 0;
    const terminalId = this.cloud.terminalId?.() ?? "";
    await this.registerFinancialHistory(branchId,terminalId,onProgress);
    const deferred = new Set();
    const protectedSettings = new Set(["pos_settings", "pos_store_settings",
      "authorization_actions", "authorization_action_history"]);
    // Read and acknowledge one bounded page at a time until the durable
    // journal is caught up. The old implementation stopped after one page,
    // so a final shift-close sync could report success while later committed
    // sales were still waiting for the next timer tick.
    while (true) {
      const aggregates = batchAuditAggregates(await this.reader.pendingAggregates(branchId, batchSize, [...deferred], { includeActivity }), batchSize);
      if (!aggregates.length) break;
      for (const aggregate of aggregates) {
      const originalIds = (aggregate.originals ?? [aggregate]).map(item => item.aggregateId);
      try {
      if (originalIds.length === 1 && aggregate.changes.some(change => change.entity_type === "sales")) {
        const refund = await this.reader.readRefundRoute?.(branchId, originalIds[0]);
        if (refund) {
          if (await this.uploadGroupedRefund?.(refund) !== true) throw refundRoute.refundHeld();
          pushed += aggregate.changes.length;
          onProgress({ direction: "push", table: "sales", completed: aggregate.changes.length });
          continue;
        }
      }
      // The immutable capture owns delivery even when the installed pilot is
      // paused or removed. Do not rebuild its journal into a second writer.
      if (aggregate.changes.some(change => cashRoute.TABLES.includes(change.entity_type))) {
        if (originalIds.length !== 1) throw cashRoute.fail();
        const cash = await this.reader.readCashRoute?.(branchId, originalIds[0]);
        if (cash) {
          const result = await this.uploadCashCheckout?.(cash);
          if (result !== true) {
            this.cashUploadHeld ??= result || cashRoute.uploadHold();
            deferred.add(aggregate.aggregateId);
          } else {
            pushed += aggregate.changes.length;
            onProgress({ direction: "push", table: "sales", completed: aggregate.changes.length });
          }
          continue;
        }
      }
      if (aggregate.changes.some(change => this.blockedTables.has(change.entity_type))) {
        originalIds.forEach(id => deferred.add(id)); continue;
      }
      const financialRequired=await this.reader.financialAggregateRequired?.(aggregate.aggregateId,branchId,terminalId)??false;
      const financialOpening=await this.reader.financialOpening?.(aggregate.aggregateId,branchId,terminalId)??null;
      if((financialRequired||financialOpening)&&!this.financialHistoryEnabled)throw Object.assign(new Error('The matching financial history capability is required. Saved work remains pending.'),{code:'EFINANCIAL_PROTOCOL_UNAVAILABLE',table:'shifts'});
      await this.registerFinancialHistory(branchId,terminalId,onProgress);
      const intent=await this.reader.protectedIntent?.(aggregate.aggregateId,branchId);
      if(intent){
        if(financialRequired && this.reader.financialHistoryReady && !await this.reader.financialHistoryReady(branchId,terminalId,{shiftId:intent.shiftId})){deferred.add(aggregate.aggregateId);continue;}
        if(originalIds.length!==1 || recordId(originalIds[0])!==recordId(intent.intentId))throw Object.assign(new Error("A protected closing intent cannot be combined with another transaction."),{code:"EIDEMPOTENCY",table:"shifts"});
        if(intent.financialRequired===true && (!intent.shiftFinancialBasis || !intent.shiftFinancialBasis.proof))
          prepareShiftFinancialBasis(intent,branchId);
        if((this.reader.predecessorAccepted && !await this.reader.predecessorAccepted(intent)) ||
          (this.reader.shiftPrerequisites && !await this.reader.shiftPrerequisites(intent))){
          deferred.add(aggregate.aggregateId);continue;
        }
        const shiftIntent={version:intent.version,intentId:intent.intentId,shiftId:intent.shiftId,kind:intent.kind,
          baseToken:intent.baseToken,predecessorIntentId:intent.predecessorIntentId,predecessorIntentHash:intent.predecessorIntentHash,payloadJson:intent.payloadJson};
        const shiftAuthor=this.validateAuthor?this.validateAuthor(intent.shiftAuthor):intent.shiftAuthor;
        const shiftClosingStart=intent.shiftClosingStart && (this.validateClosingStart?this.validateClosingStart(intent.shiftClosingStart):intent.shiftClosingStart);
        let shiftFinancialBasis=prepareShiftFinancialBasis(intent,branchId,shiftAuthor);
        if(shiftFinancialBasis && this.validateFinancialBasis){
          const verified=this.validateFinancialBasis(shiftFinancialBasis.proof);
          shiftFinancialBasis=prepareShiftFinancialBasis({...intent,shiftFinancialBasis:{basisJson:shiftFinancialBasis.basisJson,proof:verified}},branchId,shiftAuthor);
        }
        const acknowledgement=await this.retry(()=>this.cloud.pushAggregate({batchId:intent.intentId,branchId,shiftIntent,...(shiftAuthor?{shiftAuthor}:{}),...(shiftClosingStart?{shiftClosingStart}:{}),...(shiftFinancialBasis?{shiftFinancialBasis}:{})}));
        if(!acknowledgement?.ok)throw new Error(acknowledgement?.error??"Cloud did not acknowledge the closing intent.");
        const proof=assertShiftClosureAcknowledgement(acknowledgement,intent.operations,branchId,intent,this.registry);
        assertShiftFinancialAcknowledgement(acknowledgement,intent,shiftFinancialBasis);
        await this.reader.acknowledgeProtectedIntent(intent,proof);
        pushed+=aggregate.changes.length;
        onProgress({direction:"push",table:intent.operations.map(operation=>operation.table).join(", "),completed:aggregate.changes.length});
        continue;
      }
      if(financialRequired && this.reader.financialHistoryReady && !await this.reader.financialHistoryReady(branchId,terminalId,{aggregateId:aggregate.aggregateId})){deferred.add(aggregate.aggregateId);continue;}
      const requiresSettingsProof = aggregate.changes.some((change) =>
        protectedSettings.has(change.entity_type) ||
        (change.entity_type === "settings_scoped" && isSharedPosFieldChange(change)));
      if (requiresSettingsProof && !this.cloud.hasAuthorizationProof?.()) {
        deferred.add(aggregate.aggregateId);
        continue;
      }
      const operations = [];
      const openingRows=aggregate.changes.some(change=>change.entity_type==="shifts")
        ? await this.reader.frozenOpeningRows?.(aggregate.aggregateId,branchId)??[]:[];
      const openings=new Map(openingRows.map(row=>[recordId(row.id),row]));
      let coveredLegacy=0,waitingForIntent=false;
      const finalChanges = collapseChanges(aggregate.changes);
      for (const [tableName, changes] of groupBy(finalChanges, (change) => change.entity_type)) {
        const table = this.registry.tables.find((item) => item.sqlServerTable === tableName);
        if (!table) throw new Error(`The aggregate references unregistered table ${tableName}.`);
        const writable = terminalWritableChanges(table.cloudTable, changes, {
          branchId,
          terminalId,
        });
        const live = writable.filter((change) => change.operation !== "delete");
        const removed = writable.filter((change) => change.operation === "delete");
        if (live.length)
          operations.push({
            table: table.cloudTable,
            dependencyOrder: table.dependencyOrder,
            deletePhase: false,
            changes: live,
            rows: await uploadRows(table.cloudTable, rowsForBranch(
              table,
              (await this.reader.rows(table, live, { branchId,exactFinancial:financialRequired })).map(row=>table.cloudTable==="shifts" ? openings.get(recordId(row.id))??row:row),
              branchId,
            )),
          });
        if (removed.length)
          operations.push({
            table: table.cloudTable,
            dependencyOrder: table.dependencyOrder,
            deletePhase: true,
            changes: removed,
            rows: [],
          });
      }
      for(const operation of operations){
        if(!SHIFT_GRAPH_TABLES.has(operation.table) || operation.deletePhase)continue;
        const table=this.registry.tables.find(table=>table.cloudTable===operation.table);
        const candidates=operation.rows.filter(row=>!(operation.table==="shifts"&&openings.has(recordId(row.id))));
        const managed=await this.reader.protectedShiftIds?.(candidates.map(row=>recordId(operation.table==="shifts"?row.id:row.shift_id)),branchId)??new Set();
        const rows=candidates.filter(row=>managed.has(recordId(operation.table==="shifts"?row.id:row.shift_id)));
        if(!rows.length)continue;
        const covered=await this.reader.acceptedShiftChanges?.(table,rows.map(row=>({key:{id:row.id},operation:"U"})),branchId)??new Set();
        if(rows.some(row=>!covered.has(recordId(row.id))))waitingForIntent=true;
        coveredLegacy+=covered.size;
        operation.rows=operation.rows.filter(row=>!covered.has(recordId(row.id)));
        operation.changes=operation.changes.filter(change=>!covered.has(recordId(changeKey(change).id)));
      }
      if(waitingForIntent){originalIds.forEach(id=>deferred.add(id));continue;}
      for(let index=operations.length-1;index>=0;index--)if(!operations[index].rows.length&&!operations[index].changes.length)operations.splice(index,1);
      try {
        await includeMissingParents(operations, this.reader, this.registry, branchId,{exactFinancial:financialRequired});
        await includeClosedShiftGraphs(operations, this.reader, this.registry, branchId);
      } catch (error) {
        throw error;
      }
      if (!operations.length) {
        if (!coveredLegacy && finalChanges.some((change) => !["settings_overrides", "settings_scoped"].includes(change.entity_type) ||
          !["global", "cluster"].includes(String(changeKey(change).scope ?? "").toLowerCase())))
          throw new Error("The aggregate has no writable rows and cannot be acknowledged safely.");
        await this.reader.acknowledgeAggregate(aggregate.aggregateId);
        continue;
      }
      operations.sort((a, b) =>
        a.deletePhase === b.deletePhase
          ? a.deletePhase
            ? b.dependencyOrder - a.dependencyOrder
            : a.dependencyOrder - b.dependencyOrder
          : a.deletePhase
            ? 1
            : -1,
      );
      if (Buffer.byteLength(JSON.stringify(operations), "utf8") > 6 * 1024 * 1024)
        throw Object.assign(new Error("One business aggregate exceeds the 6 MiB sync limit."), {
          code: "EOVERSIZED",
        });
      await this.assertLegacyCashWrites(branchId, operations);
      try {
        // Journal IDs identify local transactions, but uploads read current
        // rows. A later pass can therefore have a different payload after an
        // ambiguous timeout. Bind the cloud receipt to the actual snapshot;
        // unchanged retries still replay, and newer revisions get a new key.
        let openingSidecar;
        if(financialOpening){
          const verified=prepareFinancialOpening(financialOpening,branchId,terminalId);
          if(operations.length!==1||operations[0].table!=='shifts'||operations[0].deletePhase||operations[0].rows.length!==1||recordId(operations[0].rows[0].id)!==verified.shiftId)throw Object.assign(new Error('The protected opening requires its exact original business group.'),{code:'EFINANCIAL_HISTORY_INVALID',table:'shifts'});
          openingSidecar={openingJson:verified.openingJson,proof:verified.proof};
        }
        const batchId = stableUuid({ branchId, aggregateId: aggregate.aggregateId, operations });
        const financialCoverageToken=financialRequired?this.reader.prepareFinancialBusinessCoverage?.({operations,batchId,branchId,terminalId}):null;
        const acknowledged = await this.retry(() =>
          this.cloud.pushAggregate({ batchId, branchId, operations,...(openingSidecar?{shiftFinancialOpening:openingSidecar}:{}),...(financialRequired?{financialLedgerProjection:true}:{}) }),
        );
        assertBatchAcknowledgement(acknowledged, batchId);
        assertShiftClosureAcknowledgement(acknowledged, operations, branchId);
        if(financialRequired)await this.reader.acknowledgeFinancialBusinessRows?.({token:financialCoverageToken,operations,batchId,acknowledgement:acknowledged,branchId,terminalId});
        if(financialOpening){if(typeof this.reader.acknowledgeFinancialOpening!=='function')throw Object.assign(new Error('The opening acknowledgement cannot be persisted.'),{code:'EFINANCIAL_HISTORY_UNCONFIRMED',table:'shifts'});await this.reader.acknowledgeFinancialOpening(financialOpening,acknowledged,branchId,terminalId);}
        for (const id of originalIds) await this.reader.acknowledgeAggregate(id);
        pushed += aggregate.changes.length;
        onProgress({ direction: "push", table: operations.map(op => op.table).join(", "), completed: aggregate.changes.length });
      } catch (error) {
        if (requiresSettingsProof && error?.code === "GOVERNANCE_AUTH_REQUIRED") {
          deferred.add(aggregate.aggregateId);
          continue;
        }
        throw error;
      }
      } catch(error) {
        if (["ESYNC_REFUND_REVIEW_REQUIRED", "ESYNC_REFUND_APPROVAL_REQUIRED"].includes(error?.code)) {
          this.refundUploadHeld ??= { code: error.code, table: "sales", message: error.message };
          originalIds.forEach(id => deferred.add(id));
          continue;
        }
        if (error?.code === "ESYNC_CASH_ROUTE_HELD") {
          this.cashUploadHeld ??= cashRoute.uploadHold();
          originalIds.forEach(id => deferred.add(id));
          continue;
        }
        // Fall back for a payload rejection, not network/auth/database failures.
        if (aggregate.originals && (error?.code === "EOVERSIZED" ||
          [400,413,422].includes(Number(error?.status)))) {
          aggregates.push(...aggregate.originals);
          continue;
        }
        // An aggregate is atomic: the first table is not necessarily the one
        // whose trigger rejected it. Preserve a server-supplied table; otherwise
        // identify every affected table rather than blaming its first product.
        error.tables ??= [...new Set(aggregate.changes.map(change => change.entity_type).filter(Boolean))];
        error.table ??= "transaction batch";
        for (const id of originalIds) await this.reader.failAggregate(id, error);
        if (!isolate || [401,403].includes(Number(error?.status))) throw error;
        originalIds.forEach(id => deferred.add(id));
        for (const change of aggregate.changes) this.blockedTables.add(change.entity_type);
        this.pushErrors.push(error);
      }
      }
      if (deferred.size >= 2000) break;
    }
    return pushed;
  }
  async run({ branchId, batchSize = 500, onProgress = () => {}, includeActivity = true }) {
    branchId = recordId(branchId);
    if (!branchId) throw new Error("A branch is required for synchronization.");
    batchSize = Math.max(100, Math.min(2000, Number(batchSize) || 500));
    const terminalId = this.cloud.terminalId?.() ?? "";
    let pushed = await this.pushAggregates(branchId, batchSize, true, onProgress, includeActivity);
    let cashUploadHeld = this.cashUploadHeld;
    let refundUploadHeld = this.refundUploadHeld;
    const deferredTables = new Set();
    let historyUploadHeld=null;
    let financialCoverageAdvanced=false;
    // One lookup per pass instead of one SQL round trip for every table.
    const savedCheckpoints = this.checkpoints.list
      ? new Map((await this.checkpoints.list(branchId, "push")).map(row => [row.entity_type, row]))
      : null;
    const governance = new Set([
      "pos_settings",
      "pos_store_settings",
      "authorization_actions",
      "authorization_action_history",
    ]);
    const governanceOrder = (table) =>
      table.cloudTable === "pos_store_settings"
        ? 1
        : table.cloudTable === "authorization_actions"
          ? 2
          : table.cloudTable === "authorization_action_history"
            ? 3
            : 0;
    for (const table of [...this.registry.tables].sort(
      (a, b) =>
        governanceOrder(a) - governanceOrder(b) ||
        a.dependencyOrder - b.dependencyOrder ||
        a.cloudTable.localeCompare(b.cloudTable),
    )) {
      if (table.direction === "pull") continue;
      if (!includeActivity && ACTIVITY_TABLES.has(table.cloudTable)) continue;
      if (this.blockedTables.has(table.sqlServerTable) || table.columns.some(column =>
        column.foreignKeyTarget && this.blockedTables.has(column.foreignKeyTarget.table))) {
        this.blockedTables.add(table.sqlServerTable); continue;
      }
      try {
      if (!table.columns.some((column) => column.primaryKey)) continue;
      // Governance changes remain safely committed in SQL Server until a
      // currently verified settings administrator is available to upload them.
      let checkpoint = savedCheckpoints
        ? savedCheckpoints.get(table.sqlServerTable)
        : await this.checkpoints.get(branchId, table.sqlServerTable, "push");
      while (true) {
        const window = await this.reader.changedIds(
          table,
          checkpoint?.change_tracking_version ?? 0,
          batchSize,
        );
        if (!window.length) break;
        const tagged = window.filter(change => change.cashCheckoutId);
        const cashCovered = tagged.length
          ? await this.reader.cashTrackingCoverage?.(branchId, table.sqlServerTable, tagged)
          : null;
        if (tagged.length && !tagged.every(change => cashCovered?.has(change))) throw cashRoute.fail();
        const refundTagged = window.filter(change => change.refundId);
        const refundCovered = refundTagged.length
          ? await this.reader.refundTrackingCoverage?.(branchId, table.sqlServerTable, refundTagged)
          : null;
        if (refundTagged.length && !refundTagged.every(change => refundCovered?.has(change))) throw refundRoute.refundHeld();
        let changes = terminalWritableChanges(
          table.cloudTable,
          window.filter((change) => !change.remote && !cashCovered?.has(change) && !refundCovered?.has(change)),
          { branchId, terminalId },
        );
        // A v3 receipt proves only the exact frozen saved facts. A stale CT
        // copy of those facts must not be enriched/re-uploaded as a new close
        // after a later web correction. Different edits and deletes stay queued.
        const covered=await this.reader.acceptedShiftChanges?.(table,changes,branchId)??new Set();
        changes=changes.filter(change=>!covered.has(recordId(String(change.key?.id??""))));
        const financialCovered=await this.reader.acceptedFinancialBusinessChanges?.(table,changes,branchId,terminalId)??new Set();
        if(financialCovered.size)financialCoverageAdvanced=true;
        changes=changes.filter(change=>!financialCovered.has(recordId(String(change.key?.id??""))));
        if (!changes.length) {
          const version = Math.max(...window.map((row) => Number(row.version)));
          await this.checkpoints.save(branchId, table.sqlServerTable, "push", {
            change_tracking_version: version,
          });
          checkpoint = { ...(checkpoint ?? {}), change_tracking_version: version };
          continue;
        }
        const requiresSettingsProof = table.cloudTable === "settings_scoped" &&
          changes.some(isSharedPosFieldChange);
        if ((governance.has(table.cloudTable) || requiresSettingsProof) && !this.cloud.hasAuthorizationProof?.()) {
          deferredTables.add(table.cloudTable); break;
        }
        let live = changes.filter((change) => change.operation !== "D");
        let rows = await uploadRows(table.cloudTable, rowsForBranch(
          table,
          await this.reader.rows(table, live, { branchId }),
          branchId,
        ));
        if(SHIFT_GRAPH_TABLES.has(table.cloudTable)){
          const managed=await this.reader.protectedShiftIds?.(rows.map(row=>recordId(table.cloudTable==="shifts"?row.id:row.shift_id)),branchId)??new Set();
          if(rows.some(row=>managed.has(recordId(table.cloudTable==="shifts"?row.id:row.shift_id)))){
            deferredTables.add(table.cloudTable);break;
          }
        }
        while (Buffer.byteLength(JSON.stringify({ changes, rows }), "utf8") > 6 * 1024 * 1024) {
          const versions = [...new Set(changes.map((change) => Number(change.version)))];
          if (versions.length <= 1)
            throw Object.assign(
              new Error(`One ${table.cloudTable} transaction exceeds the 6 MiB sync limit.`),
              { code: "EOVERSIZED" },
            );
          const last = versions.at(-1);
          changes = changes.filter((change) => Number(change.version) !== last);
          live = changes.filter((change) => change.operation !== "D");
          rows = await uploadRows(table.cloudTable, rowsForBranch(
            table,
            await this.reader.rows(table, live, { branchId }),
            branchId,
          ));
        }
        // Change-tracking recovery also runs for transactions created by older
        // builds. Carry dependent rows and their saved parents in one request,
        // just as the durable transaction journal does. Otherwise a completed
        // draft can arrive before its sale, followed by orphan payment/items.
        const operations = [{ table: table.cloudTable, dependencyOrder: table.dependencyOrder,
          deletePhase: false, rows, changes: changes.filter(change => change.operation !== "D") }];
        await includeMissingParents(operations, this.reader, this.registry, branchId);
        const closedGraph = await includeClosedShiftGraphs(operations, this.reader, this.registry, branchId);
        const withParents = operations.length > 1;
        if (withParents) {
          operations.sort((a, b) => a.dependencyOrder - b.dependencyOrder);
          const removed = changes.filter(change => change.operation === "D");
          if (removed.length) operations.push({ table: table.cloudTable, deletePhase: true,
            rows: [], changes: removed });
          if (Buffer.byteLength(JSON.stringify(operations), "utf8") > 6 * 1024 * 1024)
            throw Object.assign(new Error("One recovery transaction exceeds the 6 MiB sync limit."), { code: "EOVERSIZED" });
        }
        const batchId = stableUuid({
          branchId,
          table: table.cloudTable,
          from: Number(checkpoint?.change_tracking_version ?? 0),
          ...(closedGraph ? { operations } : { rows }),
          changes: changes.map((change) => ({
            version: change.version,
            operation: change.operation,
            key: change.key,
          })),
        });
        const uploadId = withParents ? stableUuid({ branchId, recovery: batchId, operations }) : batchId;
        await this.assertLegacyCashWrites(branchId, withParents ? operations : [{ table: table.cloudTable, rows, changes }]);
        let acknowledged;
        try {
          acknowledged = await this.retry(() =>
            withParents
              ? this.cloud.pushAggregate({ batchId: uploadId, branchId, operations })
              : this.cloud.pushBatch({ batchId: uploadId, branchId, table: table.cloudTable, changes, rows }),
          );
        } catch (error) {
          if ((governance.has(table.cloudTable) || requiresSettingsProof) &&
            error?.code === "GOVERNANCE_AUTH_REQUIRED") { deferredTables.add(table.cloudTable); break; }
          throw error;
        }
        assertBatchAcknowledgement(acknowledged, uploadId);
        assertShiftClosureAcknowledgement(acknowledged, operations, branchId);
        const version = Math.max(...changes.map((row) => Number(row.version)));
        await this.checkpoints.save(branchId, table.sqlServerTable, "push", {
          change_tracking_version: version,
        });
        checkpoint = { ...(checkpoint ?? {}), change_tracking_version: version };
        pushed += changes.length;
        onProgress({ direction: "push", table: table.cloudTable, completed: changes.length });
        rows = [];
        live = [];
      }
      } catch(error) {
        if (["ESYNC_REFUND_REVIEW_REQUIRED", "ESYNC_REFUND_APPROVAL_REQUIRED"].includes(error?.code)) {
          refundUploadHeld ??= { code: error.code, table: "sales", message: error.message };
          deferredTables.add(table.cloudTable);
          continue;
        }
        if (error?.code === "ESYNC_CASH_ROUTE_HELD") {
          cashUploadHeld ??= cashRoute.uploadHold();
          deferredTables.add(table.cloudTable);
          continue;
        }
        if(error?.code==='ECHANGEGAP'&&error.table==='change_history'&&table.sqlServerTable==='change_history'&&table.cloudTable==='change_history'){
          // Missing-only cloud membership is not proof that local authored
          // history was accepted. Retain its CT checkpoint/journal and let
          // other eligible tables proceed; final upload checks remain held.
          historyUploadHeld={code:'ECHANGEGAP',table:'change_history',message:'Retained local history uploads need verification. History downloads and other eligible uploads can continue.'};
          continue;
        }
        if (error?.code === "ECHANGEGAP" || [401,403].includes(Number(error?.status))) throw error;
        this.blockedTables.add(table.sqlServerTable);
        this.pushErrors.push(Object.assign(error, {table: error.table ?? table.cloudTable}));
      }
    }
    if (this.pushErrors.length) throw Object.assign(this.pushErrors[0], {pushed, failures:this.pushErrors.length});
    // Exact acknowledged business CT rows may have been the only remaining
    // prerequisite. Drain that protected intent now, without another bootstrap
    // or a blind checkpoint advance. Ordinary legacy passes stay unchanged.
    if(financialCoverageAdvanced)pushed+=await this.pushAggregates(branchId,batchSize,true,onProgress,includeActivity);
    if (this.pushErrors.length) throw Object.assign(this.pushErrors[0], {pushed, failures:this.pushErrors.length});
    cashUploadHeld ??= this.cashUploadHeld;
    refundUploadHeld ??= this.refundUploadHeld;
    if (cashUploadHeld || refundUploadHeld) deferredTables.add("sales");
    return { pushed, deferredTables:[...deferredTables], ...(cashUploadHeld ? { cashUploadHeld, allUploaded:false } : {}),
      ...(refundUploadHeld ? { refundUploadHeld, allUploaded:false } : {}),
      ...(historyUploadHeld?{historyUploadHeld,allUploaded:false}:{}) };
  }
}
module.exports = { PushWorker, collapseChanges, rowsForBranch, terminalWritableChanges, batchAuditAggregates };
