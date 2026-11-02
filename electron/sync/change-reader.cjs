const { toCloudRow } = require("./row-codec.cjs");
const { branchPredicate, rendererReadBranchPredicate } = require("../db/branch-scope.cjs");
const { ACTIVITY_TABLES } = require("./event-policy.cjs");
const { recordId } = require("./uuid-fields.cjs");
const { ShiftSyncJournal } = require("../db/shift-sync-journal.cjs");
const SHIFT_GRAPH_TABLES = ["shifts", "shift_cash_counts", "shift_reconciliations", "shift_close_events",
  "shift_notifications", "shift_variance_alerts"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

class ChangeReader {
  constructor(connectionManager, registry = null) {
    this.connectionManager = connectionManager;
    this.registry = registry ?? { tables: [] };
    this.tables = new Map((registry?.tables ?? []).map((table) => [table.sqlServerTable, table]));
    this.pendingGraphChecks = new WeakMap();
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
  async rows(value, changes, { branchId = "" } = {}) {
    const { table, primary } = this.table(value);
    if (!changes.length) return [];
    const request = this.connectionManager.pool.request();
    const clauses = changes.map((change, index) => {
      const key = change.key ?? change;
      return `(${primary.map((column, part) => { request.input(`k${index}_${part}`, key[column]); return `[${column}]=@k${index}_${part}`; }).join(" AND ")})`;
    });
    const scope = branchId && table.scope === "branch"
      // Recover unowned legacy purchase headers (and their children) before
      // PushWorker stamps the verified branch. Other branches stay excluded.
      ? table.cloudTable === "products" ? branchPredicate(this.registry, table, "source") : rendererReadBranchPredicate(this.registry, table, "source")
      : null;
    if (scope) request.input("branch", String(branchId));
    const result = await request.query(`SELECT * FROM dbo.[${table.sqlServerTable}] source WHERE (${clauses.join(" OR ")})${scope ? ` AND (${scope})` : ""};`);
    return (result.recordset ?? []).map((row) => toCloudRow(table, row));
  }
  /** Capture current closing facts together; journal entries contain keys, not
   * frozen rows. An offline recount may have superseded an older queued close. */
  async closedShiftGraphs(branchId, shiftIds) {
    const branch = recordId(String(branchId ?? "").trim());
    const ids = [...new Set((shiftIds ?? []).map(value => recordId(String(value ?? "").trim())))].sort();
    const refuse = () => { throw Object.assign(new Error("The current closed shift graph could not be captured safely."), {
      code: "ESHIFT_CLOSURE_SNAPSHOT", table: "shifts",
    }); };
    if (!branch || branch.length > 128 || !ids.length || ids.length > 2000 ||
        ids.some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))) refuse();
    const sql = this.connectionManager.sql();
    const transaction = new sql.Transaction(this.connectionManager.pool);
    await transaction.begin(sql.ISOLATION_LEVEL?.SERIALIZABLE);
    try {
      const journal = new ShiftSyncJournal({ connectionManager: this.connectionManager, tables: this.tables });
      const captured = new Map();
      let total = 0;
      // Lock the complete sorted parent set before touching child ranges. The
      // trusted writer takes its parent lock before inserting closing children.
      for (const id of ids) {
        const locked = await new sql.Request(transaction).input("shift", id).input("branch", branch)
          .query("SELECT id FROM dbo.[shifts] WITH (UPDLOCK,HOLDLOCK) WHERE id=@shift AND store_id=@branch;");
        if (locked.recordset?.length !== 1 || recordId(locked.recordset[0].id) !== id) refuse();
      }
      for (const id of ids) {
        const graph = await journal.snapshot(transaction, branch, id, []);
        for (const [table, rows] of graph) {
          const existing = captured.get(table) ?? [];
          if (rows.some(row => existing.some(prior => recordId(prior.id) === recordId(row.id)))) refuse();
          captured.set(table, [...existing, ...rows]);
          total += rows.length;
        }
        if (total > 2000 || Buffer.byteLength(JSON.stringify([...captured]), "utf8") > 6 * 1024 * 1024) refuse();
      }
      await transaction.commit();
      return [...captured].map(([table, rows]) => ({ table, rows }));
    } catch (error) {
      await Promise.resolve(transaction.rollback()).catch(() => undefined);
      throw error;
    }
  }
  async ticketCompletionParents(tickets, branchId) {
    const results = [];
    for (const ticket of tickets.filter(row => row.status === "completed")) {
      if (ticket.store_id !== branchId) throw new Error("Draft completion belongs to another branch.");
      const bookingId = String(ticket.note ?? "").startsWith("booking:") ? String(ticket.note).slice(8) : null;
      const name = bookingId ? "bookings" : "sales";
      const table = this.tables.get(name);
      if (!table) throw new Error("Draft completion parent is not registered.");
      const request = this.connectionManager.pool.request().input("branch", branchId).input("reference", bookingId || ticket.bill_no);
      const result = await request.query(bookingId
        ? "SELECT * FROM dbo.bookings WHERE store_id=@branch AND CONVERT(nvarchar(36),id)=@reference;"
        : "SELECT * FROM dbo.sales WHERE store_id=@branch AND bill_number=@reference;");
      if (!result.recordset?.length) throw new Error("The completed draft has no saved sale or booking.");
      results.push({ table: name, rows: result.recordset.map(row => toCloudRow(table, row)) });
    }
    return results;
  }
  async pendingAggregates(branchId, limit = 500, excludeAggregateIds = [], { includeActivity = true } = {}) {
    const request = this.connectionManager.pool.request().input("branch", branchId).input("limit", Math.max(1, Math.min(2000, limit))).input("include_activity", includeActivity ? 1 : 0);
    const excluded = excludeAggregateIds.slice(0, 2000).map((id, index) => {
      request.input(`excluded${index}`, id);
      return `@excluded${index}`;
    });
    const result = await request.query(`WITH selected AS (
      SELECT TOP (@limit) aggregate_id,MIN(change_id) first_change
      FROM dbo.sync_change_journal
      WHERE branch_id IN (@branch,'global') AND acknowledged_at IS NULL AND aggregate_id IS NOT NULL
        AND (@include_activity=1 OR EXISTS (
          SELECT 1 FROM dbo.sync_change_journal business_change
          WHERE business_change.aggregate_id=sync_change_journal.aggregate_id
            AND business_change.acknowledged_at IS NULL
            AND business_change.entity_type NOT IN (${[...ACTIVITY_TABLES].map(name => `'${name}'`).join(",")})
        ))
        ${excluded.length ? `AND aggregate_id NOT IN (${excluded.join(",")})` : ""}
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
      entity_type,
      SUM(CASE WHEN last_error IS NULL THEN 1 ELSE 0 END) pending,
      SUM(CASE WHEN last_error IS NOT NULL THEN 1 ELSE 0 END) failed,
      MAX(last_error) last_error
      FROM dbo.sync_change_journal
      WHERE branch_id IN (@branch,'global') AND acknowledged_at IS NULL
      GROUP BY entity_type;`);
    const queuedTables = (result.recordset ?? []).map(row => ({
      table: row.entity_type, pending:Number(row.pending ?? 0), failed:Number(row.failed ?? 0), error:row.last_error ?? null,
    }));
    return { pending:queuedTables.reduce((sum,row)=>sum+row.pending,0), failed:queuedTables.reduce((sum,row)=>sum+row.failed,0), queuedTables };
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
  async pendingShiftGraph(table, entityIds, transaction, { branchId, changes = [] } = {}) {
    if (!SHIFT_GRAPH_TABLES.includes(table.cloudTable)) return false;
    const branch = recordId(String(branchId ?? "").trim());
    if (!transaction || !branch || branch.length > 128)
      throw Object.assign(new Error("A verified branch and transaction are required to protect local closing changes."), { code: "EBRANCH", table: table.cloudTable });
    const parseId = key => { try { return recordId(String(JSON.parse(key).id ?? "")); } catch { return ""; } };
    const ids = [...new Set(entityIds.map(parseId))];
    if (!ids.length || ids.length > 2000 || ids.some(id => !UUID.test(id)))
      throw Object.assign(new Error("The closing download has an invalid entity key."), { code: "ESYNC_ENTITY", table: table.cloudTable });
    const sql = this.connectionManager.sql();
    const query = (statement, inputs = {}) => {
      const request = new sql.Request(transaction);
      for (const [name, data] of Object.entries(inputs)) request.input(name, data);
      return request.query(statement);
    };
    // Discover child parents without retaining a child lock before its parent.
    // Revalidate after acquiring the whole graph in parent-first order below.
    const requested = table.cloudTable === "shifts" ? { recordset: [] } : await new sql.Request(this.connectionManager.pool)
      .input("ids", JSON.stringify(ids)).query(`SELECT id,store_id,shift_id FROM dbo.[${table.sqlServerTable}]
      WHERE id IN (SELECT TRY_CONVERT(uniqueidentifier,[value]) FROM OPENJSON(@ids));`);
    const local = requested.recordset ?? [];
    if (local.some(row => recordId(String(row.store_id ?? "")) !== branch) ||
        changes.some(change => change.row_data && recordId(String(change.row_data.store_id ?? "")) !== branch))
      throw Object.assign(new Error("The closing download does not belong to the verified branch."), { code: "SYNC_BRANCH_FORBIDDEN", table: table.cloudTable });
    const shiftIds = [...new Set(table.cloudTable === "shifts" ? ids :
      [...local.map(row => row.shift_id), ...changes.map(change => change.row_data?.shift_id)].filter(Boolean).map(id => recordId(String(id))))].sort();
    // An absent child tombstone cannot reveal its former parent. Do not infer
    // that an unknown closing history has no pending local work.
    if (shiftIds.some(id => !UUID.test(id))) return true;
    const checked = this.pendingGraphChecks.get(transaction);
    if (shiftIds.length && checked?.branch === branch && shiftIds.every(id => checked.shifts.has(id))) return false;
    const graph = new Map();
    let total = 0;
    for (const name of SHIFT_GRAPH_TABLES) {
      const rows = (await query(`SELECT TOP (2001) id,store_id${name === "shifts" ? "" : ",shift_id"} FROM dbo.[${name}] WITH (UPDLOCK,HOLDLOCK)
        WHERE ${name === "shifts" ? "id" : "shift_id"} IN (SELECT TRY_CONVERT(uniqueidentifier,[value]) FROM OPENJSON(@shifts)) ORDER BY id;`,
      { shifts: JSON.stringify(shiftIds) })).recordset ?? [];
      total += rows.length;
      if (total > 2000) return true;
      if (rows.some(row => recordId(String(row.store_id ?? "")) !== branch))
        throw Object.assign(new Error("The saved closing graph crosses the verified branch."), { code: "SYNC_BRANCH_FORBIDDEN", table: name });
      graph.set(name, new Set(rows.map(row => recordId(String(row.id)))));
    }
    if (table.cloudTable !== "shifts") {
      const revalidated = (await query(`SELECT id,store_id,shift_id FROM dbo.[${table.sqlServerTable}] WITH (UPDLOCK,HOLDLOCK)
        WHERE id IN (SELECT TRY_CONVERT(uniqueidentifier,[value]) FROM OPENJSON(@ids));`, { ids: JSON.stringify(ids) })).recordset ?? [];
      if (revalidated.some(row => !shiftIds.includes(recordId(String(row.shift_id))) || recordId(String(row.store_id)) !== branch)) return true;
    }
    for (const name of SHIFT_GRAPH_TABLES) {
      const keys = new Set(graph.get(name));
      if (name === table.cloudTable) ids.forEach(id => keys.add(id));
      const inputs = { branch, entity: name, ids: JSON.stringify([...keys]) };
      // Unknown/deleted journal keys cannot safely be attributed to a former
      // shift from a key-only journal. Keep the queue and defer the download.
      const journal = await query(`SELECT TOP (1) journal.entity_id FROM dbo.sync_change_journal journal WITH (UPDLOCK,HOLDLOCK)
        WHERE journal.entity_type=@entity AND journal.branch_id IN (@branch,'global') AND journal.acknowledged_at IS NULL
        AND (TRY_CONVERT(uniqueidentifier,JSON_VALUE(CASE WHEN ISJSON(journal.entity_id)=1 THEN journal.entity_id ELSE N'{}' END,'$.id')) IN
          (SELECT TRY_CONVERT(uniqueidentifier,[value]) FROM OPENJSON(@ids)) OR NOT EXISTS
          (SELECT 1 FROM dbo.[${name}] saved WHERE saved.id=TRY_CONVERT(uniqueidentifier,JSON_VALUE(CASE WHEN ISJSON(journal.entity_id)=1 THEN journal.entity_id ELSE N'{}' END,'$.id'))));`, inputs);
      if (journal.recordset?.length) return true;
      const bounds = (await query(`SELECT (SELECT TOP (1) change_tracking_version FROM dbo.sync_checkpoints WITH (UPDLOCK,HOLDLOCK)
        WHERE branch_id=@branch AND entity_type=@entity AND direction='push') AS checkpoint_version,
        CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(@object)) AS min_version, CHANGE_TRACKING_CURRENT_VERSION() AS current_version;`,
      { branch, entity: name, object: `dbo.${name}` })).recordset?.[0];
      const since = Number(bounds?.checkpoint_version);
      const valid = bounds?.checkpoint_version != null && bounds?.min_version != null && bounds?.current_version != null &&
        Number.isSafeInteger(since) && since >= Number(bounds.min_version) && since <= Number(bounds.current_version);
      // Missing/expired CT evidence is not proof of no local edits. A fresh
      // empty graph may bootstrap without inventing a checkpoint.
      if (!valid) {
        if (graph.get(name).size) throw Object.assign(new Error("Local closing Change Tracking history is missing or expired. Retained local work must be reviewed before this download can advance."),
          { code: "ELOCAL_PENDING_UNVERIFIED", table: name });
        continue;
      }
      const tracked = await query(`SELECT TOP (2001) CT.id, CT.SYS_CHANGE_OPERATION AS operation FROM CHANGETABLE(CHANGES dbo.[${name}], @since) CT
        WHERE (CT.SYS_CHANGE_CONTEXT IS NULL OR CT.SYS_CHANGE_CONTEXT<>0x434C4F5544)
        AND (CT.id IN (SELECT TRY_CONVERT(uniqueidentifier,[value]) FROM OPENJSON(@ids)) OR CT.SYS_CHANGE_OPERATION='D');`,
      { since, ids: JSON.stringify([...keys]) });
      if (tracked.recordset?.length) throw Object.assign(new Error("A local closing Change Tracking edit is still beyond its upload checkpoint. Upload or resolve it before retrying this cloud page."),
        { code: "ELOCAL_CT_PENDING", table: name });
    }
    if (shiftIds.length) this.pendingGraphChecks.set(transaction, { branch, shifts: new Set([
      ...(checked?.branch === branch ? checked.shifts : []), ...shiftIds,
    ]) });
    return false;
  }
  async unacknowledged(value, entityIds, transaction, options) {
    const { table } = this.table(value);
    if (!entityIds.length) return new Set();
    if (SHIFT_GRAPH_TABLES.includes(table.cloudTable))
      return new Set(await this.pendingShiftGraph(table, entityIds, transaction, options) ? entityIds : []);
    const request = transaction ? new (this.connectionManager.sql().Request)(transaction) : this.connectionManager.pool.request();
    request.input("entity", table.sqlServerTable);
    const params = entityIds.map((id, index) => { request.input(`id${index}`, id); return `@id${index}`; });
    const result = await request.query(`SELECT entity_id FROM dbo.sync_change_journal WHERE entity_type=@entity AND acknowledged_at IS NULL AND entity_id IN (${params.join(",")});`);
    return new Set((result.recordset ?? []).map((row) => row.entity_id));
  }
}
module.exports = { ChangeReader };
