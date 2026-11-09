const { createHash } = require("node:crypto");
const { decimal, projection } = require("../sync/shift-recovery-exact.cjs");
const { recordId } = require("../sync/uuid-fields.cjs");
const { wireFields, cashBridgeCheckout, checkedCashBridgeScope, refuseCashBridge } = require("./sale-cash-wire.cjs");
const { normalizeCashCheckoutAttestation } = require("../security/financial-author-protocol.cjs");
const cashRoute = require("../sync/cash-checkout-route.cjs");

const EVENT_TYPE = "SaleCompleted";
const MAX_PAYLOAD_BYTES = 512 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const databaseGuidQuery = "SELECT LOWER(CONVERT(nvarchar(36),database_guid)) AS database_guid FROM sys.database_recovery_status WHERE database_id=DB_ID();";
const fields = {
  sales: ["id", "bill_number", "client_transaction_id", "store_id", "shift_id", "cashier_id", "cashier_name",
    "subtotal_amount", "total_amount", "discount_amount", "tax_amount", "payment_type", "paid_amount",
    "change_amount", "created_at", "rounding_adjustment", "rounding_label", "row_version", "member_id",
    "is_exchange", "is_refunded", "original_bill_number", "authorization_request_id", "authorized_by",
    "authorized_at", "coupon_code", "coupon_promo_id", "coupon_scope", "coupon_discount"],
  sale_items: ["id", "sale_id", "branch_id", "product_id", "product_name", "variant_code", "quantity",
    "unit_price", "unit_cost", "discount_percent", "discount_amount", "tax_rate", "is_return", "is_foc",
    "promo_id", "coupon_code", "coupon_discount", "row_version"],
  payment_transactions: ["id", "source_type", "sale_id", "store_id", "shift_id", "terminal_id", "amount",
    "method", "kind", "paid_at", "created_at", "status", "client_transaction_id", "row_version"],
  item_activity_logs: ["id", "product_id", "store_id", "terminal_id", "activity_type", "reference",
    "quantity_delta", "unit_cost", "created_at", "row_version"],
};
const legacyCheckout = () => Object.assign(new Error("This checkout uses the existing sale upload route."),
  { code: "ESALE_CASH_LEGACY_ONLY" });

function refuse() {
  throw Object.assign(new Error("The checkout is outside the supported immutable sale capture or its saved facts are incomplete."), {
    code: "ESALE_EVENT_UNVERIFIED",
  });
}

const uuid = value => typeof value === "string" && UUID.test(value);
const scopedId = value => typeof value === "string" && value.length <= 128 && value.trim() === value && value !== "";
const positive = value => {
  const normalized = decimal(value);
  return normalized && normalized !== "0" && !normalized.startsWith("-");
};

function expectedIds(operations, table) {
  const ids = new Set();
  for (const operation of operations.filter(operation => operation.table === table)) {
    if (!["insert", "upsert"].includes(operation.kind)) refuse();
    for (const { id } of operation.rows ?? (operation.values ? [operation.values] : [])) {
      if (!uuid(id) || ids.has(recordId(id))) refuse();
      ids.add(recordId(id));
    }
  }
  return ids;
}

function assertExactIds(rows, expected) {
  if (rows.length !== expected.size) refuse();
  for (const row of rows) if (!expected.delete(recordId(row.id))) refuse();
}

const shadowRow = (table, row) => Object.fromEntries(fields[table].map(name => [name, row[name]]));
const payloadHash = payload => createHash("sha256").update(payload).digest("hex");
const maxSequence = 9223372036854775807n;
const validSequence = value => typeof value === "string" && /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= maxSequence;

function checkedAttestation(input, scope, operationId, digest) {
  let proof;
  try { proof = normalizeCashCheckoutAttestation(input); } catch { refuseCashBridge(); }
  if (proof.branchId !== scope.branchId || proof.terminalId !== scope.terminalId ||
      proof.installationGeneration !== scope.installationGeneration || proof.databaseGuid !== scope.databaseGuid ||
      proof.feedEpoch !== scope.feedEpoch || proof.operationId !== operationId || proof.payloadHash !== digest) refuseCashBridge();
  return proof;
}

