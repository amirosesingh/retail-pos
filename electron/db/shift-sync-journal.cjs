const { createHash } = require("node:crypto");
const { stableUuid, canonical } = require("./repositories/aggregates.cjs");
const { recordId } = require("../sync/uuid-fields.cjs");
const { toCloudRow } = require("../sync/row-codec.cjs");
const { ShiftIntentStore } = require("./shift-intents.cjs");

const GRAPH_TABLES = ["shift_cash_counts", "shift_reconciliations", "shift_close_events",
  "shift_notifications", "shift_variance_alerts"];
const ALLOWED_TABLES = new Set(["shifts", ...GRAPH_TABLES, "activity_events"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_GRAPH_ROWS = 2000;
const fail = (message, code = "ESHIFT_CLOSURE_SNAPSHOT") => {
  throw Object.assign(new Error(message), { code, table: "shifts" });
};
const branch = value => recordId(String(value ?? "").trim());
const id = value => UUID.test(branch(value)) ? branch(value) : null;
const finiteMoney = value => value != null && typeof value !== "boolean" &&
  String(value).trim() !== "" && Number.isFinite(Number(value));
const sameMoney = (left, right) => left == null || right == null
  ? left == null && right == null
  : finiteMoney(left) && finiteMoney(right) && Number(left) === Number(right);
const rowsOf = operation => operation.rows ?? (operation.values ? [{ ...operation.match, ...operation.values }] : []);

/**
 * Main authorizes this protected workflow and calculates its blind totals.
 * Preserve that writer, adding its upload journal in the same SQL transaction.
 * This class is not exposed through IPC and accepts no renderer trust flag.
 */
class ShiftSyncJournal {
  constructor(operationsRepository) {
    this.repository = operationsRepository;
    this.intents = new ShiftIntentStore(operationsRepository.connectionManager,{tables:[...operationsRepository.tables.values()]});
  }
  observe(branchId,shiftId) { return this.intents.observe(branchId,shiftId); }

  async recountReplay(intent) { return Boolean(await this.countReplay("RECOUNT",intent)); }
  originalReplay(intent) { return this.countReplay("ORIGINAL",intent); }
  async countReplay(kind,intent) {
    const label = kind === "ORIGINAL" ? "original count" : "recount";
    const branchId = branch(intent.branchId), shiftId = id(intent.shiftId);
    if (!branchId || !shiftId || !intent.clientKey) fail(`The ${label} replay identity is incomplete.`, "EIDEMPOTENCY");
    const sql = this.repository.connectionManager.sql();
    const transaction = new sql.Transaction(this.repository.connectionManager.pool);
    await transaction.begin(sql.ISOLATION_LEVEL?.SERIALIZABLE);
    try {
      const parent = await new sql.Request(transaction).input("shift", sql.UniqueIdentifier, shiftId).input("branch", branchId)
        .query("SELECT id FROM dbo.[shifts] WITH (UPDLOCK,HOLDLOCK) WHERE id=@shift AND store_id=@branch;");
      if (parent.recordset?.length !== 1) fail(`The ${label} does not belong to this terminal branch.`, "SYNC_BRANCH_FORBIDDEN");
      const found = await new sql.Request(transaction).input("shift", sql.UniqueIdentifier, shiftId).input("branch", branchId)
        .input("client_key", intent.clientKey)
        .input("kind",kind)
        .query("SELECT TOP (2) * FROM dbo.[shift_cash_counts] WITH (UPDLOCK,HOLDLOCK) WHERE shift_id=@shift AND store_id=@branch AND (client_key=@client_key OR (@kind=N'ORIGINAL' AND kind=N'ORIGINAL'));");
      if (!found.recordset?.length) {
        if(await this.intents.missingSavedCount(transaction,kind,intent))
          fail(`The saved ${label} is missing from its immutable history. No retry was accepted.`,"EIDEMPOTENCY");
        await transaction.commit(); return false;
      }
      const mismatch = () => fail(`This ${label} key has different or incomplete saved facts. No ${label} was accepted.`, "EIDEMPOTENCY");
      if (found.recordset.length !== 1) mismatch();
      const graph = await this.snapshot(transaction, branchId, shiftId, [], {allowUnclosed:kind==="ORIGINAL"});
      const count = graph.get("shift_cash_counts").find(row => id(row.id) === id(found.recordset[0].id));
      if (!count || count.kind !== kind || count.client_key !== intent.clientKey || (kind==="RECOUNT" && count.reason !== intent.reason) ||
          branch(count.terminal_id) !== branch(intent.terminalId) || count.counted_by_name !== intent.actor ||
          count.counted_by_staff_id !== intent.actor ||
          !["cash", "card", "digital"].every(tender => sameMoney(count[`counted_${tender}`], intent[tender]))) mismatch();
      const reconciliations = graph.get("shift_reconciliations").filter(row => id(row.count_id) === id(count.id));
      const events = graph.get("shift_close_events").filter(row => {
        let detail = row.detail;
        if (typeof detail === "string") { try { detail = JSON.parse(detail); } catch { return false; } }
        return row.event === (kind==="ORIGINAL"?"cash_count_submitted":"recount_submitted") && id(detail?.count_id) === id(count.id);
      });
      if (reconciliations.length !== 1 || events.length !== 1) mismatch();
      const reconciliation = reconciliations[0], event = events[0];
      let detail = event.detail;
      if (typeof detail === "string") { try { detail = JSON.parse(detail); } catch { mismatch(); } }
      // Verify this historical recount, not a newer parent or today's totals.
      const time = value => value instanceof Date ? value.toISOString() : String(value ?? "");
      const sameTime = value => time(value) === time(count.created_at);
      const money = value => Math.round(Number(value) * 100) / 100;
      const variances = ["cash", "card", "digital"].map(tender => {
        const counted = count[`counted_${tender}`], expected = reconciliation[`expected_${tender}`];
        if (!sameMoney(reconciliation[`counted_${tender}`], counted) || !finiteMoney(expected)) mismatch();
        const variance = counted == null ? null : money(Number(counted) - Number(expected));
        if (!sameMoney(reconciliation[`variance_${tender}`], variance)) mismatch();
        return variance ?? 0;
      });
      const total = money(variances.reduce((sum, value) => sum + value, 0));
      const status = Math.abs(total) <= 0.005 ? "NO_VARIANCE" : total > 0 ? "OVER" : "SHORT";
      if (!count.created_at || !sameTime(reconciliation.created_at) || !sameTime(event.created_at) ||
          !sameMoney(reconciliation.variance_total, total) || reconciliation.variance_status !== status ||
          (kind==="RECOUNT" && detail?.reason !== intent.reason) || event.to_state !== (kind==="ORIGINAL"?"CASH_COUNT_SUBMITTED":"CLOSED") ||
          branch(event.terminal_id) !== branch(intent.terminalId) || event.actor_name !== intent.actor ||
          event.actor_staff_id !== intent.actor) mismatch();
      if (kind==="ORIGINAL") {
        const reconciled=graph.get("shift_close_events").filter(row=>row.event==="reconciled" && sameTime(row.created_at));
        let facts=reconciled[0]?.detail;
        if(typeof facts==="string"){try{facts=JSON.parse(facts);}catch{mismatch();}}
        if(reconciled.length!==1 || !["CLOSED","VARIANCE_REVIEW_REQUIRED","RECONCILIATION"].includes(reconciled[0].to_state) ||
          reconciled[0].from_state!=="CASH_COUNT_SUBMITTED" || reconciled[0].actor_name!==intent.actor ||
          reconciled[0].actor_staff_id!==intent.actor || branch(reconciled[0].terminal_id)!==branch(intent.terminalId) ||
          facts?.variance_status!==status || !sameMoney(facts?.variance_total,total)) mismatch();
      }
      await transaction.commit();
      return {state:graph.get("shifts")[0].state};
    } catch (error) {
      await Promise.resolve(transaction.rollback()).catch(() => undefined);
      throw error;
    }
  }

  validate(operations, scope) {
    const branchId = branch(scope.branchId);
    if (!branchId || branchId.length > 128) fail("A verified terminal branch is required.", "EBRANCH");
    const ops = this.repository.validate(operations);
    const parents = ops.filter(operation => operation.table === "shifts");
    if (parents.length !== 1 || parents[0].kind !== "update" ||
        Object.keys(parents[0].match ?? {}).length !== 1 || !id(parents[0].match.id))
      fail("A protected closure must update exactly one saved shift.");
    const shiftId = id(parents[0].match.id);
    for (const operation of ops) {
      const table = this.repository.tables.get(operation.table);
      const primary = table?.columns.filter(column => column.primaryKey) ?? [];
      if (!ALLOWED_TABLES.has(operation.table) || primary.length !== 1 || primary[0].sqlServerColumn !== "id" ||
          (operation.table !== "shifts" && operation.kind !== "insert"))
        fail("The protected closure contains an unrelated operation.");
      for (const row of rowsOf(operation)) {
        if (!id(row.id) || branch(row.store_id) !== branchId ||
            (operation.table === "shifts" ? id(row.id) !== shiftId
              : operation.table === "activity_events" ? row.event_type !== "shift_cash_variance" ||
                row.entity_type !== "shift" || id(row.entity_id) !== shiftId || branch(row.branch_id) !== branchId
              : id(row.shift_id) !== shiftId))
          fail("The protected closure must belong to its saved shift and terminal branch.", "SYNC_BRANCH_FORBIDDEN");
      }
    }
    return { branchId, shiftId, ops };
  }

  async snapshot(transaction, branchId, shiftId, ops, {allowUnclosed=false}={}) {
    const sql = this.repository.connectionManager.sql();
    const select = async (table, statement, inputs) => {
      const request = new sql.Request(transaction);
      for (const [name, value] of Object.entries(inputs)) request.input(name, value);
      const result = await request.query(statement);
      const rows = result.recordset ?? [];
      if (rows.length > MAX_GRAPH_ROWS) fail("The saved closing graph exceeds the synchronization limit.");
      return rows.map(row => JSON.parse(JSON.stringify(toCloudRow(this.repository.tables.get(table), row))));
    };
    const parents = await select("shifts",
      "SELECT * FROM dbo.[shifts] WITH (UPDLOCK,HOLDLOCK) WHERE id=@shift AND store_id=@branch;",
      { shift: shiftId, branch: branchId });
    const parent = parents[0];
    const closed=parent?.status==="CLOSED" && parent?.state==="CLOSED" && parent?.closed_at && Number.isFinite(Date.parse(parent.closed_at));
    if (parents.length !== 1 || (!closed && !(allowUnclosed && ["CASH_COUNT_SUBMITTED","VARIANCE_REVIEW_REQUIRED","RECONCILIATION"].includes(parent?.state))) ||
        !Number.isSafeInteger(Number(parent.row_version)) || Number(parent.row_version) < 1)
      fail("The local database did not confirm the closed shift and its revision.");
    const graph = new Map([["shifts", parents]]);
    for (const table of GRAPH_TABLES) graph.set(table, await select(table,
      `SELECT TOP (${MAX_GRAPH_ROWS + 1}) * FROM dbo.[${table}] WITH (UPDLOCK,HOLDLOCK) WHERE shift_id=@shift ORDER BY id;`,
      { shift: shiftId }));
    const activityIds = ops.filter(operation => operation.table === "activity_events").flatMap(rowsOf).map(row => id(row.id));
    if (activityIds.length) {
      const inputs = Object.fromEntries(activityIds.map((value, index) => [`event${index}`, value]));
      graph.set("activity_events", await select("activity_events",
        `SELECT * FROM dbo.[activity_events] WITH (UPDLOCK,HOLDLOCK) WHERE id IN (${activityIds.map((_, index) => `@event${index}`).join(",")});`, inputs));
      if (graph.get("activity_events").length !== new Set(activityIds).size)
        fail("The database did not save the closing activity.");
    }
    let totalRows = 0;
    for (const [table, rows] of graph) {
      const seen = new Set();
      for (const row of rows) {
        const rowId = id(row.id);
        if (!rowId || seen.has(rowId) || branch(row.store_id) !== branchId ||
            (table === "shifts" ? rowId !== shiftId : table === "activity_events"
              ? row.event_type !== "shift_cash_variance" || row.entity_type !== "shift" ||
                id(row.entity_id) !== shiftId || branch(row.branch_id) !== branchId
              : id(row.shift_id) !== shiftId))
          fail("The saved closing graph has an invalid owner or parent.", "SYNC_BRANCH_FORBIDDEN");
        seen.add(rowId);
      }
      totalRows += rows.length;
    }
    if (totalRows > MAX_GRAPH_ROWS || Buffer.byteLength(JSON.stringify([...graph]), "utf8") > 6 * 1024 * 1024)
      fail("The saved closing graph exceeds the synchronization limit.");
    for (const operation of ops) for (const row of rowsOf(operation)) {
      if (!(graph.get(operation.table) ?? []).some(saved => id(saved.id) === id(row.id)))
        fail("The local database did not save every closing record.");
    }
    // Check persisted links/facts, not the drawer maths or the old summary:
    // an authorized recount legitimately differs from its original count.
    const counts = new Map(graph.get("shift_cash_counts").map(row => [id(row.id), row]));
    const reconciliations = graph.get("shift_reconciliations");
    const requestedCounts = new Set(ops.filter(operation => operation.table === "shift_cash_counts").flatMap(rowsOf).map(row => id(row.id)));
    const requestedReconciliations = new Set(ops.filter(operation => operation.table === "shift_reconciliations").flatMap(rowsOf).map(row => id(row.id)));
    const candidateReconciliations = requestedReconciliations.size
      ? reconciliations.filter(row => requestedReconciliations.has(id(row.id))) : reconciliations;
    const matchingCount = reconciliation => {
      const count = counts.get(id(reconciliation.count_id));
      return count && finiteMoney(count.counted_cash) && ["cash", "card", "digital"].every(tender =>
        sameMoney(reconciliation[`counted_${tender}`], count[`counted_${tender}`]));
    };
    if (!counts.size || !reconciliations.length || reconciliations.some(row => row.count_id != null && !matchingCount(row)) ||
        [...requestedCounts].some(countId => !counts.has(countId)) ||
        candidateReconciliations.length < requestedReconciliations.size ||
        !candidateReconciliations.some(row => matchingCount(row) &&
          (!requestedCounts.size || requestedCounts.has(id(row.count_id))) &&
          sameMoney(row.counted_cash, parent.final_counted_cash ?? parent.counted_cash) &&
          ["counted_card", "counted_digital", "expected_cash", "expected_card", "expected_digital",
            "variance_cash", "variance_card", "variance_digital", "variance_total"].every(field => sameMoney(row[field], parent[field])) &&
          row.variance_status === parent.variance_status))
      fail("The closed shift has no matching saved cash count and reconciliation.");
    const reconciliationIds = new Set(reconciliations.map(row => id(row.id)));
    if (graph.get("shift_variance_alerts").some(row => row.reconciliation_id != null && !reconciliationIds.has(id(row.reconciliation_id))))
      fail("The closing variance alert has no saved reconciliation.");
    return graph;
  }

  async apply(context, operations, scope = {}) {
    const { branchId, shiftId, ops } = this.validate(operations, scope);
    const receiptPayload = { kind: "protected_shift_close", branchId, shiftId, operations: ops };
    const aggregateId = stableUuid(receiptPayload);
    const payloadHash = createHash("sha256").update(JSON.stringify(canonical(receiptPayload))).digest("hex");
    let priorReceipt = null, causalContext;
    return this.repository.apply(context, ops, scope, async (transaction, validatedOps) => {
      const graph = await this.snapshot(transaction, branchId, shiftId, validatedOps);
      const sql = this.repository.connectionManager.sql();
      if (priorReceipt) return;
      const kind=ops.some(operation=>operation.table==="shift_cash_counts" && rowsOf(operation).some(row=>row.kind==="RECOUNT"))?"RECOUNT":
        ops.some(operation=>operation.table==="shift_cash_counts")?"ORIGINAL":"VARIANCE";
      await this.intents.freeze(transaction,aggregateId,kind,graph,causalContext);
      for (const [table, rows] of graph) for (const row of rows) {
        await new sql.Request(transaction)
          .input("entity_type", table).input("entity_id", JSON.stringify({ id: id(row.id) }))
          .input("operation", table === "shifts" ? "update" : "insert")
          .input("branch_id", branchId).input("entity_version", Number(row.row_version ?? 1))
          .input("aggregate_id", sql.UniqueIdentifier, aggregateId)
          .query("INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version,aggregate_id) VALUES(@entity_type,@entity_id,@operation,@branch_id,@entity_version,@aggregate_id);");
      }
      await new sql.Request(transaction).input("operation_id", sql.UniqueIdentifier, aggregateId)
        .input("operation_type", "protected_shift_close").input("entity_id", shiftId).input("note", payloadHash)
        .query("INSERT dbo.local_operation_receipts(operation_id,operation_type,entity_id,note) VALUES(@operation_id,@operation_type,@entity_id,@note);");
    }, async transaction => {
      const sql = this.repository.connectionManager.sql();
      // Match the ordinary aggregate writer's receipt→parent lock order. The
      // parent then precedes all child writes, as it does for upload snapshots.
      const prior = await new sql.Request(transaction).input("operation_id", sql.UniqueIdentifier, aggregateId)
        .query("SELECT note FROM dbo.local_operation_receipts WITH (UPDLOCK,HOLDLOCK) WHERE operation_id=@operation_id;");
      priorReceipt = prior.recordset?.[0] ?? null;
      if (priorReceipt && priorReceipt.note !== payloadHash)
        fail("The closing receipt has different saved facts.", "EIDEMPOTENCY");
      const parent = await new sql.Request(transaction).input("shift", sql.UniqueIdentifier, shiftId).input("branch", branchId)
        .query("SELECT id FROM dbo.[shifts] WITH (UPDLOCK,HOLDLOCK) WHERE id=@shift AND store_id=@branch;");
      if (parent.recordset?.length !== 1)
        fail("The protected shift does not belong to this terminal branch.", "SYNC_BRANCH_FORBIDDEN");
      if(priorReceipt){
        const frozen=await this.intents.get(aggregateId,branchId,transaction);
        if(!frozen)fail("The saved closing receipt has no immutable intent.","EIDEMPOTENCY");
        await this.intents.verifySavedHistory(transaction,frozen);
        return false;
      }
      causalContext=await this.intents.verify(transaction,scope.observation);
    });
  }
}
module.exports = { ShiftSyncJournal };
