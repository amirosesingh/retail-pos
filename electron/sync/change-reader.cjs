const { toCloudRow } = require("./row-codec.cjs");

class ChangeReader {
  constructor(connectionManager, registry = null) {
    this.connectionManager = connectionManager;
    this.tables = new Map((registry?.tables ?? []).map((table) => [table.sqlServerTable, table]));
  }
  table(value) {
    const table = typeof value === "string" ? this.tables.get(value) : value;
    if (!table || !this.tables.has(table.sqlServerTable)) throw new Error("Invalid registry table.");
    const primary = table.columns.filter((column) => column.primaryKey).map((column) => column.sqlServerColumn);
    if (!primary.length) throw new Error(`No primary key is registered for ${table.sqlServerTable}.`);
    return { table, primary };
  }
  entityId(primary, source) { return JSON.stringify(Object.fromEntries(primary.map((column) => [column, source[column]]))); }
  async currentVersion() {
    const result = await this.connectionManager.pool.request().query("SELECT CHANGE_TRACKING_CURRENT_VERSION() AS current_version;");
    return Number(result.recordset?.[0]?.current_version ?? 0);
  }
  async changedIds(value, sinceVersion, limit = 500) {
    const { table, primary } = this.table(value);
    const name = table.sqlServerTable;
    const request = this.connectionManager.pool.request().input("since", Number(sinceVersion) || 0).input("limit", Math.max(100, Math.min(2000, limit)));
    const bounds = await this.connectionManager.pool.request().input("object", `dbo.${name}`).query("SELECT CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(@object)) AS min_version, CHANGE_TRACKING_CURRENT_VERSION() AS current_version;");
    const min = Number(bounds.recordset?.[0]?.min_version ?? 0);
    if (sinceVersion > 0 && min > Number(sinceVersion)) throw Object.assign(new Error(`Change Tracking history for ${name} has expired; a scoped bootstrap is required.`), { code: "ECHANGEGAP", table: name, minimumVersion: min });
    const keyColumns = primary.map((column) => `CT.[${column}]`).join(",");
    const order = primary.map((column) => `CT.[${column}]`).join(",");
    let result = await request.query(`SELECT TOP (@limit) CT.SYS_CHANGE_VERSION AS version, CT.SYS_CHANGE_OPERATION AS operation, CT.SYS_CHANGE_CONTEXT AS change_context, ${keyColumns}
      FROM CHANGETABLE(CHANGES dbo.[${name}], @since) CT
      ORDER BY CT.SYS_CHANGE_VERSION, ${order};`);
    if ((result.recordset?.length ?? 0) === Math.max(100, Math.min(2000, limit))) {
      const boundary = Number(result.recordset.at(-1).version);
      result = await this.connectionManager.pool.request().input("since", Number(sinceVersion) || 0).input("boundary", boundary).query(`SELECT CT.SYS_CHANGE_VERSION AS version, CT.SYS_CHANGE_OPERATION AS operation, CT.SYS_CHANGE_CONTEXT AS change_context, ${keyColumns}
        FROM CHANGETABLE(CHANGES dbo.[${name}], @since) CT WHERE CT.SYS_CHANGE_VERSION<=@boundary
        ORDER BY CT.SYS_CHANGE_VERSION, ${order};`);
    }
    return (result.recordset ?? []).map((row) => ({ ...row, remote: Boolean(row.change_context), key: Object.fromEntries(primary.map((column) => [column, row[column]])), entityId: this.entityId(primary, row) }));
  }
  async rows(value, changes) {
    const { table, primary } = this.table(value);
    if (!changes.length) return [];
    const request = this.connectionManager.pool.request();
    const clauses = changes.map((change, index) => {
      const key = change.key ?? change;
      return `(${primary.map((column, part) => { request.input(`k${index}_${part}`, key[column]); return `[${column}]=@k${index}_${part}`; }).join(" AND ")})`;
    });
    const result = await request.query(`SELECT * FROM dbo.[${table.sqlServerTable}] WHERE ${clauses.join(" OR ")};`);
    return (result.recordset ?? []).map((row) => toCloudRow(table, row));
  }
  async pendingAggregates(branchId, limit = 500) {
    const result = await this.connectionManager.pool.request().input("branch", branchId).input("limit", Math.max(1, Math.min(2000, limit))).query(`WITH selected AS (
      SELECT TOP (@limit) aggregate_id,MIN(change_id) first_change
      FROM dbo.sync_change_journal
      WHERE branch_id IN (@branch,'global') AND acknowledged_at IS NULL AND aggregate_id IS NOT NULL
      GROUP BY aggregate_id ORDER BY MIN(change_id)
    )
    SELECT journal.change_id,journal.entity_type,journal.entity_id,journal.operation,journal.entity_version,journal.aggregate_id
      FROM dbo.sync_change_journal journal JOIN selected ON selected.aggregate_id=journal.aggregate_id
      WHERE journal.acknowledged_at IS NULL ORDER BY selected.first_change,journal.change_id;`);
    const byAggregate = new Map();
    for (const row of result.recordset ?? []) {
      const id = String(row.aggregate_id);
      if (!byAggregate.has(id)) byAggregate.set(id, []);
      let key; try { key = JSON.parse(row.entity_id); } catch { key = { id: row.entity_id }; }
      byAggregate.get(id).push({ ...row, key });
    }
    return [...byAggregate.entries()].map(([aggregateId, changes]) => ({ aggregateId, changes }));
  }
  async acknowledgeAggregate(aggregateId) {
    await this.connectionManager.pool.request().input("aggregate", aggregateId).query("UPDATE dbo.sync_change_journal SET acknowledged_at=SYSDATETIMEOFFSET(),last_error=NULL WHERE aggregate_id=@aggregate AND acknowledged_at IS NULL;");
  }
  async failAggregate(aggregateId, error) {
    await this.connectionManager.pool.request().input("aggregate", aggregateId).input("error", String(error?.message ?? error).slice(0, 1000)).query("UPDATE dbo.sync_change_journal SET retry_count=retry_count+1,last_error=@error WHERE aggregate_id=@aggregate AND acknowledged_at IS NULL;");
  }
  async pendingSummary(branchId) {
    const result = await this.connectionManager.pool.request().input("branch", branchId).query(`SELECT
      SUM(CASE WHEN last_error IS NULL THEN 1 ELSE 0 END) pending,
      SUM(CASE WHEN last_error IS NOT NULL THEN 1 ELSE 0 END) failed
      FROM dbo.sync_change_journal
      WHERE branch_id IN (@branch,'global') AND acknowledged_at IS NULL;`);
    const row = result.recordset?.[0] ?? {};
    return { pending: Number(row.pending ?? 0), failed: Number(row.failed ?? 0) };
  }
  async failedAggregates(branchId, limit = 100) {
    const result = await this.connectionManager.pool.request().input("branch", branchId).input("limit", Math.max(1, Math.min(500, limit))).query(`SELECT TOP (@limit)
      aggregate_id,MAX(entity_type) entity_type,MAX(retry_count) attempts,MAX(last_error) error,
      MIN(created_at) created_at,MAX(created_at) last_attempt_at,COUNT_BIG(*) rows
      FROM dbo.sync_change_journal
      WHERE branch_id IN (@branch,'global') AND acknowledged_at IS NULL AND last_error IS NOT NULL AND aggregate_id IS NOT NULL
      GROUP BY aggregate_id ORDER BY MAX(created_at) DESC;`);
    return result.recordset ?? [];
  }
  async unacknowledged(value, entityIds, transaction) {
    const { table } = this.table(value);
    if (!entityIds.length) return new Set();
    const request = transaction ? new (this.connectionManager.sql().Request)(transaction) : this.connectionManager.pool.request();
    request.input("entity", table.sqlServerTable);
    const params = entityIds.map((id, index) => { request.input(`id${index}`, id); return `@id${index}`; });
    const result = await request.query(`SELECT entity_id FROM dbo.sync_change_journal WHERE entity_type=@entity AND acknowledged_at IS NULL AND entity_id IN (${params.join(",")});`);
    return new Set((result.recordset ?? []).map((row) => row.entity_id));
  }
}
module.exports = { ChangeReader };