/** Capture the exact journal membership in the same transaction as the sale.
 * The fifth row is the one product update already proven by its movement. */
async function cashJournal(transaction, operationId, branchId, checkout) {
  const expected = new Map([["sales", checkout.sale.id], ["sale_items", checkout.item.id],
    ["payment_transactions", checkout.tender.id], ["item_activity_logs", checkout.movement.id],
    ["products", checkout.item.product_id]]);
  const { recordset } = await transaction.request().input("operation", operationId).query(`
    SELECT TOP (6) CONVERT(varchar(20),change_id) AS id,entity_type,entity_id,operation,branch_id,
      CONVERT(varchar(20),entity_version) AS version,acknowledged_at
    FROM dbo.sync_change_journal WITH (UPDLOCK,HOLDLOCK) WHERE aggregate_id=@operation ORDER BY change_id;
  `);
  if (recordset?.length !== expected.size) refuseCashBridge();
  return recordset.map(row => {
    let entity;
    try { entity = JSON.parse(row.entity_id); } catch { refuseCashBridge(); }
    const allowedOperation = row.entity_type === "products" ? row.operation === "update" : ["insert", "update"].includes(row.operation);
    if (!entity || Object.keys(entity).length !== 1 || !expected.has(row.entity_type) ||
        recordId(entity.id) !== expected.get(row.entity_type) || row.branch_id !== branchId || !allowedOperation ||
        row.acknowledged_at !== null || !validSequence(row.id) || !validSequence(row.version)) refuseCashBridge();
    expected.delete(row.entity_type);
    return { id: row.id, table: row.entity_type, entity: row.entity_id, operation: row.operation, version: row.version };
  });
}

function readFrozenCheckout(row, scope, operationId) {
  if (typeof row.payload_json !== "string" || Buffer.byteLength(row.payload_json, "utf8") > MAX_PAYLOAD_BYTES ||
      payloadHash(row.payload_json) !== row.payload_hash || row.branch_id !== scope.branchId ||
      recordId(row.terminal_id) !== scope.terminalId || recordId(row.operation_id) !== operationId) refuseCashBridge();
  let event, checkout;
  try { event = JSON.parse(row.payload_json); } catch { refuseCashBridge(); }
  if (event?.eventType !== EVENT_TYPE || event.version !== 1 || event.operationId !== operationId ||
      recordId(event.branchId) !== scope.branchId || recordId(event.terminalId) !== scope.terminalId ||
      recordId(event.shiftId) !== recordId(row.shift_id) || recordId(event.sale?.id) !== recordId(row.sale_id)) refuseCashBridge();
  if (!event.bridge) return null;
  const recordedScope = checkedCashBridgeScope(event.bridge.scope);
  if (Object.keys(scope).some(key => scope[key] !== recordedScope[key]) || typeof event.bridge.checkoutJson !== "string") refuseCashBridge();
  try { checkout = JSON.parse(event.bridge.checkoutJson); } catch { refuseCashBridge(); }
  if (checkout?.sale?.id !== recordId(row.sale_id) || checkout.sale.shift_id !== recordId(row.shift_id) ||
      recordId(checkout.sale.branch_id) !== scope.branchId || checkout.tender?.terminal_id !== scope.terminalId ||
      checkout.movement?.terminal_id !== scope.terminalId) refuseCashBridge();
  const checkoutSha256 = payloadHash(event.bridge.checkoutJson);
  const attestation = event.bridge.attestation &&
    checkedAttestation(event.bridge.attestation, scope, operationId, checkoutSha256);
  const wire = { operationId, saleId: checkout.sale.id, checkoutJson: event.bridge.checkoutJson, checkoutSha256, scope,
    ...(attestation ? { attestation } : {}) };
  return { wire, journal: event.bridge.journal };
}

