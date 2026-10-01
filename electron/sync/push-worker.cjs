const { retryDelay } = require("./retry.cjs");
const { stableUuid } = require("../db/repositories/aggregates.cjs");

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

/**
 * Older desktop builds wrote sale_items before branch_id was projected and
 * could write audit_logs without the later-added store_id. The aggregate
 * journal already fixes the authoritative branch, so fill only a missing
 * value while preserving a non-empty mismatch for the server to reject as
 * possible cross-branch corruption.
 */
function rowsForBranch(tableName, rows, branchId) {
  const branchColumn =
    tableName === "sale_items" ? "branch_id" : tableName === "audit_logs" ? "store_id" : null;
  if (!branchColumn) return rows;
  return rows.map((row) =>
    String(row?.[branchColumn] ?? "").trim() ? row : { ...row, [branchColumn]: branchId },
  );
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

/**
 * Global and cluster settings are read-only cache entries on a terminal. Old
 * databases can expose rows downloaded before the CLOUD change-tracking
 * context was introduced as local changes. Do not upload those rows or cached
 * rows belonging to a previous branch/terminal. Unknown scope types remain in
 * the batch so the server rejects malformed writes.
 */
function terminalWritableChanges(tableName, changes, { branchId = "", terminalId = "" } = {}) {
  if (!["settings_overrides", "settings_scoped"].includes(tableName)) return changes;
  return changes.filter((change) => {
    const key = changeKey(change);
    const scope = String(key.scope ?? "")
      .trim()
      .toLowerCase();
    const scopeId = String(key.scope_id ?? "").trim();
    if (["global", "cluster"].includes(scope)) return false;
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
        if (attempt === 5) throw error;
        await new Promise((resolve) => setTimeout(resolve, retryDelay(attempt, { maxMs: 5000 })));
      }
    }
    throw new Error("The synchronization retry loop ended unexpectedly.");
  }
  async pushAggregates(branchId, batchSize) {
    let pushed = 0;
    const terminalId = this.cloud.terminalId?.() ?? "";
    const aggregates = await this.reader.pendingAggregates(branchId, batchSize);
    for (const aggregate of aggregates) {
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
            rows: rowsForBranch(table.cloudTable, await this.reader.rows(table, live), branchId),
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
        await this.reader.acknowledgeAggregate(aggregate.aggregateId);
        pushed += aggregate.changes.length;
      } catch (error) {
        await this.reader.failAggregate(aggregate.aggregateId, error);
        throw error;
      }
    }
    return pushed;
  }
  async run({ branchId, batchSize = 500 }) {
    if (!branchId) throw new Error("A branch is required for synchronization.");
    batchSize = Math.max(100, Math.min(2000, Number(batchSize) || 500));
    const terminalId = this.cloud.terminalId?.() ?? "";
    let pushed = await this.pushAggregates(branchId, batchSize);
    const governance = new Set([
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
      if (!table.columns.some((column) => column.primaryKey)) continue;
      // Governance changes remain safely committed in SQL Server until a
      // currently verified settings administrator is available to upload them.
      if (governance.has(table.cloudTable) && !this.cloud.hasAuthorizationProof?.()) continue;
      let checkpoint = await this.checkpoints.get(branchId, table.sqlServerTable, "push");
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
        let live = changes.filter((change) => change.operation !== "D");
        let rows = rowsForBranch(table.cloudTable, await this.reader.rows(table, live), branchId);
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
          rows = rowsForBranch(table.cloudTable, await this.reader.rows(table, live), branchId);
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
          if (governance.has(table.cloudTable) && error?.code === "GOVERNANCE_AUTH_REQUIRED") break;
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
        rows = [];
        live = [];
      }
    }
    return { pushed };
  }
}
module.exports = { PushWorker, collapseChanges, rowsForBranch, terminalWritableChanges };
