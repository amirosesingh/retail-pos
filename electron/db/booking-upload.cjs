const { createHash } = require("node:crypto");
const { recordId } = require("../sync/uuid-fields.cjs");
const { toCloudRow } = require("../sync/row-codec.cjs");
const { projection } = require("../sync/shift-recovery-exact.cjs");

const TABLE = "dbo.pos_sync_booking_payloads_v1";
const TYPES = ["booking_frozen", "booking_handover_frozen"];
const BOOKING_TABLES = new Set(["bookings", "booking_payments", "sales", "sale_items", "payment_transactions",
  "item_activity_logs", "products", "members", "stock_movements", "stock_delta_applied", "held_orders", "audit_logs"]);
const COVERED_VERSIONS = new Set(["bookings", "booking_payments", "sales", "sale_items", "payment_transactions",
  "item_activity_logs", "members", "held_orders"]);
const MAX_BYTES = 6 * 1024 * 1024;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const digest = value => createHash("sha256").update(value, "utf8").digest("hex");
const fail = () => Object.assign(new Error("The original booking transaction could not be verified. Saved changes remain pending."),
  { code: "EBOOKING_UPLOAD_UNVERIFIED", table: "bookings" });

function capturesBooking(operations) {
  return operations.every(op => BOOKING_TABLES.has(op.table) && op.kind !== "delete") &&
    operations.some(op => op.table === "bookings" || op.table === "booking_payments");
}

async function bookingStorage(transaction) {
  // A restore may reassign database_guid. The database's backup family and
  // original registered terminal still identify the unchanged operation.
  const result = await transaction.request().query(`SELECT LOWER(CONVERT(varchar(36),family_guid)) AS family_guid,
    CONVERT(bit,CASE WHEN OBJECT_ID(N'${TABLE}',N'U') IS NULL THEN 0 ELSE 1 END) AS ready
    FROM sys.database_recovery_status WHERE database_id=DB_ID();`);
  const [row] = result.recordset ?? [];
  if (!row?.ready) throw Object.assign(new Error("Update the local POS database before saving a booking."),
    { code: "EBOOKING_UPLOAD_STORAGE", table: "bookings" });
  if (!UUID.test(row.family_guid)) throw fail();
  return row.family_guid;
}

async function assertBookingPredecessors(transaction, branchId, bookingId) {
  const result = await transaction.request().input("branch", branchId).input("booking", bookingId).query(`
    SELECT TOP(1) journal.change_id FROM dbo.sync_change_journal AS journal WITH(HOLDLOCK)
    LEFT JOIN dbo.local_operation_receipts AS receipt ON receipt.operation_id=journal.aggregate_id
    WHERE journal.branch_id=@branch AND journal.entity_type=N'bookings' AND journal.acknowledged_at IS NULL
      AND TRY_CONVERT(uniqueidentifier,JSON_VALUE(CASE WHEN ISJSON(journal.entity_id)=1 THEN journal.entity_id END,'$.id'))=@booking
      AND (receipt.operation_type IS NULL OR receipt.operation_type NOT IN(N'booking_frozen',N'booking_handover_frozen'));`);
  if (result.recordset?.length) throw Object.assign(
    new Error("This booking has changes from an earlier version that must sync before handover."),
    { code: "EBOOKING_PRIOR_PENDING", table: "bookings" });
}

