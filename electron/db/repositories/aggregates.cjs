const { normalizeUuidFields, recordId } = require("../../sync/uuid-fields.cjs");
const { createHash } = require("node:crypto");
const { branchPredicate, rendererReadBranchPredicate } = require("../branch-scope.cjs");
const { isFinancialStockUpdate, assertFinancialStockUpdate } = require("../financial-stock-policy.cjs");

const { projection } = require("../../sync/shift-recovery-exact.cjs");
const SALE_STOCK_MUTABLE = new Set(["stock_quantity", "stock_by_store", "row_version", "updated_at", "is_archived", "archived_at"]);
const stockRefused = () => { throw Object.assign(new Error("The sale stock write no longer matches its verified branch product."), { code: "SYNC_BRANCH_FORBIDDEN", table: "products" }); };
const stableProduct = (table,row) => JSON.stringify(table.columns.filter(column => !SALE_STOCK_MUTABLE.has(column.sqlServerColumn)).map(column => [column.sqlServerColumn,row[column.sqlServerColumn]]));
const AGGREGATE_KINDS = new Set([
  "sale", "payment", "refund", "shift", "product", "receiving", "stock",
  "transfer", "booking", "held_order", "general", "branch",
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
  constructor(connectionManager, operationsRepository, {financialOperations=null, saleOutbox=null} = {}) {
    this.connectionManager = connectionManager;
    this.operationsRepository = operationsRepository;
    this.financialOperations = financialOperations;
    this.saleOutbox = saleOutbox;
  }

  async assertBranch(transaction, table, record, match, branchId, financialStock = false) {
    if (table.scope !== "branch") return;
    if (!branchId) throw Object.assign(new Error("The terminal branch is not configured."), { code: "EBRANCH" });
    const predicate = financialStock ? rendererReadBranchPredicate(this.operationsRepository.registry, table, "candidate") : branchPredicate(this.operationsRepository.registry, table, "candidate");
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

  async captureSaleStock(transaction, table, operation, aggregate, kind) {
    if (kind !== "sale" || !isFinancialStockUpdate(operation, aggregate)) return null;
    const predicate = rendererReadBranchPredicate(this.operationsRepository.registry, table, "source");
    if (!predicate || !aggregate.branchId) stockRefused();
    const result = await new (this.connectionManager.sql().Request)(transaction)
      .input("product", operation.match?.id).input("branch", String(aggregate.branchId))
      .query(`SELECT ${projection(table)} FROM dbo.products source WITH(UPDLOCK,HOLDLOCK) WHERE source.id=@product AND (${predicate});`);
    if (result.recordset?.length !== 1) stockRefused();
    const before = result.recordset[0];
    assertFinancialStockUpdate(operation, aggregate, before);
    return { before, identity: stableProduct(table,before) };
  }

  async confirmSaleStock(transaction, table, operation, aggregate, captured, affected) {
    if (affected !== 1) stockRefused();
    const result = await new (this.connectionManager.sql().Request)(transaction).input("product", operation.match.id)
      .query(`SELECT ${projection(table)} FROM dbo.products source WITH(UPDLOCK,HOLDLOCK) WHERE source.id=@product;`);
    if (result.recordset?.length !== 1 || stableProduct(table,result.recordset[0]) !== captured.identity) stockRefused();
    // Reuse the strict branch-only stock equation against actual persisted
    // values. Ownership/catalogue facts must remain unchanged; consuming the
    // last stock unit may remove the transient read predicate's stock proof.
    assertFinancialStockUpdate({ ...operation, values: { stock_quantity: result.recordset[0].stock_quantity, stock_by_store: result.recordset[0].stock_by_store } }, aggregate, captured.before);
  }

  async assertNewSaleIdentities(transaction, operations) {
    const ids = operations.filter(operation => operation.table === "sales" && ["insert", "upsert"].includes(operation.kind))
      .flatMap(operation => operation.rows ?? (operation.values ? [operation.values] : [])).map(row => row.id);
    // A different operation receipt cannot prove that an existing bill's
    // financial/stock effects are missing. Hold partial legacy states too.
    if (ids.some(value => typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) || new Set(ids).size !== ids.length)
      throw Object.assign(new Error("The sale contains duplicate or invalid saved bill identities."), { code: "EIDEMPOTENCY", table: "sales" });
    for (const saleId of [...ids].sort()) {
      const existing = await new (this.connectionManager.sql().Request)(transaction).input("sale", saleId)
        .query("SELECT id FROM dbo.sales WITH(UPDLOCK,HOLDLOCK) WHERE id=@sale;");
      if (existing.recordset?.length) throw Object.assign(new Error("This sale could not be safely matched to a new local receipt. Check the bill in Sales before retrying; saved records have not been rewritten."), { code: "EEXISTING_SALE_RECONCILIATION", table: "sales" });
    }
  }

  async commit(kind, aggregate) {
    // SQL Server has already rolled back a deadlock victim. Retry the whole
    // atomic operation with the same receipt, never an individual statement
    // or an ambiguous connection/commit timeout.
    for (let attempt = 0; ; attempt += 1) {
      try { return await this.commitOnce(kind,aggregate); }
      catch (error) {
        if (error?.sqlNumber !== 1205 || attempt >= 2) throw error;
        await new Promise(resolve => setTimeout(resolve,100 * (attempt + 1)));
      }
    }
  }

  async commitOnce(kind, aggregate) {
    aggregate = normalizeUuidFields(aggregate);
    if (!AGGREGATE_KINDS.has(kind)) throw new Error("Unsupported aggregate type.");
    const operations = this.operationsRepository.validate(aggregate?.operations);
    const operationId = aggregate?.operationId || stableUuid({ kind, operations });
    if (!/^[0-9a-f-]{36}$/i.test(operationId)) throw new Error("A stable aggregate UUID is required.");
    const payloadHash = createHash("sha256").update(JSON.stringify(canonical({ kind, operations }))).digest("hex");
    const financialStore=this.financialOperations?.enabled===true?this.financialOperations:null;
    const financialContext=financialStore?await financialStore.prepareContext({branchId:aggregate.branchId,terminalId:aggregate.terminalId,operationId,kind}):null;
    const saleOutbox = kind === "sale" ? this.saleOutbox : null;
    let cashAuthor, cashAuthorError;
    try { cashAuthor = await saleOutbox?.prepareCashAuthor?.(); }
    catch (error) { cashAuthorError = error; }
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

      if (cashAuthorError) throw cashAuthorError;
      await this.assertNewSaleIdentities(transaction, operations);

      // Close-start takes the same shift row lock. Once counting begins no
      // sale can race the database totals used for reconciliation.
      for (const sale of operations.filter((op) => op.table === "sales" && ["insert", "upsert"].includes(op.kind)).flatMap((op) => op.rows ?? [])) {
        if (sale.coupon_promo_id) {
          const campaign = await new sql.Request(transaction)
            .input("promotion", String(sale.coupon_promo_id)).input("store", String(sale.store_id ?? aggregate.branchId))
            .query("SELECT p.title,p.is_active,p.deleted_at,p.code_scope,p.code_cluster_id,s.group_id FROM dbo.promotions p LEFT JOIN dbo.stores s ON s.id=@store WHERE p.id=TRY_CONVERT(uniqueidentifier,@promotion) AND p.promo_type='code';");
          const code = campaign.recordset?.[0];
          if (code && (!code.is_active || code.deleted_at ||
            String(code.title).trim().toUpperCase() !== String(sale.coupon_code ?? "").trim().toUpperCase() ||
            (code.code_scope || "bill") !== sale.coupon_scope ||
            (code.code_cluster_id && code.code_cluster_id !== code.group_id)))
            throw Object.assign(new Error("The reusable code is no longer valid for this store. Refresh the code before completing the sale."), { code: "ECOUPON_SCOPE" });
        }
        if (!sale.shift_id) continue;
        const shift = await new sql.Request(transaction).input("shift", String(sale.shift_id)).input("branch", aggregate.branchId)
          .query("SELECT state,status,closed_at FROM dbo.shifts WITH (UPDLOCK,HOLDLOCK) WHERE id=TRY_CONVERT(uniqueidentifier,@shift) AND store_id=@branch;");
        const row = shift.recordset?.[0];
        if (!row || row.closed_at || row.status !== "OPEN" || (row.state && row.state !== "ACTIVE"))
          throw Object.assign(new Error("This shift is closing or closed. Refresh the shift status before recording a sale."), { code: "ESHIFT_CLOSED" });
      }
      let affected = 0;
      const financialTokens=[],openingTokens=new Map();
      if(financialStore){
        const monetary=new Set(['total_amount','payment_type','payments','discount_amount','is_refunded','store_id','shift_id']);
        const sales=operations.filter(op=>op.table==='sales' && (['insert','upsert','delete'].includes(op.kind)||Object.keys(op.values??{}).some(key=>monetary.has(key))));
        const grouped=new Map();
        for(const op of sales){
          const records=op.rows?.length?op.rows:[op.values??op.match];
          for(const record of records){
            const saleId=record?.id??op.match?.id;
            if(typeof saleId!=='string'||! /^[0-9a-f-]{36}$/i.test(saleId))throw Object.assign(new Error('An exact sale identity is required for financial capture.'),{code:'EFINANCIAL_OPERATION_INVALID'});
            const saved=(await new sql.Request(transaction).input('sale',saleId).query('SELECT store_id,shift_id FROM dbo.sales WHERE id=@sale;')).recordset?.[0];
            const branchId=saved?.store_id??record.store_id??aggregate.branchId;
            const shiftId=saved?.shift_id??record.shift_id??null;
            if(branchId!==aggregate.branchId)throw Object.assign(new Error('The financial sale does not belong to this terminal branch.'),{code:'SYNC_BRANCH_FORBIDDEN'});
            const key=shiftId??'';if(!grouped.has(key))grouped.set(key,new Set());grouped.get(key).add(saleId.toLowerCase());
          }
        }
        for(const[shiftId,sales]of [...grouped].sort(([a],[b])=>a.localeCompare(b))){
          const action=kind==='refund'?'REFUND':kind==='payment'?'TENDER':'SALE';
          const token=await financialStore.captureMutation(transaction,{branchId:aggregate.branchId,terminalId:aggregate.terminalId,shiftId:shiftId||null,operationId,action,preparedContext:financialContext,saleIds:[...sales]});financialTokens.push(token);
        }
      }
      const newOpenings = new Set();
      const confirmedStock = saleOutbox ? new Map() : null;
      for (const operation of operations) {
        stage = "business rows";
        tableName = operation.table;
        if (this.operationsRepository.tables.get(operation.table)?.direction === "pull")
          throw new Error(`${operation.table} is centrally managed and cannot be changed by the local database.`);
        const table = this.operationsRepository.tables.get(operation.table);
        const records = operation.rows?.length ? operation.rows : [operation.values ?? operation.match];
        if(operation.table==="shifts" && ["insert","upsert"].includes(operation.kind))for(const record of records){
          const saved=await new sql.Request(transaction).input("shift",record.id)
            .query("SELECT id FROM dbo.[shifts] WITH(UPDLOCK,HOLDLOCK) WHERE id=@shift;");
          if(!saved.recordset?.length){
            newOpenings.add(record.id);
            if(financialStore&&!openingTokens.has(record.id)){
              openingTokens.set(record.id,await financialStore.captureOpening(transaction,{branchId:aggregate.branchId,terminalId:aggregate.terminalId,shiftId:record.id,operationId,preparedContext:financialContext}));
            }
          }
        }
        // Deletes must be checked while their owner row still exists. Inserts
        // and updates are checked after application so child ownership can be
        // resolved through a parent written earlier in the same aggregate.
        if (operation.kind === "delete") {
          for (const record of records) await this.assertBranch(transaction, table, record, operation.match, aggregate.branchId);
        }
        // OperationsRepository applies the branch predicate inside every SQL
        // MERGE/UPDATE.  Omitting this scope bound @branch to the string
        // "undefined", silently filtered out otherwise valid insert sources,
        // and made the post-write ownership check report a false branch
        // violation for sales, shift sessions, and other aggregates.
        const stockPreimage = await this.captureSaleStock(transaction, table, operation, aggregate, kind);
        const operationAffected = await this.operationsRepository.applyOperation(transaction, operation, {
          branchId: aggregate.branchId,
          terminalId: aggregate.terminalId,
          managementDevice: aggregate.managementDevice === true,
          permissions: aggregate.permissions,
          productWriteKind: aggregate.productWriteKind,
          financialStockDeltas: aggregate.financialStockDeltas,
          enforcePermissions: true,
          isSettingsAdmin: aggregate.isSettingsAdmin === true,
          memberAccrual: aggregate.memberAccrual,
          financialExchangeLinks: aggregate.financialExchangeLinks,
          activityOperator: aggregate.activityOperator,
        });
        if (operation.requireMatch && operationAffected !== 1)
          throw Object.assign(
            new Error(operation.table === "products"
              ? "A sale product is missing from local SQL Server. Synchronize the catalogue before retrying payment."
              : "The original bill is missing, refunded, or has already been exchanged."),
            { code: operation.table === "products" ? "EPRODUCT_STATE" : "EEXCHANGE_STATE" },
          );
        affected += operationAffected;
        if (operation.kind !== "delete") {
          if (stockPreimage) {
            await this.confirmSaleStock(transaction, table, operation, aggregate, stockPreimage, operationAffected);
            if (confirmedStock) {
              const productId = recordId(operation.match.id);
              confirmedStock.set(productId, { delta: aggregate.financialStockDeltas.get(productId), product: stockPreimage.before });
            }
          }
          else for (const record of records) await this.assertBranch(transaction, table, record, operation.match, aggregate.branchId, isFinancialStockUpdate(operation, aggregate));
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
      if (saleOutbox) {
        stage = "sale event capture";
        tableName = "pos_sync_sale_outbox_v1";
        await saleOutbox.capture(transaction, {
          operationId, branchId: aggregate.branchId, terminalId: aggregate.terminalId, operations, confirmedStock, cashAuthor,
        });
      }
      stage = "operation receipt";
      if(newOpenings.size){
        const {ShiftIntentStore}=require("../shift-intents.cjs");
        const store=new ShiftIntentStore(this.connectionManager,this.operationsRepository.registry);
        for(const shiftId of newOpenings){await store.freezeOpening(transaction,operationId,aggregate.branchId,shiftId,{exactFinancial:financialStore!==null});if(financialStore)await financialStore.finalizeOpening(transaction,openingTokens.get(shiftId));}
      }
      for(const token of financialTokens)await financialStore.finalizeMutation(transaction,token);
      tableName = "local_operation_receipts";
      await new sql.Request(transaction)
        .input("operation_id", sql.UniqueIdentifier, operationId)
        .input("operation_type", kind)
        .input("entity_id", operationId)
        .input("note", payloadHash)
        .query("INSERT dbo.local_operation_receipts(operation_id,operation_type,entity_id,note) VALUES(@operation_id,@operation_type,@entity_id,@note);");
      if(financialStore)for(const token of [...financialTokens,...openingTokens.values()])financialStore.assertCurrent(transaction,token);
      cashAuthor?.assertCurrent();
      await transaction.commit();
      return { ok: true, operationId, replayed: false, affected };
    } catch (error) {
      await Promise.resolve(transaction.rollback()).catch(() => undefined);
      if (["EIDEMPOTENCY", "EEXISTING_SALE_RECONCILIATION", "EBRANCH", "EBRANCH_SCOPE", "SYNC_BRANCH_FORBIDDEN", "EEXCHANGE_STATE", "EPRODUCT_STATE", "PERMISSION_DENIED", "ESHIFT_TERMINAL", "ESALE_EVENT_UNVERIFIED", "ESALE_CASH_BRIDGE_UNVERIFIED"].includes(error?.code))
        throw error;
      const target = tableName ? ` while writing ${tableName}` : "";
      const native = error?.originalError?.info ?? error?.originalError ?? error;
      const number = error?.number ?? native?.number;
      const sqlNumber = number != null && Number.isFinite(Number(number)) && Number(number) > 0 ? Number(number) : null;
      const suffix = sqlNumber == null ? "" : ` (SQL Server ${sqlNumber})`;
      const sqlDetail = String(native?.message ?? error?.message ?? "")
        .replace(/[\r\n\t]+/g, " ")
        .replace(/\s{2,}/g, " ")
        .slice(0, 500);
      const uniqueName = [2601,2627].includes(sqlNumber)
        ? /(?:index|constraint) ['"]([A-Za-z0-9_]{1,128})['"]/i.exec(sqlDetail)?.[1] : null;
      const message = [2601,2627].includes(sqlNumber)
        ? `A duplicate value conflicts with an existing record in ${tableName ?? "the local database"}${uniqueName ? ` (${uniqueName})` : ""}. No changes were committed. Review the document reference or other unique fields and retry.`
        : `Local SQL Server ${kind} commit failed${target}${suffix}.`;
      throw Object.assign(
        new Error(message),
        { code: "ESQLSERVER_WRITE", stage, table: tableName, sqlNumber, sqlDetail, cause: error },
      );
    }
  }
}

module.exports = { AggregateRepository, AGGREGATE_KINDS, stableUuid, canonical };
