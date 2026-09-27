const { loadRegistry } = require("../schema-registry.cjs");
const { branchPredicate } = require("../branch-scope.cjs");

const MAX_BATCH_ROWS = 2000;
const MAX_ENCODED_BYTES = 6 * 1024 * 1024;
const MAX_QUERY_ROWS = 2000;

// Renderer reads are intentionally narrower than the synchronization registry.
// Credentials, recovery secrets, PIN attempts and internal sync tables must
// never become readable merely because a renderer knows their table name.
const SAFE_RENDERER_TABLES = new Set([
  "audit_logs", "booking_payments", "bookings",
  "coupon_campaigns", "coupon_events", "coupon_redemptions", "expenses", "held_orders", "issued_vouchers",
  "item_activity_logs", "member_tiers", "members", "payment_types",
  "pos_settings", "pos_store_settings", "product_barcodes", "product_categories",
  "products", "promotions", "public_flags", "purchase_order_items", "purchase_orders", "nav_pins",
  "receiving_items", "receivings", "sale_items", "sales", "settings_locks",
  "settings_overrides", "settings_scoped", "shift_sessions", "shifts",
  "shift_cash_counts", "shift_close_events", "shift_reconciliations", "shift_variance_alerts",
  "stock_adjustments", "stock_count_drafts", "stock_movements",
  "staff_roles", "stock_transfer_items", "stock_transfers", "stores", "suppliers", "terminal_commands", "uom_units",
]);

function valueForSql(value) {
  if (value === undefined) return null;
  if (value !== null && typeof value === "object") return JSON.stringify(value);
  return value;
}

