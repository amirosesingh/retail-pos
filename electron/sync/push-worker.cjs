const { retryDelay } = require("./retry.cjs");
const { stableUuid } = require("../db/repositories/aggregates.cjs");
const { ACTIVITY_TABLES } = require("./event-policy.cjs");

function groupBy(values, key) {
  const groups = new Map();
  for (const value of values) {
    const name = key(value);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(value);
  }
  return groups;
}

function collapseChanges(changes) {
  const latest = new Map();
  for (const change of changes)
    latest.set(`${change.entity_type}\u0000${change.entity_id}`, change);
  return [...latest.values()];
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
  const authoritative = String(branchId ?? "").trim();
  return rows.map((row) => {
    const supplied = String(row?.[branchColumn] ?? "").trim();
    const equivalent =
      !supplied || supplied.toLocaleLowerCase("en-US") === authoritative.toLocaleLowerCase("en-US");
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
async function includeMissingParents(operations, reader, registry, branchId) {
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
      await reader.rows(table, ids.map((id) => ({ key: { id } })), { branchId }), branchId);
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
  if (!["settings_overrides", "settings_scoped"].includes(tableName)) return changes;
  return changes.filter((change) => {
    const key = changeKey(change);
    const scope = String(key.scope ?? "")
      .trim()
      .toLowerCase();
    const scopeId = String(key.scope_id ?? "").trim();
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
  constructor({ reader, cloud, checkpoints, registry }) {
    this.reader = reader;
    this.cloud = cloud;
    this.checkpoints = checkpoints;
    this.registry = registry;
  }
  async retry(work) {
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      try {
        return await work();
      } catch (error) {
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
  async pushAggregates(branchId, batchSize, isolate = false, onProgress = () => {}, includeActivity = true) {
    this.pushErrors = []; this.blockedTables = new Set();
    let pushed = 0;
    const terminalId = this.cloud.terminalId?.() ?? "";
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
      if (aggregate.changes.some(change => this.blockedTables.has(change.entity_type))) {
        originalIds.forEach(id => deferred.add(id)); continue;
      }
      try {
      const requiresSettingsProof = aggregate.changes.some((change) =>
        protectedSettings.has(change.entity_type) ||
        (change.entity_type === "settings_scoped" && isSharedPosFieldChange(change)));
      if (requiresSettingsProof && !this.cloud.hasAuthorizationProof?.()) {
        deferred.add(aggregate.aggregateId);
        continue;
      }
      const operations = [];
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
            rows: rowsForBranch(
              table,
              await this.reader.rows(table, live, { branchId }),
              branchId,
            ),
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
      try {
        await includeMissingParents(operations, this.reader, this.registry, branchId);
      } catch (error) {
        throw error;
      }
      if (!operations.length) {
        if (finalChanges.some((change) => !["settings_overrides", "settings_scoped"].includes(change.entity_type) ||
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
      try {
        const acknowledged = await this.retry(() =>
          this.cloud.pushAggregate({ batchId: aggregate.aggregateId, branchId, operations }),
        );
        if (!acknowledged?.ok)
          throw new Error(acknowledged?.error ?? "Cloud did not acknowledge the aggregate.");
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
        // Fall back for a payload rejection, not network/auth/database failures.
        if (aggregate.originals && (error?.code === "EOVERSIZED" ||
          [400,413,422].includes(Number(error?.status)))) {
          aggregates.push(...aggregate.originals);
          continue;
        }
        error.table ??= aggregate.changes[0]?.entity_type ?? null;
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
    if (!branchId) throw new Error("A branch is required for synchronization.");
    batchSize = Math.max(100, Math.min(2000, Number(batchSize) || 500));
    const terminalId = this.cloud.terminalId?.() ?? "";
    let pushed = await this.pushAggregates(branchId, batchSize, true, onProgress, includeActivity);
    const deferredTables = new Set();
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
        let changes = terminalWritableChanges(
          table.cloudTable,
          window.filter((change) => !change.remote),
          { branchId, terminalId },
        );
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
        let rows = rowsForBranch(
          table,
          await this.reader.rows(table, live, { branchId }),
          branchId,
        );
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
          rows = rowsForBranch(
            table,
            await this.reader.rows(table, live, { branchId }),
            branchId,
          );
        }
        const batchId = stableUuid({
          branchId,
          table: table.cloudTable,
          from: Number(checkpoint?.change_tracking_version ?? 0),
          changes: changes.map((change) => ({
            version: change.version,
            operation: change.operation,
            key: change.key,
          })),
        });
        let acknowledged;
        try {
          acknowledged = await this.retry(() =>
            this.cloud.pushBatch({ batchId, branchId, table: table.cloudTable, changes, rows }),
          );
        } catch (error) {
          if ((governance.has(table.cloudTable) || requiresSettingsProof) &&
            error?.code === "GOVERNANCE_AUTH_REQUIRED") { deferredTables.add(table.cloudTable); break; }
          throw error;
        }
        if (!acknowledged?.ok)
          throw new Error(acknowledged?.error ?? "Cloud did not acknowledge the batch.");
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
        if (error?.code === "ECHANGEGAP" || [401,403].includes(Number(error?.status))) throw error;
        this.blockedTables.add(table.sqlServerTable);
        this.pushErrors.push(Object.assign(error, {table: error.table ?? table.cloudTable}));
      }
    }
    if (this.pushErrors.length) throw Object.assign(this.pushErrors[0], {pushed, failures:this.pushErrors.length});
    return { pushed, deferredTables:[...deferredTables] };
  }
}
module.exports = { PushWorker, collapseChanges, rowsForBranch, terminalWritableChanges, batchAuditAggregates };