async function captureBookingUpload(transaction, registry, sql, { operationId, branchId, terminalId, family, changes, financial, handover }) {
  const keys = new Map();
  for (const { table, entity, op } of changes) {
    const group = keys.get(table) ?? new Map();
    group.set(entity, op);
    keys.set(table, group);
  }
  const rows = [];
  for (const [tableName, entities] of keys) {
    const table = registry.tables.find(entry => entry.sqlServerTable === tableName);
    const primary = table?.columns.filter(column => column.primaryKey);
    if (!BOOKING_TABLES.has(tableName) || primary?.length !== 1 || !["id", "movement_id"].includes(primary[0].sqlServerColumn))
      throw fail();
    const key = primary[0].sqlServerColumn;
    const entityKeys = [...entities.keys()];
    const ids = entityKeys.map(entity => recordId(JSON.parse(entity)[key]));
    if (ids.some(id => !UUID.test(id))) throw fail();
    const result = await transaction.request().input("ids", sql.NVarChar(sql.MAX), JSON.stringify(ids)).query(`
      SELECT source.*${financial ? `,(SELECT ${projection(table)} FOR JSON PATH,INCLUDE_NULL_VALUES,WITHOUT_ARRAY_WRAPPER) AS __booking_exact` : ""}
      FROM dbo.[${tableName}] AS source WITH(HOLDLOCK)
      JOIN OPENJSON(@ids) AS requested ON source.[${key}]=CONVERT(uniqueidentifier,requested.value)
      ORDER BY CONVERT(int,requested.[key]);`);
    if (result.recordset?.length !== ids.length) throw fail();
    const saved = result.recordset.map(({ __booking_exact, ...row }, index) => {
      if (recordId(row[key]) !== ids[index]) throw fail();
      return { row: toCloudRow(table, row), ...(financial ? { exact: __booking_exact } : {}) };
    });
    if (COVERED_VERSIONS.has(tableName)) {
      const versions = saved.map(({ row }, index) => ({ entity: entityKeys[index], version: row.row_version }));
      if (versions.some(entry => !Number.isSafeInteger(entry.version) || entry.version < 1)) throw fail();
      await transaction.request().input("operation", operationId).input("table", tableName)
        .input("versions", sql.NVarChar(sql.MAX), JSON.stringify(versions)).query(`
          UPDATE journal SET entity_version=exact.[version] FROM dbo.sync_change_journal journal
          JOIN OPENJSON(@versions) WITH (entity nvarchar(128), [version] int) exact ON exact.entity=journal.entity_id
          WHERE journal.aggregate_id=@operation AND journal.entity_type=@table;`);
    }
    rows.push([tableName, saved]);
  }
  if (handover) {
    const saved = new Map(rows);
    const [booking] = saved.get("bookings") ?? [];
    const [sale] = saved.get("sales") ?? [];
    const [tender] = saved.get("booking_payments") ?? [];
    if (!booking || !sale || recordId(booking.row.id) !== recordId(handover.booking.match.id) ||
        booking.row.status !== "collected" || booking.row.sale_receipt_no !== sale.row.bill_number ||
        booking.row.row_version !== handover.booking.match.row_version + 1 || sale.row.id !== sale.row.client_transaction_id ||
        sale.row.id !== handover.sale.id || Number(sale.row.total_amount) !== Number(booking.row.paid) ||
        (tender?.row.id ?? null) !== (handover.tender?.id ?? null) ||
        (tender && (tender.row.booking_id !== booking.row.id || tender.row.client_payment_id !== sale.row.client_transaction_id ||
          Number(tender.row.amount) !== Number(handover.tender.amount) || tender.row.method !== sale.row.payment_type ||
          Number(tender.row.change_given) !== Number(sale.row.change_amount))) ||
        ["sale_items", "payment_transactions"].some(table => saved.get(table)?.some(entry => entry.row.sale_id !== sale.row.id)))
      throw fail();
  }
  const payload = JSON.stringify({ version: 1, operationId: recordId(operationId),
    branchId: recordId(branchId), terminalId: recordId(terminalId ?? null), family, changes, rows });
  if (Buffer.byteLength(payload, "utf8") > MAX_BYTES) throw fail();
  await transaction.request().input("operation", operationId).input("payload", sql.NVarChar(sql.MAX), payload).input("digest", digest(payload))
    .query(`INSERT ${TABLE}(operation_id, payload_json, payload_sha256) VALUES(@operation,@payload,@digest);`);
}

function readBookingPayload(record, { aggregateId, branchId, terminalId, changes }) {
  const { payload_json: raw, payload_sha256: checksum, family_guid: family } = record ?? {};
  if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > MAX_BYTES || digest(raw) !== checksum || !UUID.test(family)) throw fail();
  let payload;
  try { payload = JSON.parse(raw); } catch { throw fail(); }
  if (payload?.version !== 1 || payload.operationId !== recordId(aggregateId) || payload.branchId !== recordId(branchId) ||
      (payload.terminalId !== null && payload.terminalId !== recordId(terminalId)) || payload.family !== family ||
      !Array.isArray(payload.rows) || !Array.isArray(payload.changes) || payload.changes.length !== changes.length)
    throw fail();
  for (const [index, change] of changes.entries()) {
    const saved = payload.changes[index];
    if (!saved || saved.table !== change.entity_type || saved.entity !== change.entity_id || saved.op !== change.operation)
      throw fail();
  }
  const rows = new Map();
  for (const entry of payload.rows) {
    if (!Array.isArray(entry) || entry.length !== 2) throw fail();
    const [table, saved] = entry;
    if (!BOOKING_TABLES.has(table) || rows.has(table) || !Array.isArray(saved)) throw fail();
    const key = table === "stock_delta_applied" ? "movement_id" : "id";
    const expected = new Set(changes.filter(change => change.entity_type === table).map(change => recordId(change.key?.[key])));
    if (saved.length !== expected.size || saved.some(entry => !expected.delete(recordId(entry?.row?.[key])))) throw fail();
    rows.set(table, saved);
  }
  if ((!rows.has("bookings") && !rows.has("booking_payments")) || changes.some(change => !rows.has(change.entity_type))) throw fail();
  return { checksum, family, rows };
}

module.exports = { TABLE, TYPES, BOOKING_TABLES, COVERED_VERSIONS, fail, capturesBooking, bookingStorage,
  assertBookingPredecessors, captureBookingUpload, readBookingPayload };
