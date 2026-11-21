const { isDeepStrictEqual } = require("node:util");
const { StockHistoryStore } = require("../stock-history.cjs");
const { stockLifecycleDeclaration, stockLifecycleAssignments } = require("../../sync/grouped-live-stock.cjs");
const { request, acceptance, receivedReceipt, decodeProducts, mergePlan, fail } = require("../../sync/product-merge-command.cjs");
const intentType = "product_merge_authoritative";
const relevantTables = ["products", "product_barcodes", "sale_items", "purchase_order_items", "stock_transfer_items",
  "stock_adjustments", "stock_delta_applied", "item_activity_logs", "promotions", "bookings", "held_orders"];
const cis = column => `CONVERT(varbinary(256),${column})=CONVERT(varbinary(256),@branch)`;
const productIds = `OPENJSON(@roster) WITH(id uniqueidentifier)`;
const activeDocument = (table, condition) => `EXISTS(SELECT 1 FROM dbo.${table} doc WITH(HOLDLOCK,NOWAIT) WHERE ${condition})`;
const lineProduct = name => `EXISTS(SELECT 1 FROM OPENJSON(CASE WHEN ISJSON(doc.${name},ARRAY)=1 THEN doc.${name} ELSE N'[]' END)
    WITH(product_id uniqueidentifier '$.productId') line WHERE line.product_id=p.id)`;
const booking = activeDocument("bookings", `doc.status=N'active' AND (doc.string_source_product_id=p.id OR doc.grip_product_id=p.id OR
  ${lineProduct("lines")} OR ${lineProduct("charges")})`);
const heldTicket = activeDocument("held_orders", `COALESCE(doc.status,N'held') NOT IN(N'completed',N'cancelled') AND ${lineProduct("lines")}`);
const relational = [["sale_items", "product_id"], ["purchase_order_items", "product_id"], ["stock_transfer_items", "product_id"],
  ["stock_adjustments", "product_id"], ["item_activity_logs", "product_id"], ["product_barcodes", "product_id"], ["promotions", "foc_product_id"]]
  .map(([table, column]) => activeDocument(table, `doc.${column}=p.id`)).join(" OR ");

async function exactCheckpoint(tx, branch) {
  const { recordset } = await tx.request().input("branch", branch).query(`
    DECLARE @fenceLatch int, @fenced bit=0;
    EXEC @fenceLatch=sys.sp_getapplock @Resource=N'retail:stock-history:stocktake',@LockMode=N'Shared',
      @LockOwner=N'Transaction',@LockTimeout=2000;
    IF @fenceLatch<0 BEGIN SELECT CAST(0 AS bit) ready; RETURN; END;
    IF OBJECT_ID(N'dbo.stock_history_stocktake_fences',N'U') IS NOT NULL
      EXEC sys.sp_executesql N'SELECT @active=1 FROM dbo.stock_history_stocktake_fences WITH(HOLDLOCK,NOWAIT)
        WHERE released_at IS NULL AND expires_at>SYSUTCDATETIME();',N'@active bit OUTPUT',@fenced OUTPUT;
    IF @fenced=1 BEGIN SELECT CAST(0 AS bit) ready; RETURN; END;
    DECLARE @head bigint=CHANGE_TRACKING_CURRENT_VERSION();
    IF @head IS NULL OR EXISTS(SELECT 1 FROM dbo.sync_change_journal WITH(HOLDLOCK,NOWAIT)
      WHERE acknowledged_at IS NULL AND (${cis("branch_id")} OR branch_id=N'global')
       AND entity_type IN(${relevantTables.map(name => `N'${name}'`).join(",")})) BEGIN SELECT CAST(0 AS bit) ready; RETURN; END;
    DECLARE @tables TABLE(name sysname PRIMARY KEY, ct_version bigint);
    INSERT @tables(name,ct_version)
      SELECT wanted.name, state.change_tracking_version
      FROM (VALUES(N'products'),(N'bookings'),(N'held_orders')) wanted(name)
      LEFT JOIN dbo.sync_checkpoints state WITH(HOLDLOCK,NOWAIT) ON state.entity_type=wanted.name AND
       state.organization_id=N'default' AND state.direction=N'push' AND ${cis("state.branch_id")};
    IF EXISTS(SELECT 1 FROM @tables WHERE ct_version IS NULL OR ct_version>@head OR
      CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(N'dbo.'+name)) IS NULL OR ct_version<CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(N'dbo.'+name)))
    BEGIN SELECT CAST(0 AS bit) ready; RETURN; END;
    DECLARE @products bigint=(SELECT ct_version FROM @tables WHERE name=N'products');
    DECLARE @bookings bigint=(SELECT ct_version FROM @tables WHERE name=N'bookings');
    DECLARE @held bigint=(SELECT ct_version FROM @tables WHERE name=N'held_orders');
    SELECT CAST(CASE WHEN
      EXISTS(SELECT 1 FROM CHANGETABLE(CHANGES dbo.products,@products) ct LEFT JOIN dbo.products p ON p.id=ct.id
       WHERE (ct.SYS_CHANGE_CONTEXT IS NULL OR ct.SYS_CHANGE_CONTEXT<>0x434C4F5544) AND (p.id IS NULL OR ${cis("p.owner_store_id")}))
      OR EXISTS(SELECT 1 FROM CHANGETABLE(CHANGES dbo.bookings,@bookings) ct LEFT JOIN dbo.bookings b ON b.id=ct.id
       WHERE (ct.SYS_CHANGE_CONTEXT IS NULL OR ct.SYS_CHANGE_CONTEXT<>0x434C4F5544) AND (b.store_id IS NULL OR ${cis("b.store_id")}))
      OR EXISTS(SELECT 1 FROM CHANGETABLE(CHANGES dbo.held_orders,@held) ct LEFT JOIN dbo.held_orders h ON h.id=ct.id
       WHERE (ct.SYS_CHANGE_CONTEXT IS NULL OR ct.SYS_CHANGE_CONTEXT<>0x434C4F5544) AND (h.store_id IS NULL OR ${cis("h.store_id")}))
    THEN 0 ELSE 1 END AS bit) ready,CONVERT(varchar(20),@head) version;`);
  if (recordset?.[0]?.ready !== true) throw fail("ESYNC_PRODUCT_MERGE_PENDING_WORK");
  return recordset[0].version;
}