function routeEnvelope(row) {
  if (typeof row?.payload_json !== "string" || payloadHash(row.payload_json) !== row.payload_hash) throw cashRoute.fail();
  let scope;
  try { scope = checkedCashBridgeScope(JSON.parse(row.payload_json)?.bridge?.scope); }
  catch { throw cashRoute.fail(); }
  const evidence = readFrozenCheckout(row, scope, recordId(row.operation_id));
  if (!evidence?.wire.attestation || !Array.isArray(evidence.journal) || evidence.journal.length !== cashRoute.TABLES.length)
    throw cashRoute.fail();
  return evidence;
}

// A new installed capture records this marker in the same transaction. A
// limited replacement SQL login or partially restored metadata must not make
// the legacy routes assume that protected cash work has disappeared.
const assertRouteStorage = `
  IF OBJECT_ID(N'dbo.pos_sync_sale_outbox_v1',N'U') IS NULL
  BEGIN
    IF EXISTS (SELECT 1 FROM dbo.sync_checkpoints WHERE organization_id=N'default'
        AND branch_id=@branch AND entity_type=N'${cashRoute.FENCE}' AND direction=N'push')
      THROW 51041,'Protected cash checkout storage is unavailable.',1;
    RETURN;
  END;`;

async function readCashRoute(connectionManager, branchId, operationId) {
  if (!uuid(operationId)) return null;
  const result = await connectionManager.pool.request().input("branch", branchId).input("operation", operationId).query(`
    ${assertRouteStorage}
    EXEC sys.sp_executesql N'SELECT o.* FROM dbo.pos_sync_sale_outbox_v1 AS o
      WHERE o.operation_id=@id AND JSON_QUERY(o.payload_json,''$.bridge.attestation'') IS NOT NULL;',
      N'@id uniqueidentifier', @id=@operation;`);
  const rows = result.recordset ?? [];
  if (!rows.length) return null;
  if (rows.length !== 1) throw cashRoute.fail();
  const { wire } = routeEnvelope(rows[0]);
  if (wire.scope.branchId !== branchId) throw cashRoute.fail();
  return wire;
}

async function cashTrackingCoverage(connectionManager, branchId, table, changes) {
  const tagged = changes.filter(change => change.cashCheckoutId);
  if (!tagged.length) return new Set();
  if (!cashRoute.TABLES.includes(table) || tagged.some(change => !uuid(change.cashCheckoutId) ||
      !uuid(change.key?.id) || change.operation === "D")) throw cashRoute.fail();
  const operations = [...new Set(tagged.map(change => change.cashCheckoutId))];
  const result = await connectionManager.pool.request().input("branch", branchId).input("operations", JSON.stringify(operations)).query(`
    ${databaseGuidQuery}
    ${assertRouteStorage}
    IF OBJECT_ID(N'dbo.pos_sync_sale_acceptance_v1',N'U') IS NOT NULL
      EXEC sys.sp_executesql N'SELECT o.*,a.receipt_json FROM dbo.pos_sync_sale_outbox_v1 AS o
        INNER JOIN dbo.pos_sync_sale_acceptance_v1 AS a ON a.operation_id=o.operation_id
        INNER JOIN OPENJSON(@ids) AS wanted ON o.operation_id=TRY_CONVERT(uniqueidentifier,wanted.[value])
        WHERE o.branch_id=@branch;', N'@ids nvarchar(max),@branch nvarchar(128)', @ids=@operations,@branch=@branch;`);
  const guid = result.recordsets?.[0]?.[0]?.database_guid;
  const rows = result.recordsets?.[1] ?? [];
  if (rows.length !== operations.length) throw cashRoute.fail();
  const byOperation = new Map(rows.map(row => {
    const { wire, journal } = routeEnvelope(row);
    if (wire.scope.databaseGuid !== guid || wire.scope.branchId !== branchId) throw cashRoute.fail();
    try { confirmedReceipt(wire, JSON.parse(row.receipt_json)); }
    catch { throw cashRoute.fail(); }
    return [wire.operationId, journal];
  }));
  for (const change of tagged) {
    const evidence = byOperation.get(change.cashCheckoutId);
    if (!evidence?.some(row => row.table === table && recordId(JSON.parse(row.entity).id) === recordId(change.key.id)))
      throw cashRoute.fail();
  }
  return new Set(tagged);
}

