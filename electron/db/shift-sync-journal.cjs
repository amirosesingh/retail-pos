const { createHash } = require("node:crypto");
const { stableUuid, canonical } = require("./repositories/aggregates.cjs");
const { recordId } = require("../sync/uuid-fields.cjs");
const { toCloudRow } = require("../sync/row-codec.cjs");

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
  constructor(operationsRepository) { this.repository = operationsRepository; }

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

  async snapshot(transaction, branchId, shiftId, ops) {
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
    if (parents.length !== 1 || parent.status !== "CLOSED" || parent.state !== "CLOSED" ||
        !parent.closed_at || !Number.isFinite(Date.parse(parent.closed_at)) ||
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
    let priorReceipt = null;
    return this.repository.apply(context, ops, scope, async (transaction, validatedOps) => {
      const graph = await this.snapshot(transaction, branchId, shiftId, validatedOps);
      const sql = this.repository.connectionManager.sql();
      if (priorReceipt) return;
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
    });
  }
}
module.exports = { ShiftSyncJournal };