function productState(product) {
  return { id: product.id, owner_store_id: product.owner_store_id, deleted_at: product.deleted_at,
    sku: product.sku, name: product.name, barcode: product.barcode, row_version: product.row_version,
    stock_quantity: product.stock_quantity, stock: product.stock, aliases: product.aliases };
}

function sameProducts(current, prior) {
  return [...prior].every(([id, product]) => current.has(id) &&
    isDeepStrictEqual(productState(current.get(id)), productState(product)));
}

class ProductMergeRepository {
  constructor(manager, databaseGuid) { this.manager = manager; this.databaseGuid = databaseGuid; }

  async intentStorageReady(connection) {
    const { recordset } = await connection.request().query(`
      SELECT CAST(CASE WHEN OBJECT_ID(N'dbo.stock_history_product_merge_intents',N'U') IS NOT NULL
        AND OBJECT_ID(N'dbo.stock_history_stocktake_fences',N'U') IS NOT NULL
        AND COL_LENGTH(N'dbo.stock_history_product_merge_intents',N'intent_json')=-1
        AND COL_LENGTH(N'dbo.stock_history_product_merge_intents',N'outcome_json')=-1
        AND EXISTS(SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.stock_history_product_merge_intents',N'U')
          AND name=N'UX_stock_history_product_merge_pending_branch' AND is_unique=1 AND has_filter=1 AND is_disabled=0)
        AND EXISTS(SELECT 1 FROM sys.triggers WHERE object_id=OBJECT_ID(N'dbo.TR_stock_history_stocktake_products',N'TR')
          AND parent_id=OBJECT_ID(N'dbo.products',N'U') AND is_disabled=0 AND is_not_for_replication=0)
      THEN 1 ELSE 0 END AS bit) ready;`);
    return recordset?.[0]?.ready === true;
  }