async function assertLegacyCashWrites(connectionManager, branchId, keys) {
  if (!keys.length) return;
  const result = await connectionManager.pool.request().input("branch", branchId).input("keys", JSON.stringify(keys)).query(`
    ${assertRouteStorage}
    DECLARE @pendingProduct nvarchar(max)=CASE WHEN OBJECT_ID(N'dbo.pos_sync_sale_acceptance_v1',N'U') IS NULL THEN N''
      ELSE N' AND (saved.[table]<>N''products'' OR NOT EXISTS (SELECT 1 FROM dbo.pos_sync_sale_acceptance_v1 a WHERE a.operation_id=o.operation_id))'
      END;
    DECLARE @query nvarchar(max)=N'SELECT TOP (1) 1 AS held FROM dbo.pos_sync_sale_outbox_v1 AS o
      CROSS APPLY OPENJSON(o.payload_json,''$.bridge.journal'')
        WITH ([table] nvarchar(128) ''$.table'', entity nvarchar(512) ''$.entity'') AS saved
      INNER JOIN OPENJSON(@keys) WITH ([table] nvarchar(128), id uniqueidentifier) AS wanted
        ON saved.[table]=wanted.[table] AND TRY_CONVERT(uniqueidentifier, JSON_VALUE(saved.entity,''$.id''))=wanted.id
      WHERE o.branch_id=@branch AND JSON_QUERY(o.payload_json,''$.bridge.attestation'') IS NOT NULL'+@pendingProduct;
    EXEC sys.sp_executesql @query, N'@keys nvarchar(max),@branch nvarchar(128)', @keys=@keys,@branch=@branch;`);
  if (result.recordset?.length) throw cashRoute.fail();
}

function confirmedReceipt(wire, value) {
  if (!wire?.attestation || !validSequence(value?.seq)) refuseCashBridge();
  const expected = { operation_id: wire.operationId, sale_id: wire.saleId, scope_id: wire.scope.branchId,
    epoch: wire.scope.feedEpoch, terminal_id: wire.scope.terminalId, installation_generation: wire.scope.installationGeneration,
    database_guid: wire.scope.databaseGuid, checkout_sha256: wire.checkoutSha256, author_id: wire.attestation.authorId,
    author_key_id: wire.attestation.keyId, seq: value.seq };
  if (Object.keys(value).length !== Object.keys(expected).length ||
      Object.entries(expected).some(([key, field]) => value[key] !== field)) refuseCashBridge();
  return expected;
}

async function hasCashAcceptance(transaction, { operationId, seq, branchId, epoch, terminalId,
  installationGeneration, databaseGuid, checkoutSha256, saleId, itemId, tenderId, movementId }) {
  if (![operationId, saleId, itemId, tenderId, movementId].every(uuid) || !validSequence(seq) ||
      typeof checkoutSha256 !== "string" || !/^[0-9a-f]{64}$/.test(checkoutSha256)) return false;
  const scope = checkedCashBridgeScope({ branchId, terminalId, installationGeneration, feedEpoch: epoch, databaseGuid });
  const result = await transaction.request().input("operation", operationId).query(`
    ${databaseGuidQuery}
    IF OBJECT_ID(N'dbo.pos_sync_sale_acceptance_v1',N'U') IS NOT NULL
      AND OBJECT_ID(N'dbo.pos_sync_sale_outbox_v1',N'U') IS NOT NULL
      EXEC sys.sp_executesql N'SELECT o.*,a.receipt_json FROM dbo.pos_sync_sale_outbox_v1 o WITH (HOLDLOCK)
        INNER JOIN dbo.pos_sync_sale_acceptance_v1 a WITH (HOLDLOCK) ON a.operation_id=o.operation_id
        WHERE o.operation_id=@id;', N'@id uniqueidentifier', @id=@operation;
  `);
  if (result.recordsets?.[0]?.[0]?.database_guid !== scope.databaseGuid) return false;
  const rows = result.recordsets?.[1] ?? [];
  if (rows.length !== 1) return false;
  const row = rows[0];
  try {
    const wire = readFrozenCheckout(row, scope, operationId)?.wire;
    const receipt = confirmedReceipt(wire, JSON.parse(row.receipt_json));
    const checkout = JSON.parse(wire.checkoutJson);
    return receipt.seq === seq && receipt.checkout_sha256 === checkoutSha256 && receipt.sale_id === saleId &&
      checkout.item.id === itemId && checkout.tender.id === tenderId && checkout.movement.id === movementId;
  } catch { return false; }
}

