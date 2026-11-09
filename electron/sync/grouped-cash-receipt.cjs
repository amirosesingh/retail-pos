const grouped = require("./grouped-store-settings.cjs");
const { recordId } = require("./uuid-fields.cjs");
const { hasCashAcceptance } = require("../db/sale-event-outbox.cjs");

const CHECKPOINT = "__grouped_cash_receipts_v1__";
const FIELDS = {
  sales: "id bill_number client_transaction_id store_id branch_id shift_id subtotal_amount total_amount discount_amount tax_amount payment_type payments points_earned points_redeemed is_exchange is_refunded created_at paid_amount change_amount exchange_credit coupon_discount rounding_adjustment row_version",
  sale_items: "id sale_id branch_id product_id product_name quantity unit_price discount_percent discount_amount tax_rate is_return is_foc created_at coupon_discount unit_cost row_version refunded_qty",
  payment_transactions: "id source_type sale_id store_id shift_id terminal_id amount method kind note paid_at created_at updated_at row_version status metadata",
  item_activity_logs: "id product_id store_id terminal_id activity_type reference quantity_delta unit_cost note created_at row_version",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$/;
const fail = (message, code = "ESYNC_CASH_RECEIPT_PROTOCOL") => Object.assign(new Error(message), { code, table: "sales" });
const uuid = value => typeof value === "string" && UUID.test(value);
const keys = (value, fields) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
const decimal = value => typeof value === "string" && /^-?(?:0|[1-9]\d{0,25})(?:\.\d{1,12})?$/.test(value);
const exact = value => {
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  return BigInt(whole + fraction.padEnd(12, "0")) * (value.startsWith("-") ? -1n : 1n);
};

function validValue(column, value) {
  const type = column.sqlServerType;
  if (type === "uniqueidentifier") return uuid(value);
  if (type === "bit") return typeof value === "boolean";
  if (type === "int") return Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;
  if (type === "decimal(38,12)") return decimal(value);
  if (type === "decimal(18,4)") return typeof value === "string" && /^-?(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/.test(value);
  if (type === "datetimeoffset(7)") return typeof value === "string" && INSTANT.test(value) && Number.isFinite(Date.parse(value));
  const length = /^nvarchar\((max|\d+)\)$/.exec(type);
  return length && typeof value === "string" && !value.includes("\0") &&
    (length[1] === "max" || value.length <= Number(length[1]));
}

function normalize(receipt, branch, epoch, terminal, registry, acceptance = null) {
  if (!keys(receipt, ["scope_id", "epoch", "seq", "operation_id", "changes"]) || receipt.scope_id !== branch ||
      !uuid(epoch) || receipt.epoch !== epoch || !uuid(receipt.operation_id) || typeof receipt.seq !== "string" ||
      !/^[1-9]\d{0,18}$/.test(receipt.seq) || BigInt(receipt.seq) > 9223372036854775807n ||
      !Array.isArray(receipt.changes) || receipt.changes.length !== 4 || Buffer.byteLength(JSON.stringify(receipt)) > 524288)
    throw fail("The grouped cash receipt is outside the verified scope or shape.");

  const rows = Object.entries(FIELDS).map(([name, list], index) => {
    const table = registry.tables.find(item => item.cloudTable === name && item.sqlServerTable === name);
    const change = receipt.changes[index];
    const row = change?.row_data;
    const fields = list.split(" ");
    let key;
    try { key = JSON.parse(change?.entity_id); } catch { throw fail("A grouped cash receipt key is invalid."); }
    if (!table || !keys(change, ["table_name", "entity_id", "row_data", "row_version", "tombstone"]) ||
        change.table_name !== name || change.tombstone !== false || !keys(row, fields) || !keys(key, ["id"]) ||
        !uuid(key.id) || key.id !== row.id || change.row_version !== "1" || row.row_version !== "1")
      throw fail("The grouped cash receipt does not contain the complete registered rows.");
    for (const field of fields) {
      if (["payments", "metadata", "row_version"].includes(field)) continue;
      const column = table.columns.find(item => item.cloudColumn === field && item.sqlServerColumn === field);
      if (!column || !validValue(column, row[field])) throw fail("The grouped cash receipt contains an invalid SQL Server value.");
    }
    return { table, change: { ...change, entity_id: JSON.stringify(key), row_data: { ...row, row_version: 1 } } };
  });
  const [sale, item, tender, movement] = rows.map(entry => entry.change.row_data);
  const payment = sale.payments?.[0];
  if (sale.store_id !== branch || sale.branch_id !== branch || item.branch_id !== branch || tender.store_id !== branch ||
      movement.store_id !== branch || !uuid(sale.shift_id) || tender.shift_id !== sale.shift_id ||
      !uuid(tender.terminal_id) || movement.terminal_id !== tender.terminal_id ||
      (acceptance ? acceptance.terminal_id !== tender.terminal_id : tender.terminal_id === terminal) ||
      item.sale_id !== sale.id || tender.sale_id !== sale.id || movement.product_id !== item.product_id ||
      movement.reference !== sale.bill_number || movement.activity_type !== "sale" || item.quantity <= 0 ||
      movement.quantity_delta !== -item.quantity || sale.payment_type !== "cash" || sale.is_exchange || sale.is_refunded ||
      item.is_return || item.is_foc || item.refunded_qty !== 0 || tender.source_type !== "sale" || tender.method !== "cash" ||
      tender.kind !== "payment" || tender.status !== "completed" || !keys(tender.metadata, []) ||
      !Array.isArray(sale.payments) || sale.payments.length !== 1 || !keys(payment, ["id", "method", "amount"]) ||
      payment.id !== tender.id || payment.method !== "cash" || !decimal(payment.amount) ||
      exact(payment.amount) !== exact(tender.amount) || exact(tender.amount) !== exact(sale.total_amount))
    throw fail("The grouped cash receipt rows do not describe one ordinary checkout for this branch.");
  return { rows, sale, item, tender, movement, epoch, operationId: receipt.operation_id, seq: receipt.seq, acceptance };
}

function parseMixedCashGroup(group, branch, epoch, terminal, registry) {
  const acceptance = group?.acceptance;
  if (!keys(group, ["seq", "operation_id", "changes", "acceptance"]) ||
      !keys(acceptance, ["terminal_id", "installation_generation", "database_guid", "checkout_sha256"]) ||
      !uuid(acceptance.terminal_id) || !uuid(acceptance.installation_generation) || !uuid(acceptance.database_guid) ||
      typeof acceptance.checkout_sha256 !== "string" || !HASH.test(acceptance.checkout_sha256))
    throw fail("The grouped cash receipt does not carry complete canonical acceptance.");
  return normalize({ scope_id: branch, epoch, seq: group.seq, operation_id: group.operation_id, changes: group.changes },
    branch, epoch, terminal, registry, acceptance);
}

async function assertTracking(transaction, branch, table, id) {
  const name = table.sqlServerTable;
  const result = await transaction.request().input("branch", branch).input("entity", name).input("id", id).query(`
    DECLARE @baseline bigint=(SELECT change_tracking_version FROM dbo.sync_checkpoints WITH (HOLDLOCK)
      WHERE organization_id=N'default' AND branch_id=@branch AND entity_type=@entity AND direction=N'push');
    DECLARE @minimum bigint=CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(N'dbo.${name}'));
    IF @baseline IS NULL OR @minimum IS NULL OR @baseline<@minimum OR @baseline>CHANGE_TRACKING_CURRENT_VERSION()
    BEGIN SELECT N'unverified' AS state; RETURN; END;
    DECLARE @pending bit=CASE WHEN EXISTS (SELECT 1 FROM CHANGETABLE(CHANGES dbo.[${name}], @baseline) AS ct
      WHERE ct.id=@id AND (ct.SYS_CHANGE_CONTEXT IS NULL OR ct.SYS_CHANGE_CONTEXT<>0x434C4F5544)) THEN 1 ELSE 0 END;
    SET @minimum=CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(N'dbo.${name}'));
    SELECT CASE WHEN @minimum IS NULL OR @baseline<@minimum THEN N'unverified'
      WHEN @pending=1 THEN N'pending' ELSE N'clear' END AS state;`);
  const state = result.recordset?.[0]?.state;
  if (state === "pending") throw fail("A local receipt change is pending upload.", "ELOCAL_UPLOAD_PENDING");
  if (state !== "clear") throw fail("The local receipt Change Tracking boundary cannot be verified.", "ELOCAL_PENDING_UNVERIFIED");
}

async function assertDependencies(transaction, branch, { sale, item, tender }) {
  const result = await transaction.request().input("branch", branch).input("shift", sale.shift_id)
    .input("terminal", tender.terminal_id).input("product", item.product_id).input("bill", sale.bill_number).query(`
    SELECT CASE WHEN EXISTS (SELECT 1 FROM dbo.shifts WITH (HOLDLOCK) WHERE id=@shift AND store_id=@branch AND terminal_id=@terminal)
      AND EXISTS (SELECT 1 FROM dbo.products WITH (HOLDLOCK) WHERE id=@product AND owner_store_id=@branch)
      AND NOT EXISTS (SELECT 1 FROM dbo.held_orders WITH (UPDLOCK,HOLDLOCK) WHERE store_id=@branch
        AND bill_no=@bill AND (status IS NULL OR status<>N'completed')) THEN 1 ELSE 0 END AS ready;`);
  if (result.recordset?.[0]?.ready !== 1)
    throw fail("The receiving till requires the source shift and product, with no unresolved held ticket.", "ESYNC_CASH_RECEIPT_DEPENDENCY");
}

// Sender rows can contain local-only fields or authorized later corrections.
// Confirm the accepted receipt's linked rows still belong to this checkout,
// without applying the receiver projection back over the originating sale.
const originFields = {
  sales: ["id", "store_id", "branch_id", "shift_id", "bill_number", "client_transaction_id"],
  sale_items: ["id", "sale_id", "branch_id", "product_id"],
  payment_transactions: ["id", "sale_id", "store_id", "shift_id"],
  item_activity_logs: ["id", "store_id", "product_id", "reference"],
};

async function applyGroupedCashInTransaction(worker, transaction, context, facts) {
  const { cloud, reader } = worker;
  const { source, branch, databaseGuid } = context;
  if (facts.tender.terminal_id === recordId(source.terminal.tokenId)) {
    const acceptance = facts.acceptance;
    if (!acceptance || acceptance.database_guid !== databaseGuid || !await hasCashAcceptance(transaction, {
      operationId: facts.operationId, saleId: facts.sale.id, itemId: facts.item.id, tenderId: facts.tender.id,
      movementId: facts.movement.id, seq: facts.seq, branchId: branch, epoch: facts.epoch,
      terminalId: acceptance.terminal_id, installationGeneration: acceptance.installation_generation,
      databaseGuid, checkoutSha256: acceptance.checkout_sha256,
    })) throw fail("The originating till has not verified this cash acceptance locally.", "ELOCAL_UPLOAD_PENDING");
    for (const { table, change } of facts.rows) {
      const row_data = Object.fromEntries(originFields[table.cloudTable].map(field => [field, change.row_data[field]]));
      if ((await grouped.readLocalRow(transaction, table, { row_data }, "id", row_data.id))?.matching !== 1)
        throw fail("The originating till is missing verified checkout evidence.", "ESYNC_CASH_RECEIPT_REVIEW");
    }
    return [];
  }

  await assertDependencies(transaction, branch, facts);
  const missing = [];
  for (const { table, change } of facts.rows) {
    const id = change.row_data.id;
    const local = await grouped.readLocalRow(transaction, table, change, "id", id);
    const pending = await reader.unacknowledged(table, [change.entity_id], transaction, { branchId: branch });
    if (pending.size) throw fail("A local receipt change is pending upload.", "ELOCAL_UPLOAD_PENDING");
    await assertTracking(transaction, branch, table, id);
    if (local && local.matching !== 1) throw fail("The local receipt differs from the canonical group.", "ESYNC_CASH_RECEIPT_REVIEW");
    if (!local) missing.push({ table, change, id });
  }
  require("./grouped-cash-legacy.cjs").allowCashApply(transaction, missing.map(({ change }) => change));
  for (const { table, change, id } of missing) {
    await cloud.applyLocalBatch(transaction, table, { rows: [change], tombstones: [] });
    if ((await grouped.readLocalRow(transaction, table, change, "id", id))?.matching !== 1)
      throw fail("The native merge did not confirm the cash receipt.", "ESYNC_CASH_RECEIPT_REVIEW");
  }
  return missing;
}

// Prepared receiving boundary. The fixture supplies a verified isolated epoch;
// an installed caller must establish its authorization and baseline first.
async function applyGroupedCashReceipt(worker, { receipt, epoch }) {
  const { cloud, connectionManager, registry, checkpoints } = worker;
  const source = cloud.requestContext(false);
  const branch = grouped.operationsScope(source);
  const terminal = recordId(source.terminal.tokenId);
  if (!uuid(terminal) || source.pool !== connectionManager.pool) throw fail("The receiving till registration is unavailable.");
  const facts = normalize(receipt, branch, epoch, terminal, registry);
  const databaseGuid = await grouped.readDatabaseGuid(source.pool.request());
  cloud.assertRequestContext(source, false);
  const sql = connectionManager.sql();
  const transaction = new sql.Transaction(source.pool);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  let applied = 0;
  try {
    if (await grouped.readDatabaseGuid(transaction.request()) !== databaseGuid)
      throw fail("The receiving SQL Server database changed.", "ESYNC_GROUPED_DATABASE_CHANGED");
    const prior = await grouped.readPosition(transaction.request(), { branch, source, databaseGuid, checkpoint: CHECKPOINT }, true);
    if (prior && (prior.epoch !== epoch || prior.upper !== null)) throw fail("The cash receipt epoch changed.");
    const seq = BigInt(receipt.seq);
    const previous = BigInt(prior?.seq ?? "0");
    if (seq <= previous) {
      await transaction.rollback();
      return { status: "POSITION_ALREADY_ADVANCED", seq: prior.seq };
    }
    if (seq !== previous + 1n) throw fail("The grouped cash receipt skipped a position.");
    applied = (await applyGroupedCashInTransaction(worker, transaction, { source, branch, databaseGuid }, facts)).length;
    cloud.assertRequestContext(source, false);
    await checkpoints.save(branch, CHECKPOINT, "pull",
      { committed_cursor: JSON.stringify({ source: source.fingerprint, databaseGuid, epoch, seq: receipt.seq, upper: null }) }, transaction);
    cloud.assertRequestContext(source, false);
    await transaction.commit();
  } catch (error) {
    await Promise.resolve(transaction.rollback()).catch(() => undefined);
    throw error;
  }
  return { status: "OK", seq: receipt.seq, applied };
}

module.exports = { CHECKPOINT, parseMixedCashGroup, applyGroupedCashInTransaction, applyGroupedCashReceipt };