  async transaction(guard, work) {
    const pool = this.manager.pool, sql = this.manager.sql();
    const current = () => {
      guard();
      if (pool !== this.manager.pool) throw fail();
    };
    current();
    const tx = new sql.Transaction(pool);
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      const history = new StockHistoryStore(this.manager, { assertCurrent: current, expectedDatabaseGuid: this.databaseGuid });
      if (!(await history.capability(tx)).available || !(await this.intentStorageReady(tx))) throw fail();
      const outcome = await work(tx, history);
      current();
      await tx.commit();
      return outcome;
    } catch (error) {
      await Promise.resolve(tx.rollback()).catch(() => undefined);
      throw error;
    }
  }

  async receipt(tx, input, scope) {
    const { recordset } = await tx.request().input("operation", input.operationId).query(`
      SELECT LOWER(CONVERT(nvarchar(36),master_id)) entity_id,intent_json note,outcome_json
       FROM dbo.stock_history_product_merge_intents WITH(UPDLOCK,HOLDLOCK,NOWAIT) WHERE operation_id=@operation;`);
    const current = recordset?.[0];
    const legacy = current ? null : (await tx.request().input("operation", input.operationId).query(`
      SELECT entity_id,note,operation_type FROM dbo.local_operation_receipts WITH(UPDLOCK,HOLDLOCK,NOWAIT)
       WHERE operation_id=@operation;`)).recordset?.[0];
    const row = current ?? legacy;
    if (!row) return null;
    if (legacy && legacy.operation_type !== intentType) throw fail("ESYNC_PRODUCT_MERGE_REPLAY_MISMATCH");
    let note;
    try {
      note = JSON.parse(row.note);
      if (current) note.outcome = current.outcome_json === null ? null : JSON.parse(current.outcome_json);
    } catch { throw fail(); }
    if (row.entity_id?.toLowerCase() !== input.masterId ||
        !isDeepStrictEqual(note?.request, input) || !isDeepStrictEqual(note?.scope, scope))
      throw fail("ESYNC_PRODUCT_MERGE_REPLAY_MISMATCH");
    if (legacy && !note.outcome) throw fail("ESYNC_PRODUCT_MERGE_PREVIOUS_PENDING");
    return note;
  }

  async readProducts(tx, input) {
    const { recordset } = await tx.request().input("roster", JSON.stringify(input.roster)).input("branch", input.branchId).query(`
      SELECT LOWER(CONVERT(nvarchar(36),p.id)) id,p.owner_store_id,p.deleted_at,p.row_version,p.sku,p.name,p.barcode,p.stock_quantity,
        p.stock_by_store stock,p.barcode_aliases aliases,
        CAST(CASE WHEN ${booking} OR ${heldTicket} THEN 1 ELSE 0 END AS bit) open_reference,
        CAST(CASE WHEN ${relational} OR ${booking} OR ${heldTicket} THEN 1 ELSE 0 END AS bit) blocked,
        CAST(CASE WHEN ISJSON(p.stock_by_store,OBJECT)<>1 OR EXISTS(SELECT 1
          FROM OPENJSON(CASE WHEN ISJSON(p.stock_by_store,OBJECT)=1 THEN p.stock_by_store ELSE N'{}' END) e
          GROUP BY e.[key] COLLATE Latin1_General_100_BIN2 HAVING COUNT(*)<>1) THEN 1 ELSE 0 END AS bit) unverified_stock
      FROM dbo.products p WITH(UPDLOCK,HOLDLOCK,NOWAIT) JOIN ${productIds} wanted ON wanted.id=p.id
      WHERE ${cis("p.owner_store_id")} ORDER BY p.id;`);
    if ((recordset ?? []).some(row => row.unverified_stock)) throw fail("ESYNC_PRODUCT_MERGE_LOCAL_CONFLICT");
    return recordset ?? [];
  }

  preimage(rows, input) {
    const products = decodeProducts(rows, input);
    const winner = products.get(input.masterId);
    if (winner.open_reference || [...products].some(([id, product]) => id !== input.masterId && product.blocked))
      throw fail("ESYNC_PRODUCT_MERGE_LOCAL_REFERENCES");
    return products;
  }

  async verifyApplied(tx, input, original, rows, plan, trackingVersion) {
    const remaining = input.roster.filter(row => !plan.removed.includes(row.id)).map(row =>
      row.id === input.masterId ? { ...row, rowVersion: String(plan.revision) } : row);
    const applied = decodeProducts(rows, { ...input, roster: remaining });
    const expected = new Map(remaining.map(({ id }) => [id, productState(original.get(id))]));
    Object.assign(expected.get(input.masterId), { stock: plan.stock, aliases: plan.aliases,
      stock_quantity: plan.total, row_version: plan.revision });
    if (!sameProducts(applied, expected)) throw fail("ESYNC_PRODUCT_MERGE_LOCAL_CONFLICT");
    const { recordset } = await tx.request().input("version", trackingVersion).input("master", input.masterId)
      .input("removed", JSON.stringify(plan.removed)).query(`
      DECLARE @base bigint=TRY_CONVERT(bigint,@version),
        @min bigint=CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(N'dbo.products')),
        @head bigint=CHANGE_TRACKING_CURRENT_VERSION();
      IF @base IS NULL OR @min IS NULL OR @head IS NULL OR @base<@min OR @base>@head
      BEGIN SELECT CAST(0 AS bit) proven; RETURN; END;
      IF NOT EXISTS(SELECT 1 FROM CHANGETABLE(CHANGES dbo.products,@base) ct
       WHERE ct.id=CONVERT(uniqueidentifier,@master) AND ct.SYS_CHANGE_OPERATION=N'U'
        AND ct.SYS_CHANGE_CONTEXT=0x434C4F5544)
      OR EXISTS(SELECT 1 FROM OPENJSON(@removed) wanted
       LEFT JOIN CHANGETABLE(CHANGES dbo.products,@base) ct ON ct.id=CONVERT(uniqueidentifier,wanted.value)
        AND ct.SYS_CHANGE_OPERATION=N'D' AND ct.SYS_CHANGE_CONTEXT=0x434C4F5544
       WHERE ct.id IS NULL OR EXISTS(SELECT 1 FROM dbo.products p WITH(UPDLOCK,HOLDLOCK,NOWAIT) WHERE p.id=ct.id))
      BEGIN SELECT CAST(0 AS bit) proven; RETURN; END;
      SELECT CAST(1 AS bit) proven;`);
    if (recordset?.[0]?.proven !== true) throw fail("ESYNC_PRODUCT_MERGE_LOCAL_CONFLICT");
  }

  async prepare(input, scope, guard, admitNew = guard) {
    return this.transaction(guard, async tx => {
      const prior = await this.receipt(tx, input, scope);
      if (prior) return { request: input, outcome: prior.outcome ? acceptance(input, prior.outcome) : null };
      const legacy = await tx.request().input("branch", input.branchId).query(`
        SELECT TOP (1) 1 pending FROM dbo.local_operation_receipts WITH(UPDLOCK,HOLDLOCK,NOWAIT)
        CROSS APPLY (SELECT CASE WHEN ISJSON(note,OBJECT)=1 THEN note END document) parsed
        CROSS APPLY (SELECT JSON_VALUE(parsed.document,'$.request.branchId') branch_id,
          JSON_QUERY(parsed.document,'$.outcome') outcome) stored
        WHERE operation_type=N'${intentType}' AND (stored.branch_id IS NULL OR ${cis("stored.branch_id")})
          AND COALESCE(ISJSON(stored.outcome,OBJECT),0)<>1;`);
      if (legacy.recordset?.length) throw fail("ESYNC_PRODUCT_MERGE_PREVIOUS_PENDING");
      const conflict = await tx.request().input("branch", input.branchId).query(`
        SELECT LOWER(CONVERT(nvarchar(36),operation_id)) operation_id FROM dbo.stock_history_product_merge_intents
        WITH(UPDLOCK,HOLDLOCK,NOWAIT) WHERE branch_id=@branch AND ${cis("branch_id")} AND outcome_json IS NULL;`);
      if (conflict.recordset?.length) {
        const recovered = conflict.recordset.length === 1 && request({ ...input, operationId: conflict.recordset[0].operation_id }, input.branchId);
        if (!recovered) throw fail("ESYNC_PRODUCT_MERGE_PREVIOUS_PENDING");
        try {
          const pending = await this.receipt(tx, recovered, scope);
          if (pending && !pending.outcome) return { request: recovered, outcome: null };
        } catch (error) {
          if (error?.code !== "ESYNC_PRODUCT_MERGE_REPLAY_MISMATCH") throw error;
        }
        throw fail("ESYNC_PRODUCT_MERGE_PREVIOUS_PENDING");
      }
      const trackingVersion = await exactCheckpoint(tx, input.branchId);
      const original = await this.readProducts(tx, input);
      this.preimage(original, input);
      await admitNew();
      guard();
      const note = JSON.stringify({ request: input, scope, original, trackingVersion });
      await tx.request().input("operation", input.operationId).input("entity", input.masterId).input("branch", input.branchId)
        .input("note", this.manager.sql().NVarChar(this.manager.sql().MAX), note).query(`
        INSERT dbo.stock_history_product_merge_intents(operation_id,branch_id,master_id,intent_json)
         VALUES(@operation,@branch,@entity,@note);`);
      return { request: input, outcome: null };
    });
  }

  async finish(input, scope, guard, send, readReceipt) {
    return this.transaction(guard, async (tx, history) => {
      const prior = await this.receipt(tx, input, scope);
      if (!prior) throw fail();
      if (prior.outcome) return acceptance(input, prior.outcome);
      guard();
      const accepted = receivedReceipt(input, await readReceipt());
      guard();
      await exactCheckpoint(tx, input.branchId);
      const rows = await this.readProducts(tx, input);
      if (!Array.isArray(prior.original) || !/^\d{1,19}$/.test(prior.trackingVersion)) throw fail();
      const original = this.preimage(prior.original, input);
      let products;
      try { products = this.preimage(rows, input); }
      catch (error) {
        if (error?.code !== "ESYNC_PRODUCT_MERGE_LOCAL_CONFLICT" || !accepted?.removed.length) throw error;
      }
      if (products && !sameProducts(products, original)) throw fail("ESYNC_PRODUCT_MERGE_LOCAL_CONFLICT");
      guard();
      const outcome = accepted ?? acceptance(input, await send());
      guard();
      const plan = mergePlan(input, outcome, original);
      if (plan.removed.length) {
        if (!products) await this.verifyApplied(tx, input, original, rows, plan, prior.trackingVersion);
        else {
          const result = await tx.request().input("master", input.masterId).input("branch", input.branchId)
            .input("removed", JSON.stringify(plan.removed)).input("stock", JSON.stringify(plan.stock)).input("aliases", JSON.stringify(plan.aliases))
            .input("total", plan.total).input("revision", plan.revision).query(`
            WITH CHANGE_TRACKING_CONTEXT (0x434C4F5544)
            DELETE p FROM dbo.products p JOIN OPENJSON(@removed) wanted ON p.id=TRY_CONVERT(uniqueidentifier,wanted.value)
             WHERE ${cis("p.owner_store_id")};
            IF @@ROWCOUNT<>(SELECT COUNT(*) FROM OPENJSON(@removed)) THROW 51031,'PRODUCT_MERGE_LOCAL_UNVERIFIED',1;
            ${stockLifecycleDeclaration}
            WITH CHANGE_TRACKING_CONTEXT (0x434C4F5544)
            UPDATE product SET stock_by_store=@stock,stock_quantity=@total,barcode_aliases=@aliases,row_version=@revision,
              ${stockLifecycleAssignments("product", "@total")}
            FROM dbo.products AS product WHERE product.id=CONVERT(uniqueidentifier,@master) AND ${cis("product.owner_store_id")};
            IF @@ROWCOUNT<>1 THROW 51031,'PRODUCT_MERGE_LOCAL_UNVERIFIED',1;
            SELECT stock_by_store stock,stock_quantity total,barcode_aliases aliases,row_version revision FROM dbo.products WHERE id=@master;`);
          const saved = result.recordset?.[0];
          if (!saved || saved.stock !== JSON.stringify(plan.stock) || saved.aliases !== JSON.stringify(plan.aliases) ||
              saved.total !== plan.total || saved.revision !== plan.revision) throw fail("ESYNC_PRODUCT_MERGE_LOCAL_CONFLICT");
        }
        await history.invalidateCoverage(tx, input.branchId, "PRODUCT_MERGE_AUTHORITY_CHANGED");
      }
      await tx.request().input("operation", input.operationId)
        .input("outcome", this.manager.sql().NVarChar(this.manager.sql().MAX), JSON.stringify(outcome)).query(`
        UPDATE dbo.stock_history_product_merge_intents SET outcome_json=@outcome WHERE operation_id=@operation AND outcome_json IS NULL;
        IF @@ROWCOUNT<>1 THROW 51031,'PRODUCT_MERGE_LOCAL_UNVERIFIED',1;`);
      return outcome;
    });
  }
}
module.exports = { ProductMergeRepository };