class SaleEventOutbox {
  constructor(connectionManager, registry, { cashBridge = null, prepareCashAuthor = null, installedHandoff = false } = {}) {
    this.connectionManager = connectionManager;
    this.cashBridge = cashBridge === null ? null : checkedCashBridgeScope(cashBridge);
    if (prepareCashAuthor !== null && (!this.cashBridge || typeof prepareCashAuthor !== "function")) refuseCashBridge();
    if (installedHandoff && !prepareCashAuthor) refuseCashBridge();
    this.prepareCashAuthor = prepareCashAuthor;
    this.installedHandoff = installedHandoff;
    this.projections = Object.fromEntries(Object.entries(fields).map(([name, names]) => {
      const table = registry.tables.find(table => table.sqlServerTable === name);
      const selected = this.cashBridge ? [...new Set([...names, ...wireFields[name]])] : names;
      const columns = selected.map(column => table?.columns.find(candidate => candidate.sqlServerColumn === column));
      if (columns.some(column => !column)) refuse();
      return [name, projection({ columns })];
    }));
  }

  async assertInstalledStockBaseline(transaction, productId, branchId) {
    const { recordset } = await transaction.request().input("product", productId).input("branch", branchId).query(`
      DECLARE @baseline bigint=(SELECT change_tracking_version FROM dbo.sync_checkpoints WITH(HOLDLOCK)
        WHERE organization_id=N'default' AND branch_id=@branch AND entity_type=N'products' AND direction=N'push');
      DECLARE @minimum bigint=CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(N'dbo.products'));
      IF @baseline IS NULL OR @minimum IS NULL OR @baseline<@minimum OR @baseline>CHANGE_TRACKING_CURRENT_VERSION()
      BEGIN SELECT 0 AS ready; RETURN; END;
      SELECT CASE WHEN EXISTS (
        SELECT 1 FROM CHANGETABLE(VERSION dbo.products, (id), (CONVERT(uniqueidentifier,@product))) c
        WHERE c.SYS_CHANGE_VERSION>@baseline AND (c.SYS_CHANGE_CONTEXT IS NULL OR c.SYS_CHANGE_CONTEXT<>0x434C4F5544)
      ) OR EXISTS (
        SELECT 1 FROM dbo.sync_change_journal WITH(HOLDLOCK) WHERE branch_id=@branch AND entity_type=N'products'
          AND acknowledged_at IS NULL AND TRY_CONVERT(uniqueidentifier, JSON_VALUE(
            CASE WHEN ISJSON(entity_id)=1 THEN entity_id END, '$.id'))=@product
      ) THEN 0 ELSE 1 END AS ready;`);
    if (recordset?.[0]?.ready !== 1) throw legacyCheckout();
  }

  assertInstalledShift(terminalId) {
    if (recordId(terminalId) !== this.cashBridge.terminalId) throw legacyCheckout();
  }

