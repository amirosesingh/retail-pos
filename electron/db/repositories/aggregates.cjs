const { createHash } = require("node:crypto");
const { branchPredicate } = require("../branch-scope.cjs");

const AGGREGATE_KINDS = new Set([
  "sale", "payment", "refund", "shift", "receiving", "stock",
  "transfer", "booking", "held_order", "general",
]);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

function stableUuid(value) {
  const hex = createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}

function entityKey(table, row, match = null) {
  const primary = table.columns.filter((column) => column.primaryKey).map((column) => column.sqlServerColumn);
  const source = { ...(match ?? {}), ...(row ?? {}) };
  const key = Object.fromEntries(primary.map((column) => [column, source[column]]));
  if (!primary.length || Object.values(key).some((value) => value == null))
    throw new Error(`A complete stable key is required for ${table.sqlServerTable}.`);
  const encoded = JSON.stringify(key);
  if (encoded.length > 128) throw new Error(`The stable key for ${table.sqlServerTable} is too large.`);
  return encoded;
}

function branchFor(operation, fallback) {
  const row = { ...(operation.match ?? {}), ...(operation.rows?.[0] ?? operation.values ?? {}) };
  return String(row.store_id ?? row.branch_id ?? row.from_store_id ?? row.to_store_id ?? fallback ?? "global").slice(0, 128);
}

class AggregateRepository {
  constructor(connectionManager, operationsRepository) {
    this.connectionManager = connectionManager;
    this.operationsRepository = operationsRepository;
  }

  async assertBranch(transaction, table, record, match, branchId) {
    if (table.scope !== "branch") return;
    if (!branchId) throw Object.assign(new Error("The terminal branch is not configured."), { code: "EBRANCH" });
    const predicate = branchPredicate(this.operationsRepository.registry, table, "candidate");
    // Some catalogue tables are marked branch-aware but intentionally carry
    // stock for several stores in one shared row. Their generated registry has
    // no row predicate; server-side stock movement RPCs protect those writes.
    if (!predicate) return;
    const primary = table.columns.filter((column) => column.primaryKey).map((column) => column.sqlServerColumn);
    const source = { ...(match ?? {}), ...(record ?? {}) };
    if (!primary.length || primary.some((column) => source[column] == null))
      throw Object.assign(new Error(`A complete stable key is required for ${table.sqlServerTable}.`), { code: "EBRANCH_SCOPE" });
    const request = new (this.connectionManager.sql().Request)(transaction).input("branch", String(branchId));
    const key = primary.map((column, index) => {
      request.input(`scope${index}`, source[column]);
      return `candidate.[${column}]=@scope${index}`;
    }).join(" AND ");
    const result = await request.query(`SELECT CASE WHEN EXISTS(
      SELECT 1 FROM dbo.[${table.sqlServerTable}] candidate WHERE ${key} AND (${predicate})
    ) THEN 1 ELSE 0 END allowed;`);
    if (Number(result.recordset?.[0]?.allowed ?? 0) !== 1)
      throw Object.assign(new Error(`${table.cloudTable} does not belong to this terminal branch.`), {
        code: "SYNC_BRANCH_FORBIDDEN", table: table.cloudTable,
      });
  }

  async commit(kind, aggregate) {
    if (!AGGREGATE_KINDS.has(kind)) throw new Error("Unsupported aggregate type.");
    const operations = this.operationsRepository.validate(aggregate?.operations);
    const operationId = aggregate?.operationId || stableUuid({ kind, operations });
    if (!/^[0-9a-f-]{36}$/i.test(operationId)) throw new Error("A stable aggregate UUID is required.");
    const payloadHash = createHash("sha256").update(JSON.stringify(canonical({ kind, operations }))).digest("hex");
    const sql = this.connectionManager.sql();
    const transaction = new sql.Transaction(this.operationsRepository.pool());
    await transaction.begin(sql.ISOLATION_LEVEL?.SERIALIZABLE);
    let stage = "operation receipt";
    let tableName = null;
    try {
      const prior = await new sql.Request(transaction).input("operation_id", sql.UniqueIdentifier, operationId)
        .query("SELECT note FROM dbo.local_operation_receipts WITH (UPDLOCK,HOLDLOCK) WHERE operation_id=@operation_id;");
      if (prior.recordset?.length) {
        if (prior.recordset[0].note !== payloadHash)
          throw Object.assign(new Error("The operation ID was already used with different data."), { code: "EIDEMPOTENCY" });
        await transaction.commit();
        return { ok: true, operationId, replayed: true, affected: 0 };
      }

      let affected = 0;
      for (const operation of operations) {
        stage = "business rows";
        tableName = operation.table;
        if (this.operationsRepository.tables.get(operation.table)?.direction === "pull")
          throw new Error(`${operation.table} is centrally managed and cannot be changed by the local database.`);
        const table = this.operationsRepository.tables.get(operation.table);
        const records = operation.rows?.length ? operation.rows : [operation.values ?? operation.match];
        // Deletes must be checked while their owner row still exists. Inserts
        // and updates are checked after application so child ownership can be
        // resolved through a parent written earlier in the same aggregate.
        if (operation.kind === "delete") {
          for (const record of records) await this.assertBranch(transaction, table, record, operation.match, aggregate.branchId);
        }
        affected += await this.operationsRepository.applyOperation(transaction, operation);
        if (operation.kind !== "delete") {
          for (const record of records) await this.assertBranch(transaction, table, record, operation.match, aggregate.branchId);
        }
        for (const record of records) {
          const request = new sql.Request(transaction)
            .input("entity_type", operation.table)
            .input("entity_id", entityKey(table, record, operation.match))
            .input("operation", operation.kind === "delete" ? "delete" : operation.kind === "insert" ? "insert" : "update")
            .input("branch_id", branchFor(operation, aggregate.branchId))
            .input("entity_version", Number(record?.row_version ?? 1))
            .input("aggregate_id", sql.UniqueIdentifier, operationId);
          await request.query(`INSERT dbo.sync_change_journal(entity_type,entity_id,operation,branch_id,entity_version,aggregate_id)
            VALUES(@entity_type,@entity_id,@operation,@branch_id,@entity_version,@aggregate_id);`);
        }
      }
      stage = "operation receipt";
      tableName = "local_operation_receipts";
      await new sql.Request(transaction)
        .input("operation_id", sql.UniqueIdentifier, operationId)
        .input("operation_type", kind)
        .input("entity_id", operationId)
        .input("note", payloadHash)
        .query("INSERT dbo.local_operation_receipts(operation_id,operation_type,entity_id,note) VALUES(@operation_id,@operation_type,@entity_id,@note);");
      await transaction.commit();
      return { ok: true, operationId, replayed: false, affected };
    } catch (error) {
      await Promise.resolve(transaction.rollback()).catch(() => undefined);
      if (error?.code === "EIDEMPOTENCY") throw error;
      const target = tableName ? ` while writing ${tableName}` : "";
      const sqlNumber = Number.isFinite(Number(error?.number)) ? Number(error.number) : null;
      const suffix = sqlNumber == null ? "" : ` (SQL Server ${sqlNumber})`;
      throw Object.assign(
        new Error(`Local SQL Server ${kind} commit failed${target}${suffix}.`),
        { code: "ESQLSERVER_WRITE", stage, table: tableName, sqlNumber, cause: error },
      );
    }
  }
}

module.exports = { AggregateRepository, AGGREGATE_KINDS, stableUuid, canonical };