class OperationsRepository {
  constructor(connectionManager, registry = loadRegistry()) {
    this.connectionManager = connectionManager;
    this.registry = registry;
    this.tables = new Map((registry.tables ?? []).map((table) => [table.sqlServerTable, table]));
    this.cloudTables = new Map((registry.tables ?? []).map((table) => [table.cloudTable, table]));
  }
  pool() {
    if (!this.connectionManager.pool) throw Object.assign(new Error("SQL Server is not connected."), { code: "EDATABASE" });
    return this.connectionManager.pool;
  }
  validate(ops) {
    if (!Array.isArray(ops) || !ops.length || ops.length > 200) throw new Error("A batch must contain 1 to 200 operations.");
    if (Buffer.byteLength(JSON.stringify(ops), "utf8") > MAX_ENCODED_BYTES) throw new Error("The operation batch exceeds 6 MiB.");
    for (const op of ops) {
      const table = this.tables.get(op?.table);
      if (!table) throw new Error("Unsupported business table.");
      if (!["insert", "upsert", "update", "delete"].includes(op.kind)) throw new Error("Unsupported business operation.");
      if (table.updateRule === "append_only" && ["update", "delete"].includes(op.kind))
        throw new Error(`${op.table} is append-only and cannot be changed after insertion.`);
      const allowed = new Set(table.columns.map((column) => column.sqlServerColumn));
      const rows = op.rows ?? (op.values ? [op.values] : []);
      if (rows.length > MAX_BATCH_ROWS) throw new Error("A batch cannot exceed 2,000 rows.");
      for (const row of rows) {
        if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("Business rows must be objects.");
        for (const key of Object.keys(row)) if (!allowed.has(key)) throw new Error(`Unsupported column for ${op.table}.`);
      }
      for (const key of Object.keys(op.match ?? {})) if (!allowed.has(key)) throw new Error(`Unsupported match column for ${op.table}.`);
    }
    return ops;
  }
  async apply(context, operations) {
    const ops = this.validate(operations);
    const sql = this.connectionManager.sql();
    const transaction = new sql.Transaction(this.pool());
    await transaction.begin(sql.ISOLATION_LEVEL?.SERIALIZABLE);
    let affected = 0;
    try {
      for (const op of ops) affected += await this.applyOperation(transaction, op);
      await transaction.commit();
      return { ok: true, context: String(context ?? "").slice(0, 160), affected };
    } catch (error) {
      await Promise.resolve(transaction.rollback()).catch(() => undefined);
      throw error;
    }
  }
  async applyOperation(transaction, op) {
    const table = this.tables.get(op.table);
    const primary = table.columns.filter((column) => column.primaryKey).map((column) => column.sqlServerColumn);
    const hasRowVersion = table.columns.some((column) => column.sqlServerColumn === "row_version");
    if (op.kind === "insert" || op.kind === "upsert") {
      let affected = 0;
      for (const row of op.rows ?? (op.values ? [op.values] : [])) {
        const columns = Object.keys(row);
        if (!columns.length || primary.some((key) => row[key] == null)) throw new Error(`A complete stable key is required for ${op.table}.`);
        const request = new (this.connectionManager.sql().Request)(transaction);
        columns.forEach((column, index) => request.input(`v${index}`, valueForSql(row[column])));
        const source = columns.map((column, index) => `@v${index} AS [${column}]`).join(",");
        const on = primary.map((column) => `target.[${column}]=source.[${column}]`).join(" AND ");
        const updates = columns.filter((column) => !primary.includes(column) && column !== "row_version").map((column) => `target.[${column}]=source.[${column}]`);
        if (hasRowVersion) updates.push("target.[row_version]=COALESCE(target.[row_version],0)+1");
        const update = updates.join(",");
        const insertColumns = columns.map((column) => `[${column}]`).join(",");
        const insertValues = columns.map((column) => `source.[${column}]`).join(",");
        const matched = op.kind === "upsert" && update && !["immutable_reversal", "movement_delta"].includes(table.conflictRule) ? `WHEN MATCHED THEN UPDATE SET ${update}` : "";
        const result = await request.query(`MERGE dbo.[${op.table}] WITH (HOLDLOCK) AS target USING (SELECT ${source}) AS source ON ${on} ${matched} WHEN NOT MATCHED THEN INSERT (${insertColumns}) VALUES (${insertValues});`);
        affected += result.rowsAffected?.reduce((sum, count) => sum + count, 0) ?? 0;
      }
      return affected;
    }
    const match = Object.entries(op.match ?? {});
    if (!match.length) throw new Error("Update and delete operations require a match.");
    const request = new (this.connectionManager.sql().Request)(transaction);
    match.forEach(([, value], index) => { if (value !== null) request.input(`m${index}`, valueForSql(value)); });
    const where = match.map(([column, value], index) => value === null ? `[${column}] IS NULL` : `[${column}]=@m${index}`).join(" AND ");
    let query;
    if (op.kind === "delete") query = `DELETE FROM dbo.[${op.table}] WHERE ${where};`;
    else {
      const values = Object.entries(op.values ?? {}).filter(([column]) => column !== "row_version");
      if (!values.length && !hasRowVersion) return 0;
      values.forEach(([, value], index) => request.input(`v${index}`, valueForSql(value)));
      const setters = values.map(([column], index) => `[${column}]=@v${index}`);
      if (hasRowVersion) setters.push("[row_version]=COALESCE([row_version],0)+1");
      query = `UPDATE dbo.[${op.table}] SET ${setters.join(",")} WHERE ${where};`;
    }
    const result = await request.query(query);
    return result.rowsAffected?.reduce((sum, count) => sum + count, 0) ?? 0;
  }
  branchPredicate(table, alias = "source", seen = new Set()) {
    return branchPredicate(this.registry, table, alias, seen);
  }
  async query(branchId, tableName, options = {}) {
    const table = this.cloudTables.get(String(tableName ?? ""));
    if (!table || !SAFE_RENDERER_TABLES.has(table.cloudTable)) {
      throw Object.assign(new Error("Unsupported local business read."), { code: "EQUERY_TABLE" });
    }
    if (!branchId) throw Object.assign(new Error("The terminal branch is not configured."), { code: "EBRANCH" });
    const byCloud = new Map(table.columns.map((column) => [column.cloudColumn, column]));
    const requested = String(options.columns ?? "*").trim();
    const columns = requested === "*"
      ? table.columns
      : requested.split(",").map((name) => byCloud.get(name.trim())).filter(Boolean);
    if (!columns.length || (requested !== "*" && columns.length !== requested.split(",").length)) {
      throw Object.assign(new Error("Unsupported local query column."), { code: "EQUERY_COLUMN" });
    }
    const request = this.pool().request().input("branch", String(branchId));
    const where = [];
    const scope = this.branchPredicate(table);
    if (scope) where.push(scope);
    let parameter = 0;
    for (const [cloudColumn, value] of Object.entries(options.match ?? {})) {
      const column = byCloud.get(cloudColumn);
      if (!column) throw Object.assign(new Error("Unsupported local match column."), { code: "EQUERY_COLUMN" });
      if (value === null) where.push(`source.[${column.sqlServerColumn}] IS NULL`);
      else {
        const name = `match${parameter++}`;
        request.input(name, valueForSql(value));
        where.push(`source.[${column.sqlServerColumn}]=@${name}`);
      }
    }
    if (options.in) {
      const column = byCloud.get(options.in.column);
      const values = Array.isArray(options.in.values) ? options.in.values.slice(0, MAX_QUERY_ROWS) : [];
      if (!column) throw Object.assign(new Error("Unsupported local list column."), { code: "EQUERY_COLUMN" });
      if (!values.length) return { ok: true, rows: [] };
      const names = values.map((value) => {
        const name = `in${parameter++}`;
        request.input(name, valueForSql(value));
        return `@${name}`;
      });
      where.push(`source.[${column.sqlServerColumn}] IN (${names.join(",")})`);
    }
    const primary = table.columns.find((column) => column.primaryKey) ?? table.columns[0];
    const orderColumn = options.orderBy?.column ? byCloud.get(options.orderBy.column) : primary;
    if (!orderColumn) throw Object.assign(new Error("Unsupported local order column."), { code: "EQUERY_COLUMN" });
    const limit = Math.max(1, Math.min(MAX_QUERY_ROWS, Number(options.limit ?? MAX_QUERY_ROWS) || MAX_QUERY_ROWS));
    const offset = Math.max(0, Number(options.offset ?? 0) || 0);
    const direction = options.orderBy?.ascending === false ? "DESC" : "ASC";
    if (options.cursor) {
      const cursorColumn = byCloud.get(options.cursor.column);
      if (!cursorColumn || cursorColumn.cloudColumn !== orderColumn.cloudColumn) throw Object.assign(new Error("The local query cursor does not match its order."), { code: "EQUERY_CURSOR" });
      const operator = direction === "DESC" ? "<" : ">";
      request.input("cursorValue", valueForSql(options.cursor.value));
      request.input("cursorId", valueForSql(options.cursor.id));
      where.push(`(source.[${cursorColumn.sqlServerColumn}]${operator}@cursorValue OR (source.[${cursorColumn.sqlServerColumn}]=@cursorValue AND source.[${primary.sqlServerColumn}]${operator}@cursorId))`);
    }
    request.input("limit", limit);
    request.input("offset", offset);
    const select = columns.map((column) => `source.[${column.sqlServerColumn}] AS [${column.cloudColumn}]`).join(",");
    const tieOrder = primary.sqlServerColumn === orderColumn.sqlServerColumn ? "" : `,source.[${primary.sqlServerColumn}] ${direction}`;
    const result = await request.query(`SELECT ${select} FROM dbo.[${table.sqlServerTable}] source ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY source.[${orderColumn.sqlServerColumn}] ${direction}${tieOrder} OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY;`);
    return { ok: true, rows: result.recordset ?? [] };
  }
  /**
   * Database-side tender aggregation for a shift close. This stays bounded in
   * Node/renderer memory even when a shift contains millions of sales; SQL
   * Server scans/aggregates the matching rows and returns one record.
   */
  async shiftExpectedTotals(branchId, shiftId) {
    if (!branchId) throw Object.assign(new Error("The terminal branch is not configured."), { code: "EBRANCH" });
    const request = this.pool().request()
      .input("branch", String(branchId))
      .input("shift", String(shiftId));
    const result = await request.query(`
      SELECT
        CAST(COALESCE(SUM(CASE WHEN COALESCE(s.is_refunded,0)=0 THEN COALESCE(s.total_amount,0) ELSE 0 END),0) AS decimal(38,12)) total_sales,
        CAST(COALESCE(sh.opening_float,0) + COALESCE(SUM(
          CASE
            WHEN ISJSON(s.payments)=1 AND LEFT(LTRIM(s.payments),1)='[' THEN COALESCE(j.cash,0)
            WHEN LOWER(COALESCE(s.payment_type,''))='cash' THEN COALESCE(s.total_amount,0)
            ELSE 0
          END),0) AS decimal(38,12)) expected_cash,
        CAST(COALESCE(SUM(
          CASE
            WHEN ISJSON(s.payments)=1 AND LEFT(LTRIM(s.payments),1)='[' THEN COALESCE(j.card,0)
            WHEN LOWER(COALESCE(s.payment_type,''))='card' THEN COALESCE(s.total_amount,0)
            ELSE 0
          END),0) AS decimal(38,12)) expected_card,
        CAST(COALESCE(SUM(
          CASE
            WHEN ISJSON(s.payments)=1 AND LEFT(LTRIM(s.payments),1)='[' THEN COALESCE(j.digital,0)
            WHEN LOWER(COALESCE(s.payment_type,'')) IN ('wallet','transfer','qr','online','ewallet') THEN COALESCE(s.total_amount,0)
            ELSE 0
          END),0) AS decimal(38,12)) expected_digital
      FROM dbo.shifts sh
      LEFT JOIN dbo.sales s ON s.shift_id=CONVERT(nvarchar(36),sh.id) AND COALESCE(s.is_refunded,0)=0
      OUTER APPLY (
        SELECT
          SUM(CASE WHEN LOWER(COALESCE(p.method,''))='cash' THEN COALESCE(p.amount,0) ELSE 0 END) cash,
          SUM(CASE WHEN LOWER(COALESCE(p.method,''))='card' THEN COALESCE(p.amount,0) ELSE 0 END) card,
          SUM(CASE WHEN LOWER(COALESCE(p.method,'')) IN ('wallet','transfer','qr','online','ewallet') THEN COALESCE(p.amount,0) ELSE 0 END) digital
        FROM OPENJSON(CASE WHEN ISJSON(s.payments)=1 AND LEFT(LTRIM(s.payments),1)='[' THEN s.payments ELSE N'[]' END)
        WITH (method nvarchar(64) '$.method', amount decimal(38,12) '$.amount') p
      ) j
      WHERE sh.id=TRY_CONVERT(uniqueidentifier,@shift) AND sh.store_id=@branch
      GROUP BY sh.opening_float;
    `);
    const row = result.recordset?.[0];
    if (!row) throw Object.assign(new Error("That shift does not exist in this branch."), { code: "ESHIFT" });
    return { ok: true, ...row };
  }
  async snapshot(branchId = null) {
    // Branch-owned rows are loaded separately with an explicit predicate.
    // The list below contains only shared catalogue/reference data.
    const names = ["products", "members", "stores", "promotions", "member_tiers"];
    const output = {};
    for (const name of names) {
      if (!this.tables.has(name)) continue;
      const result = await this.pool().request().query(`SELECT TOP (2000) * FROM dbo.[${name}] ORDER BY [id];`);
      output[name === "member_tiers" ? "tiers" : name] = result.recordset ?? [];
    }
    if (this.tables.has("pos_settings")) {
      const result = await this.pool().request().query("SELECT TOP (1) * FROM dbo.pos_settings ORDER BY id;");
      output.settings = result.recordset?.[0] ?? null;
    }
    if (this.tables.has("shifts")) {
      const result = branchId
        ? await this.pool().request().input("branch", String(branchId)).query("SELECT TOP (2000) * FROM dbo.shifts WHERE store_id=@branch ORDER BY [id];")
        : { recordset: [] };
      output.shifts = result.recordset ?? [];
    }
    if (this.tables.has("sales")) {
      if (!branchId) {
        output.sales = [];
      } else {
        // A receipt is a graph, not just its header. Return the children in the
        // same SQL batch so the renderer can display/reprint a locally committed
        // sale immediately, including while the cloud is unavailable.
        const hasItems = this.tables.has("sale_items");
        const hasPayments = this.tables.has("payment_transactions");
        const result = await this.pool().request().input("branch", String(branchId)).query(`
          DECLARE @recent_sales TABLE (id uniqueidentifier PRIMARY KEY);
          INSERT @recent_sales(id)
            SELECT TOP (500) id FROM dbo.sales WHERE store_id=@branch ORDER BY created_at DESC,id;
          SELECT s.* FROM dbo.sales s JOIN @recent_sales r ON r.id=s.id ORDER BY s.created_at DESC,s.id;
          ${hasItems ? "SELECT i.* FROM dbo.sale_items i JOIN @recent_sales r ON r.id=i.sale_id ORDER BY i.sale_id,i.id;" : "SELECT TOP (0) CAST(NULL AS uniqueidentifier) sale_id;"}
          ${hasPayments ? "SELECT p.* FROM dbo.payment_transactions p JOIN @recent_sales r ON r.id=p.sale_id ORDER BY p.sale_id,p.created_at,p.id;" : "SELECT TOP (0) CAST(NULL AS uniqueidentifier) sale_id;"}
        `);
        const recordsets = result.recordsets ?? [result.recordset ?? [], [], []];
        const sales = recordsets[0] ?? [];
        const items = recordsets[1] ?? [];
        const payments = recordsets[2] ?? [];
        const bySale = (rows) => {
          const grouped = new Map();
          for (const row of rows) {
            const key = String(row.sale_id ?? "");
            if (!key) continue;
            const group = grouped.get(key) ?? [];
            group.push(row);
            grouped.set(key, group);
          }
          return grouped;
        };
        const itemsBySale = bySale(items);
        const paymentsBySale = bySale(payments);
        const jsonArray = (value) => {
          if (Array.isArray(value)) return value;
          if (typeof value !== "string" || !value.trim()) return [];
          try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; }
          catch { return []; }
        };
        output.sales = sales.map((sale) => {
          const embedded = jsonArray(sale.payments);
          const ledger = (paymentsBySale.get(String(sale.id)) ?? []).map((payment) => {
            const metadata = (() => {
              try { return typeof payment.metadata === "string" ? JSON.parse(payment.metadata) : (payment.metadata ?? {}); }
              catch { return {}; }
            })();
            return {
              id: String(payment.id ?? ""),
              method: String(payment.method ?? payment.payment_method ?? "cash"),
              amount: Number(payment.amount ?? 0),
              reference: payment.reference ?? payment.transaction_reference ?? undefined,
              referenceNote: metadata.reference_note ?? undefined,
              bankName: metadata.bank ?? undefined,
            };
          });
          return {
            ...sale,
            sale_items: itemsBySale.get(String(sale.id)) ?? [],
            payments: embedded.length ? embedded : ledger,
          };
        });
      }
    }
    return { ok: true, ...output };
  }
}

module.exports = { OperationsRepository, MAX_BATCH_ROWS, MAX_ENCODED_BYTES, MAX_QUERY_ROWS, SAFE_RENDERER_TABLES };