  async capture(transaction, { operationId, branchId, terminalId, operations, confirmedStock, cashAuthor }) {
    if (!uuid(operationId) || !scopedId(branchId) || !scopedId(terminalId) ||
        operations.some(operation => !Object.hasOwn(fields, operation.table) && operation.table !== "products")) refuse();
    if (this.cashBridge && (recordId(branchId) !== this.cashBridge.branchId || recordId(terminalId) !== this.cashBridge.terminalId)) refuseCashBridge();
    const sales = expectedIds(operations, "sales");
    const items = expectedIds(operations, "sale_items");
    const tenders = expectedIds(operations, "payment_transactions");
    const movements = expectedIds(operations, "item_activity_logs");
    if (sales.size !== 1 || !items.size || tenders.size !== 1 ||
        confirmedStock.size !== operations.filter(operation => operation.table === "products").length) refuse();

    const saleId = sales.values().next().value;
    const sql = this.connectionManager.sql();
    const result = await new sql.Request(transaction)
      .input("sale", sql.UniqueIdentifier, saleId)
      .input("branch", sql.NVarChar(128), branchId)
      .input("item_limit", sql.Int, items.size + 1)
      .input("movements", sql.NVarChar(sql.MAX), JSON.stringify([...movements]))
      .query(`SELECT ${this.projections.sales} FROM dbo.sales source WHERE id=@sale AND store_id=@branch;
        SELECT TOP (@item_limit) ${this.projections.sale_items} FROM dbo.sale_items source WHERE sale_id=@sale ORDER BY id;
        SELECT TOP (2) ${this.projections.payment_transactions} FROM dbo.payment_transactions source WHERE sale_id=@sale ORDER BY id;
        SELECT ${this.projections.item_activity_logs} FROM dbo.item_activity_logs source
        WHERE id IN (SELECT CONVERT(uniqueidentifier,[value]) FROM OPENJSON(@movements)) ORDER BY id;
        ${this.cashBridge ? databaseGuidQuery : ""}`);
    const [headers, savedItems, savedTenders, savedMovements, database] = result.recordsets ?? [];
    if (!headers || !savedItems || !savedTenders || !savedMovements) refuse();
    assertExactIds(headers, sales);
    assertExactIds(savedItems, items);
    assertExactIds(savedTenders, tenders);
    assertExactIds(savedMovements, movements);

    const [sale] = headers;
    const [tender] = savedTenders;
    const shiftId = recordId(sale.shift_id);
    const matchesTerminal = value => value == null || recordId(value) === recordId(terminalId);
    if (recordId(sale.store_id) !== recordId(branchId) || !uuid(shiftId) || !sale.bill_number || !sale.created_at ||
        sale.member_id != null || sale.is_exchange !== false || sale.is_refunded !== false || sale.original_bill_number != null ||
        sale.payment_type !== "cash" || !positive(sale.total_amount) || !positive(sale.paid_amount) ||
        [sale.subtotal_amount, sale.tax_amount, sale.discount_amount, sale.change_amount].some(value => decimal(value) === undefined) ||
        recordId(tender.store_id) !== recordId(branchId) || recordId(tender.shift_id) !== shiftId ||
        !matchesTerminal(tender.terminal_id) || tender.source_type !== "sale" || tender.method !== "cash" ||
        tender.kind !== "payment" || tender.status !== "completed" || !tender.paid_at ||
        decimal(tender.amount) !== decimal(sale.paid_amount)) refuse();

    const itemQuantities = new Map();
    const movementDeltas = new Map();
    for (const item of savedItems) {
      const quantity = Number(item.quantity);
      if (recordId(item.branch_id) !== recordId(branchId) || !Number.isSafeInteger(quantity) || quantity <= 0 ||
          item.is_return !== false || [item.unit_price, item.tax_rate, item.discount_percent, item.discount_amount]
            .some(value => decimal(value) === undefined)) refuse();
      if (item.product_id != null) {
        const productId = recordId(item.product_id);
        if (!uuid(productId)) refuse();
        itemQuantities.set(productId, (itemQuantities.get(productId) ?? 0) - quantity);
      }
    }
    for (const movement of savedMovements) {
      const productId = recordId(movement.product_id);
      const delta = Number(movement.quantity_delta);
      if (!uuid(productId) || !Number.isSafeInteger(delta) || delta >= 0 ||
          recordId(movement.store_id) !== recordId(branchId) || !matchesTerminal(movement.terminal_id) ||
          movement.activity_type !== "sale" || movement.reference !== sale.bill_number) refuse();
      movementDeltas.set(productId, (movementDeltas.get(productId) ?? 0) + delta);
    }
    if (confirmedStock.size !== itemQuantities.size || confirmedStock.size !== movementDeltas.size ||
        [...confirmedStock].some(([id, { delta }]) => delta !== itemQuantities.get(id) || delta !== movementDeltas.get(id))) refuse();

    let bridge;
    if (this.cashBridge) {
      if (database?.length !== 1 || database[0].database_guid !== this.cashBridge.databaseGuid) refuseCashBridge();
      let checkout;
      try {
        checkout = cashBridgeCheckout(this.cashBridge, { sale, items: savedItems, tenders: savedTenders, movements: savedMovements, confirmedStock });
      } catch (error) {
        if (this.installedHandoff && error?.code === "ESALE_CASH_BRIDGE_UNVERIFIED")
          throw legacyCheckout();
        throw error;
      }
      bridge = { scope: this.cashBridge, checkoutJson: JSON.stringify(checkout) };
      if (this.prepareCashAuthor) {
        if (!cashAuthor?.signCashCheckout || !cashAuthor.assertCurrent) refuseCashBridge();
        const { branchId, installationGeneration, databaseGuid, feedEpoch } = this.cashBridge;
        const payloadDigest = payloadHash(bridge.checkoutJson);
        try {
          bridge.attestation = checkedAttestation(cashAuthor.signCashCheckout({ branchId, installationGeneration,
            databaseGuid, feedEpoch, operationId: recordId(operationId), payloadHash: payloadDigest }),
          this.cashBridge, recordId(operationId), payloadDigest);
        } catch (error) {
          if (this.installedHandoff && error?.code === "ESYNC_SHIFT_AUTHOR_ENROLLMENT_PENDING") throw legacyCheckout();
          throw error;
        }
        if (sale.cashier_id && sale.cashier_id !== bridge.attestation.subject) refuseCashBridge();
        bridge.journal = await cashJournal(transaction, recordId(operationId), branchId, checkout);
        cashAuthor.assertCurrent();
      }
    }

    const payload = JSON.stringify({
      eventType: EVENT_TYPE, version: 1, operationId: recordId(operationId), branchId, terminalId, shiftId,
      sale: shadowRow("sales", sale), items: savedItems.map(row => shadowRow("sale_items", row)),
      tenders: savedTenders.map(row => shadowRow("payment_transactions", row)),
      movements: savedMovements.map(row => shadowRow("item_activity_logs", row)),
      ...(bridge ? { bridge } : {}),
    });
    if (Buffer.byteLength(payload, "utf8") > MAX_PAYLOAD_BYTES) refuse();
    await new sql.Request(transaction)
      .input("operation", sql.UniqueIdentifier, operationId)
      .input("branch", sql.NVarChar(128), branchId)
      .input("terminal", sql.NVarChar(128), terminalId)
      .input("shift", sql.UniqueIdentifier, shiftId)
      .input("sale", sql.UniqueIdentifier, saleId)
      .input("payload", sql.NVarChar(sql.MAX), payload)
      .input("hash", sql.Char(64), payloadHash(payload))
      .query(`INSERT dbo.pos_sync_sale_outbox_v1(operation_id,branch_id,terminal_id,shift_id,sale_id,payload_json,payload_hash)
        VALUES(@operation,@branch,@terminal,@shift,@sale,@payload,@hash);`);
    if (this.installedHandoff) await transaction.request().input("branch", branchId).query(`
      IF NOT EXISTS (SELECT 1 FROM dbo.sync_checkpoints WITH (UPDLOCK,HOLDLOCK)
        WHERE organization_id=N'default' AND branch_id=@branch AND entity_type=N'${cashRoute.FENCE}' AND direction=N'push')
      INSERT dbo.sync_checkpoints(organization_id,branch_id,entity_type,direction)
      VALUES(N'default',@branch,N'${cashRoute.FENCE}',N'push');`);
  }

