import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { decimal } from "../../electron/sync/shift-recovery-exact.mjs";

const require = createRequire(import.meta.url);
const { createLocal } = require("./shift-protocol-integration-fixture.cjs");
const { stableUuid } = require("../../electron/db/repositories/aggregates.cjs");
const { ChangeReader } = require("../../electron/sync/change-reader.cjs");
const { parseFinancialCorrection, applyFinancialCorrection } =
  require("../../electron/sync/grouped-financial-corrections.cjs");

export async function runFinancialCorrectionFeed({ db, read, fn, scalar, test, liveSale, author, admin, terminal, product }) {
  const branch = "A";
  const epoch = randomUUID();
  const preparation = [
    "pos-sync-feed-v1.sql", "pos-sync-store-settings-v1.sql", "pos-sync-grouped-gateway-v1.sql",
    "pos-sync-cash-settings-gateway-v1.sql", "pos-sync-live-stock-v1.sql", "pos-sync-extended-feed-v1.sql",
    "pos-sync-cash-settings-recovery-v1.sql", "pos-sync-refund-v1.sql",
    "pos-sync-financial-corrections-feed-v1.sql", "pos-sync-correction-receipt-recovery-v1.sql",
  ];
  await db.exec(`ALTER TABLE public.products ADD COLUMN row_version integer DEFAULT 1 NOT NULL;
    ALTER TABLE public.payment_transactions ADD COLUMN IF NOT EXISTS order_id uuid,
      ADD COLUMN IF NOT EXISTS payment_method text, ADD COLUMN IF NOT EXISTS transaction_reference text;
    ${fn("products_bump_row_version")}
    CREATE TRIGGER products_row_version BEFORE UPDATE ON public.products
      FOR EACH ROW EXECUTE FUNCTION public.products_bump_row_version();
    CREATE TRIGGER sale_items_bump BEFORE UPDATE ON public.sale_items
      FOR EACH ROW EXECUTE FUNCTION public.bump_row_version();
    CREATE TRIGGER sales_bump BEFORE UPDATE ON public.sales
      FOR EACH ROW EXECUTE FUNCTION public.bump_row_version();
    CREATE TRIGGER payment_transactions_bump BEFORE UPDATE ON public.payment_transactions
      FOR EACH ROW EXECUTE FUNCTION public.bump_row_version();
    CREATE TRIGGER payment_transactions_touch BEFORE UPDATE ON public.payment_transactions
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();`);
  for (const name of preparation) await db.exec(await read(`scripts/preparation/${name}`));
  await db.query("INSERT INTO pos_sync_feed_v1.feed_heads VALUES ('default',$1,$2,0,0)", [branch, epoch]);
  await db.query(`INSERT INTO pos_sync_feed_v1.settings_pilots(organization_id,scope_id,epoch)
    VALUES ('default',$1,$2)`, [branch, epoch]);
  await scalar("SELECT pos_sync_feed_v1.arm_cash_settings_scope('default',$1,$2)", [branch, epoch]);
  await scalar("SELECT pos_sync_feed_v1.arm_cash_stock_scope('default',$1,$2)", [branch, epoch]);
  await scalar("SELECT pos_sync_feed_v1.arm_extended_scope('default',$1,$2)", [branch, epoch]);

  const sale = await liveSale(true);
  const originalSale = await scalar("SELECT to_jsonb(s) FROM public.sales AS s WHERE id=$1", [sale.id]);
  const item = await scalar("SELECT to_jsonb(i) FROM public.sale_items AS i WHERE sale_id=$1", [sale.id]);
  const tender = await scalar("SELECT to_jsonb(p) FROM public.payment_transactions AS p WHERE sale_id=$1", [sale.id]);
  const startStock = await scalar("SELECT to_jsonb(p) FROM public.products AS p WHERE id=$1", [product]);
  const tenderApply = (store = branch) => scalar(`SELECT public.pos_sync_request_tender_v1($1,$2,$3,'card',$4,$5)`,
    [admin, sale.id, store, terminal, originalSale.row_version]);
  const refundKey = `refund:${sale.id}`;
  const refundOperation = stableUuid({ refundId: refundKey });
  const refundApply = basis => scalar("SELECT public.pos_sync_refund_v1($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb)",
    [author, branch, terminal, refundOperation, refundKey, sale.id, originalSale.row_version + 1,
      JSON.stringify([{ item_id: item.id, qty: 1, expected_refunded_qty: 0, expected_row_version: item.row_version }]),
      "verified refund", basis == null ? null : JSON.stringify(basis)]);
  const archived = id => scalar(`SELECT jsonb_build_object('seq',seq::text,'operation_id',operation_id,'changes',changes)
    || metadata || pos_sync_feed_v1.financial_parent_evidence(publication)
    FROM pos_sync_feed_v1.extended_publications AS publication WHERE operation_id=$1`, [id]);
  let refundGroup, tenderGroup;
  await test("canonical tender and refund commits publish one exact group each, including refund stock", async () => {
    const tenderApplied = await tenderApply();
    assert.equal(tenderApplied.status, "APPLIED");
    assert.deepEqual(await tenderApply(branch.toLowerCase()), { ...tenderApplied, status: "ALREADY_APPLIED" });
    const approval = await refundApply(null);
    assert.equal(approval.status, "APPROVAL_CHECK_REQUIRED");
    const applied = await refundApply(approval.basis);
    assert.equal(applied.status, "APPLIED");
    assert.deepEqual(await refundApply(null), applied);
    const tenderWire = await archived(tenderApplied.result.operation_id);
    const refundWire = await archived(refundOperation);
    assert.equal(typeof tenderWire.receipt_graph?.payload_json, "string");
    assert.equal(typeof refundWire.receipt_graph?.payload_json, "string");
    tenderGroup = parseFinancialCorrection(tenderWire, branch);
    refundGroup = parseFinancialCorrection(refundWire, branch);
    assert.equal(BigInt(refundGroup.seq), BigInt(tenderGroup.seq) + 1n);
    assert.equal(refundGroup.stock[0].branch_balance, startStock.stock_by_store.A + 1);
    assert.equal(refundGroup.ledger[0].movement_id, applied.effects[0].movement_id);
    assert.equal(refundGroup.stock[0].row_version, startStock.row_version + 1);
    assert.throws(() => parseFinancialCorrection(refundWire, "B"), /authorized scope/);
    const mismatched = structuredClone(refundWire);
    mismatched.changes[2].row_data.item_id = randomUUID();
    assert.throws(() => parseFinancialCorrection(mismatched, branch), /authorized scope/);
    assert.equal(await scalar(`SELECT count(*)::integer FROM pos_sync_feed_v1.extended_publications
      WHERE organization_id='default' AND scope_id=$1`, [branch]), 3);
  });

  await test("LocalDB applies correction and stock in one transaction and leaves no partial refund on a stock hold", async () => {
    const local = await createLocal(branch, { extraTables: ["products", "stock_delta_applied"] });
    const { manager, registry } = local;
    const insert = (name, source, fields) => local.insert(name, Object.fromEntries(
      fields.split(" ").map(key => [key, source[key] ?? null])));
    try {
      await manager.pool.request().batch(await read("scripts/preparation/pos-sync-live-stock-native-v1.sql"));
      await insert("sales", originalSale, "id store_id row_version is_refunded payment_type payments");
      await insert("sale_items", item, "id sale_id branch_id product_id row_version refunded_qty quantity");
      await insert("payment_transactions", tender, "id sale_id store_id source_type row_version method updated_at");
      await local.insert("products", { id: product, owner_store_id: branch, row_version: startStock.row_version,
        stock_quantity: startStock.stock_by_store.A + 4, stock_by_store: { A: startStock.stock_by_store.A, B: 4 } });
      await manager.pool.request().query("UPDATE dbo.sync_checkpoints SET change_tracking_version=CHANGE_TRACKING_CURRENT_VERSION();");

      const worker = { registry, connectionManager: manager, reader: new ChangeReader(manager, registry) };
      const context = { branch, financialEpoch: epoch };
      const apply = async facts => {
        const sql = manager.sql();
        const transaction = new sql.Transaction(manager.pool);
        await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
        try {
          const changed = await applyFinancialCorrection(worker, transaction, context, facts);
          await transaction.commit();
          return changed;
        } catch (error) {
          await transaction.rollback();
          throw error;
        }
      };
      const readLocal = async () => (await manager.pool.request().input("sale", sale.id).input("product", product).query(`
        SELECT (SELECT row_version FROM dbo.sales WHERE id=@sale) AS version,
          (SELECT is_refunded FROM dbo.sales WHERE id=@sale) AS refunded,
          (SELECT refunded_qty FROM dbo.sale_items WHERE sale_id=@sale) AS quantity,
          (SELECT JSON_VALUE(payments,'$[0].method') FROM dbo.sales WHERE id=@sale) AS embedded_method,
          (SELECT JSON_VALUE(payments,'$[0].amount') FROM dbo.sales WHERE id=@sale) AS embedded_amount,
          (SELECT method FROM dbo.payment_transactions WHERE sale_id=@sale) AS tender,
          (SELECT count(*) FROM dbo.stock_delta_applied) AS movements,
          (SELECT stock_quantity FROM dbo.products WHERE id=@product) AS total,
          (SELECT stock_by_store FROM dbo.products WHERE id=@product) AS buckets;`)).recordset[0];
      assert.equal(await apply(tenderGroup), 2);
      assert.equal(await apply(tenderGroup), 0);
      const beforeRefund = await readLocal();
      assert.equal(beforeRefund.tender, "card");
      assert.equal(beforeRefund.embedded_method, "card");
      assert.equal(beforeRefund.embedded_amount, originalSale.payments[0].amount);
      await manager.pool.request().input("key", JSON.stringify({ id: product })).query(`
        INSERT dbo.sync_change_journal(entity_type,entity_id,branch_id,operation,entity_version)
        VALUES(N'products',@key,N'A',N'update',1);`);
      await assert.rejects(apply(refundGroup), { code: "ELOCAL_UPLOAD_PENDING" });
      assert.deepEqual(await readLocal(), beforeRefund);
      await manager.pool.request().query("DELETE FROM dbo.sync_change_journal WHERE entity_type=N'products';");
      assert.equal(await apply(refundGroup), 4);
      assert.equal(await apply(refundGroup), 0);
      const afterRefund = await readLocal();
      assert.equal(afterRefund.version, beforeRefund.version + 1);
      assert.equal(afterRefund.refunded, true);
      assert.equal(afterRefund.quantity, 1);
      assert.equal(afterRefund.movements, 1);
      assert.equal(afterRefund.total, beforeRefund.total + 1);
      assert.deepEqual(JSON.parse(afterRefund.buckets), { A: startStock.stock_by_store.A + 1, B: 4 });
    } finally { await local.close(); }
  });
  await test("LocalDB recovers a wholly missing exact receipt before advancing its correction", async () => {
    const local = await createLocal(branch, { extraTables: ["products", "stock_delta_applied"] });
    const { manager, registry } = local;
    try {
      await manager.pool.request().batch(await read("scripts/preparation/pos-sync-live-stock-native-v1.sql"));
      await local.insert("shifts", { id: originalSale.shift_id, store_id: branch });
      await local.insert("products", { id: product, owner_store_id: branch, row_version: startStock.row_version,
        stock_quantity: startStock.stock_by_store.A + 4, stock_by_store: { A: startStock.stock_by_store.A, B: 4 } });
      await manager.pool.request().query("UPDATE dbo.sync_checkpoints SET change_tracking_version=CHANGE_TRACKING_CURRENT_VERSION();");
      const worker = { registry, connectionManager: manager, reader: new ChangeReader(manager, registry) };
      const context = { branch, financialEpoch: epoch };
      const apply = async facts => {
        const sql = manager.sql(), transaction = new sql.Transaction(manager.pool);
        await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
        try {
          const changed = await applyFinancialCorrection(worker, transaction, context, facts);
          await transaction.commit();
          return changed;
        } catch (error) { await transaction.rollback(); throw error; }
      };
      const counts = async () => (await manager.pool.request().query(`SELECT
        (SELECT COUNT(*) FROM dbo.sales) sales, (SELECT COUNT(*) FROM dbo.sale_items) items,
        (SELECT COUNT(*) FROM dbo.payment_transactions) tenders,(SELECT COUNT(*) FROM dbo.stock_delta_applied) movements;`))
        .recordset[0];
      const empty = { sales: 0, items: 0, tenders: 0, movements: 0 };
      await assert.rejects(apply({ ...refundGroup, receiptGraph: undefined }), { code: "ESYNC_CASH_RECEIPT_DEPENDENCY" });
      const forged = JSON.parse(refundGroup.receiptGraph.payload_json);
      forged.tenders[0].store_id = "B";
      const bytes = JSON.stringify(forged);
      await assert.rejects(apply({ ...refundGroup, receiptGraph: { payload_json: bytes,
        payload_sha256: createHash("sha256").update(bytes).digest("hex") } }), { code: "ESYNC_GROUPED_REVIEW_REQUIRED" });
      assert.equal(await apply(tenderGroup), 3);
      assert.equal(await apply(tenderGroup), 0);
      assert.deepEqual(await counts(), { sales: 1, items: 1, tenders: 1, movements: 0 });
      // Reproduce a missing receipt with an orphan child in this isolated
      // fixture. Cloud-tagged deletes retain the production CT boundary.
      await manager.pool.request().input("sale", sale.id).query(`
        WITH CHANGE_TRACKING_CONTEXT (0x434C4F5544)
        DELETE FROM dbo.payment_transactions WHERE sale_id=@sale;
        WITH CHANGE_TRACKING_CONTEXT (0x434C4F5544)
        DELETE FROM dbo.sales WHERE id=@sale;`);
      await assert.rejects(apply(refundGroup), { code: "ESYNC_GROUPED_REVIEW_REQUIRED" });
      assert.deepEqual(await counts(), { ...empty, items: 1 });
      await manager.pool.request().input("sale", sale.id).query(`
        WITH CHANGE_TRACKING_CONTEXT (0x434C4F5544) DELETE FROM dbo.sale_items WHERE sale_id=@sale;`);
      await manager.pool.request().input("key", JSON.stringify({ id: product })).query(`
        INSERT dbo.sync_change_journal(entity_type,entity_id,branch_id,operation,entity_version)
        VALUES(N'products',@key,N'A',N'update',1);`);
      await assert.rejects(apply(refundGroup), { code: "ELOCAL_UPLOAD_PENDING" });
      assert.deepEqual(await counts(), empty);
      await manager.pool.request().query("DELETE FROM dbo.sync_change_journal WHERE entity_type=N'products';");
      assert.equal(await apply(refundGroup), 5);
      assert.equal(await apply(refundGroup), 0);
      assert.deepEqual(await counts(), { sales: 1, items: 1, tenders: 1, movements: 1 });
      const exact = (await manager.pool.request().input("sale", sale.id).input("product", product).query(`
        SELECT (SELECT payments FROM dbo.sales WHERE id=@sale) payments,
          (SELECT stock_by_store FROM dbo.products WHERE id=@product) stock,
          (SELECT CONVERT(nvarchar(70),amount) FROM dbo.payment_transactions WHERE sale_id=@sale) tender;`)).recordset[0];
      const archive = JSON.parse(refundGroup.receiptGraph.payload_json);
      assert.equal(exact.payments, archive.sale.payments);
      assert.equal(decimal(exact.tender), decimal(archive.tenders[0].amount));
      assert.deepEqual(JSON.parse(exact.stock), { A: startStock.stock_by_store.A + 1, B: 4 });
    } finally { await local.close(); }
  });
  const { verifyNativeRefundGateway } = await import("./pos-sync-refund-fixture.mjs");
  await test("native refund gateway binds database, epoch and author and returns archived exact replay",
    () => verifyNativeRefundGateway({ db, read, scalar, liveSale, branch, epoch, terminal, author, product }));
}