  // Prepared reader only. A future dispatcher still needs a server-verified
  // installation generation, relay permission, and an exclusive sender handoff.
  async readBridgeCheckout(operationId) {
    const scope = this.cashBridge;
    if (!scope || !uuid(operationId)) refuseCashBridge();
    const sql = this.connectionManager.sql();
    return (await this.readCheckout(this.connectionManager.pool.request(), sql, recordId(operationId)))?.wire ?? null;
  }

  async readCheckout(request, sql, operationId) {
    const scope = this.cashBridge;
    const { recordsets } = await request
      .input("operation", sql.UniqueIdentifier, operationId)
      .input("branch", sql.NVarChar(128), scope.branchId)
      .input("terminal", sql.NVarChar(128), scope.terminalId)
      .query(`${databaseGuidQuery}
        SELECT operation_id, branch_id, terminal_id, shift_id, sale_id, payload_json, payload_hash
        FROM dbo.pos_sync_sale_outbox_v1 WHERE operation_id=@operation AND branch_id=@branch AND terminal_id=@terminal;`);
    const [database, rows] = recordsets ?? [];
    if (database?.length !== 1 || database[0].database_guid !== scope.databaseGuid || !rows || rows.length > 1) refuseCashBridge();
    if (!rows.length) return null;
    return readFrozenCheckout(rows[0], scope, operationId);
  }

  /** Main calls this only for the authenticated, bound HTTPS response. Save
   * acceptance with precisely the original journal rows under the same lock. */
  async recordBridgeAcceptance(wire, response, assertCurrent = () => {}) {
    if (!this.cashBridge || !uuid(wire?.operationId) || !["APPLIED", "ALREADY_APPLIED"].includes(response?.status) ||
        Object.keys(response).length !== 2) refuseCashBridge();
    const sql = this.connectionManager.sql();
    const pool = this.connectionManager.pool;
    assertCurrent();
    const transaction = new sql.Transaction(pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      const captured = await this.readCheckout(transaction.request(), sql, wire.operationId);
      if (JSON.stringify(captured?.wire) !== JSON.stringify(wire)) refuseCashBridge();
      const receipt = confirmedReceipt(captured.wire, response.result);
      const receiptJson = JSON.stringify(receipt);
      const { recordset } = await transaction.request().input("operation", sql.UniqueIdentifier, wire.operationId)
        .query("SELECT receipt_json FROM dbo.pos_sync_sale_acceptance_v1 WITH (UPDLOCK,HOLDLOCK) WHERE operation_id=@operation;");
      if (recordset.length) {
        if (recordset.length !== 1 || recordset[0].receipt_json !== receiptJson) refuseCashBridge();
      } else {
        const checkout = JSON.parse(captured.wire.checkoutJson);
        const journal = await cashJournal(transaction, wire.operationId, this.cashBridge.branchId, checkout);
        if (JSON.stringify(captured.journal) !== JSON.stringify(journal)) refuseCashBridge();
        const result = await transaction.request().input("operation", sql.UniqueIdentifier, wire.operationId)
          .input("receipt", sql.NVarChar(sql.MAX), receiptJson)
          .input("ids", sql.NVarChar(sql.MAX), JSON.stringify(journal.map(row => row.id))).query(`
            INSERT dbo.pos_sync_sale_acceptance_v1(operation_id,receipt_json) VALUES(@operation,@receipt);
            UPDATE dbo.sync_change_journal SET acknowledged_at=SYSDATETIMEOFFSET(),last_error=NULL
            WHERE aggregate_id=@operation AND acknowledged_at IS NULL
              AND change_id IN (SELECT CONVERT(bigint,[value]) FROM OPENJSON(@ids));
            SELECT @@ROWCOUNT AS changed;
          `);
        if (result.recordset?.[0]?.changed !== journal.length) refuseCashBridge();
      }
      assertCurrent();
      if (this.connectionManager.pool !== pool) refuseCashBridge();
      await transaction.commit();
      return receipt;
    } catch (error) {
      await Promise.resolve(transaction.rollback()).catch(() => undefined);
      throw error;
    }
  }
}

module.exports = { SaleEventOutbox, hasCashAcceptance, readCashRoute, cashTrackingCoverage, assertLegacyCashWrites };
