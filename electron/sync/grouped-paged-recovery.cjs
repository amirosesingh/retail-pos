const { createHash } = require("node:crypto");
const { stableUuid } = require("../db/repositories/aggregates.cjs");
const grouped = require("./grouped-store-settings.cjs");
const { applyGroupedStock, parseStockRecoveryRow } = require("./grouped-live-stock.cjs");

const RECOVERY = "paged_stock_v1";
const PAGE_LIMIT = 25;
const MAX_PAGE_BYTES = 768 * 1024 + 2048;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const PAGE_TABLE = "dbo.pos_sync_cash_settings_recovery_pages_v1";
const fail = (message, code = "ESYNC_GROUPED_PROTOCOL") => grouped.fail(message, code);
const exact = (row, keys) => !!row && !Array.isArray(row) && typeof row === "object" &&
  Object.keys(row).length === keys.length && keys.every(key => Object.hasOwn(row, key));
const hash = value => createHash("sha256").update(value, "utf8").digest("hex");

function ordinal(value) {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,18})$/.test(value) || BigInt(value) > 9223372036854775807n)
    throw fail("The paged recovery position is invalid.");
  return BigInt(value);
}

function decode(text, digest, bytes) {
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > bytes ||
      typeof digest !== "string" || !HASH.test(digest) || hash(text) !== digest)
    throw fail("The paged recovery payload checksum is invalid.");
  try { return JSON.parse(text); }
  catch { throw fail("The paged recovery payload is malformed."); }
}

function snapshotFor(response, branch, table, extended, atLeastSeq) {
  if (!exact(response, ["status", "scope_id", "epoch", "seq", "pin_id", "expires_at", "manifest_json", "manifest_sha256"]) ||
      response.status !== "OK" || response.scope_id !== branch || !UUID.test(response.pin_id ?? "") ||
      !UUID.test(response.epoch ?? ""))
    throw fail("The paged recovery manifest does not match the registered scope.");
  const manifest = decode(response.manifest_json, response.manifest_sha256, 65536);
  const fields = ["scope_id", "epoch", "seq", "changes", "cash_count", "stock_count"];
  if (extended) fields.push("financial_count", "cash_installation");
  if (extended && Object.hasOwn(manifest ?? {}, "sealed_seq")) fields.push("sealed_seq");
  if (!exact(manifest, fields) ||
      manifest.scope_id !== branch || manifest.epoch !== response.epoch || manifest.seq !== response.seq ||
      ordinal(manifest.cash_count) + ordinal(manifest.financial_count ?? "0") > ordinal(manifest.seq) ||
      (atLeastSeq !== undefined && ordinal(manifest.seq) < ordinal(atLeastSeq)) ||
      (manifest.sealed_seq !== undefined && ordinal(manifest.sealed_seq) > ordinal(manifest.seq)))
    throw fail("The paged recovery manifest does not prove complete coverage.");
  ordinal(manifest.stock_count);
  const { cash_count, stock_count, financial_count, cash_installation, sealed_seq, ...settingsManifest } = manifest;
  if (extended && cash_installation !== null &&
      (!exact(cash_installation, ["generation", "database_guid"]) || !UUID.test(cash_installation.generation ?? "") ||
        !UUID.test(cash_installation.database_guid ?? "")))
    throw fail("The snapshot does not prove its registered cash sender.");
  const settingsJson = JSON.stringify(settingsManifest);
  const settings = grouped.settingsFromSnapshot({ ...response, manifest_json: settingsJson,
    manifest_sha256: hash(settingsJson) }, branch, table);
  return { ...settings, branch, pinId: response.pin_id, expiresAt: response.expires_at, cashInstallation: cash_installation,
    sealedSeq: sealed_seq,
    totals: { cash: cash_count, ...(extended ? { financial: financial_count } : {}), stock: stock_count } };
}

function assertSnapshotLive(snapshot) {
  if (snapshot.expires <= Date.now()) throw fail("The paged recovery pin expired.");
}

function pageFor(page, kind, after, snapshot) {
  if (!exact(page, ["scope_id", "epoch", "seq", "pin_id", "kind", "after", "next", "total", "rows"]) ||
      page.scope_id !== snapshot.branch || page.epoch !== snapshot.epoch || page.seq !== snapshot.seq ||
      page.pin_id !== snapshot.pinId || page.kind !== kind || page.after !== after ||
      page.total !== snapshot.totals[kind] || !Array.isArray(page.rows) || page.rows.length > PAGE_LIMIT ||
      !page.rows.length || ordinal(page.next) !== ordinal(after) + BigInt(page.rows.length) ||
      ordinal(page.next) > ordinal(page.total))
    throw fail("The recovery page does not prove its contiguous scoped coverage.");
  return page;
}

function checkRows(page, snapshot, parseCash, previous) {
  return page.rows.map(row => {
    if (page.kind === "cash" || page.kind === "financial") {
      const seq = ordinal(row?.seq);
      if (seq <= previous[page.kind] || seq > ordinal(snapshot.seq))
        throw fail("The recovery archive contains a repeated or out-of-order financial group.");
      previous[page.kind] = seq;
      if (page.kind === "cash") return { facts: parseCash(row, snapshot.epoch), seq: row.seq };
      return require("./grouped-financial-corrections.cjs").parseFinancialCorrection(row, snapshot.branch);
    }
    parseStockRecoveryRow(row, Object.hasOwn(snapshot.totals, "financial"));
    if (row.product_id <= previous.stock)
      throw fail("The recovery archive contains invalid or repeated branch stock.");
    previous.stock = row.product_id;
    return row;
  });
}

// Pages stay on the scoped SQL Server, rather than accumulating in process or
// leaving receipt data in an OS temporary file. Network reads never hold local
// business locks. Activation revalidates all staged pages in one transaction.
async function stagePagedRecovery(cloud, context, assertCurrent) {
  const { source, branch, table, parseCash, extended, atLeastSeq } = context;
  assertCurrent();
  const manifest = await cloud.beginGroupedRecovery(source, { extended, atLeastSeq });
  const snapshot = snapshotFor(manifest, branch, table, extended, atLeastSeq);
  const runId = stableUuid({ source: source.fingerprint, databaseGuid: context.databaseGuid,
    pin: snapshot.pinId, manifest: manifest.manifest_sha256 });
  const clear = () => source.pool.request().input("run", runId).query(`DELETE FROM ${PAGE_TABLE} WHERE run_id=@run;`);
  try {
    assertCurrent();
    await source.pool.request().query(`DELETE FROM ${PAGE_TABLE} WHERE expires_at<=SYSUTCDATETIME();`);
    const previous = { cash: 0n, financial: 0n, stock: "" };
    for (const kind of Object.keys(snapshot.totals)) {
      let after = "0";
      while (after !== snapshot.totals[kind]) {
        assertCurrent();
        assertSnapshotLive(snapshot);
        const staged = await source.pool.request().input("run", runId).input("kind", kind).input("after", after).query(`
          SELECT payload_json,payload_sha256 FROM ${PAGE_TABLE}
          WHERE run_id=@run AND kind=@kind AND after_ordinal=CONVERT(bigint,@after) AND expires_at>SYSUTCDATETIME();`);
        const saved = staged.recordset?.[0];
        const response = saved ?? await cloud.pageGroupedRecovery(source, { pinId: snapshot.pinId, kind, after, limit: PAGE_LIMIT,
          ...(extended ? { extended } : {}) });
        assertCurrent();
        if (!saved &&
            (!exact(response, ["status", "scope_id", "epoch", "seq", "pin_id", "expires_at", "payload_json", "payload_sha256"]) ||
             response.status !== "OK" || response.scope_id !== branch || response.epoch !== snapshot.epoch ||
             response.seq !== snapshot.seq || response.pin_id !== snapshot.pinId || response.expires_at !== snapshot.expiresAt))
          throw fail("The recovery page came from a different or expired pin.");
        const page = pageFor(decode(response.payload_json, response.payload_sha256, MAX_PAGE_BYTES), kind, after, snapshot);
        checkRows(page, snapshot, parseCash, previous);
        if (!saved) await source.pool.request().input("run", runId).input("kind", kind).input("after", after)
          .input("expires", new Date(snapshot.expires)).input("payload", response.payload_json).input("hash", response.payload_sha256)
          .query(`INSERT ${PAGE_TABLE} (run_id,kind,after_ordinal,expires_at,payload_json,payload_sha256)
            SELECT @run,@kind,CONVERT(bigint,@after),@expires,@payload,@hash
            WHERE NOT EXISTS (SELECT 1 FROM ${PAGE_TABLE} WITH(UPDLOCK,HOLDLOCK)
              WHERE run_id=@run AND kind=@kind AND after_ordinal=CONVERT(bigint,@after));`);
        after = page.next;
      }
    }
    assertSnapshotLive(snapshot);
    return { ...snapshot, runId, clear };
  } catch (error) {
    if (error?.code === "ESYNC_GROUPED_PROTOCOL") await clear().catch(() => {});
    throw error;
  }
}

async function verifyCoverage(transaction, snapshot) {
  const result = await transaction.request().input("run", snapshot.runId).query(`
    WITH cash AS (
      SELECT row.operation_id,row.changes
      FROM ${PAGE_TABLE} p CROSS APPLY OPENJSON(p.payload_json,'$.rows')
      WITH (operation_id uniqueidentifier '$.operation_id',changes nvarchar(max) '$.changes' AS JSON) AS row
      WHERE p.run_id=@run AND p.kind='cash'
    ), financial AS (
      SELECT row.operation_id FROM ${PAGE_TABLE} p CROSS APPLY OPENJSON(p.payload_json,'$.rows')
      WITH (operation_id uniqueidentifier '$.operation_id') AS row
      WHERE p.run_id=@run AND p.kind='financial'
    ), stock AS (
      SELECT row.product_id FROM ${PAGE_TABLE} p CROSS APPLY OPENJSON(p.payload_json,'$.rows')
      WITH (product_id uniqueidentifier '$.product_id') AS row
      WHERE p.run_id=@run AND p.kind='stock'
    )
    SELECT CONVERT(varchar(20),(SELECT COUNT_BIG(*) FROM cash)) AS cash_count,
      CONVERT(varchar(20),(SELECT COUNT_BIG(*) FROM financial)) AS financial_count,
      CONVERT(varchar(20),(SELECT COUNT_BIG(*) FROM stock)) AS stock_count,
      CASE WHEN EXISTS(SELECT 1 FROM cash GROUP BY operation_id HAVING COUNT_BIG(*)<>1)
        OR EXISTS(SELECT 1 FROM financial GROUP BY operation_id HAVING COUNT_BIG(*)<>1)
        OR EXISTS(SELECT 1 FROM stock GROUP BY product_id HAVING COUNT_BIG(*)<>1)
        OR EXISTS(SELECT 1 FROM cash WHERE NOT EXISTS(SELECT 1 FROM stock
          WHERE stock.product_id=TRY_CONVERT(uniqueidentifier,JSON_VALUE(cash.changes,'$[1].row_data.product_id'))))
        OR EXISTS(SELECT 1 FROM cash CROSS APPLY OPENJSON(cash.changes)
          WITH (table_name varchar(50) '$.table_name', entity_id uniqueidentifier '$.row_data.id') AS entity
          GROUP BY entity.table_name,entity.entity_id HAVING COUNT_BIG(*)<>1)
        THEN 0 ELSE 1 END AS complete;`);
  const row = result.recordset?.[0];
  if (row?.cash_count !== snapshot.totals.cash || row.financial_count !== (snapshot.totals.financial ?? "0") ||
      row.stock_count !== snapshot.totals.stock || row.complete !== 1)
    throw fail("The staged recovery pages do not cover all receipt and stock identities.");
}

async function applyPagedRecovery(worker, transaction, context, snapshot, applyCash, assertCurrent, applyFinancial) {
  await verifyCoverage(transaction, snapshot);
  const previous = { cash: 0n, financial: 0n, stock: "" };
  async function* stagedRows(kind) {
    let after = "0";
    while (after !== snapshot.totals[kind]) {
      assertCurrent();
      assertSnapshotLive(snapshot);
      const result = await transaction.request().input("run", snapshot.runId).input("kind", kind).input("after", after)
        .query(`SELECT payload_json,payload_sha256 FROM ${PAGE_TABLE} WITH(HOLDLOCK)
          WHERE run_id=@run AND kind=@kind AND after_ordinal=CONVERT(bigint,@after);`);
      const row = result.recordset?.[0];
      const page = pageFor(decode(row?.payload_json, row?.payload_sha256, MAX_PAGE_BYTES), kind, after, snapshot);
      yield checkRows(page, snapshot, context.parseCash, previous);
      after = page.next;
    }
  }
  let stockChanged = 0;
  async function stock() {
    for await (const rows of stagedRows("stock")) {
      stockChanged += await applyGroupedStock(worker, transaction, context.branch, rows, context.extended
        ? { epoch: snapshot.epoch, seq: snapshot.seq, recovery: true } : {});
    }
  }
  if (!context.extended) {
    for await (const rows of stagedRows("cash")) {
      for (const row of rows) await applyCash(row.facts, row.seq);
    }
    await stock();
    return stockChanged;
  }

  // Stock is the pinned current state. Merge the two event streams by commit
  // sequence so an opening precedes its receipt and a correction follows it.
  await stock();
  async function* individualRows(kind) {
    for await (const rows of stagedRows(kind)) yield* rows;
  }
  const cash = individualRows("cash");
  const financial = individualRows("financial");
  let sale = await cash.next();
  let event = await financial.next();
  while (!sale.done || !event.done) {
    assertCurrent();
    const saleSeq = sale.done ? null : ordinal(sale.value.seq);
    const eventSeq = event.done ? null : ordinal(event.value.seq);
    if (saleSeq === eventSeq) throw fail("The recovery archives repeat a committed sequence.");
    if (eventSeq === null || (saleSeq !== null && saleSeq < eventSeq)) {
      await applyCash(sale.value.facts, sale.value.seq);
      sale = await cash.next();
    } else {
      await applyFinancial(event.value);
      event = await financial.next();
    }
  }
  return stockChanged;
}

module.exports = { RECOVERY, stagePagedRecovery, applyPagedRecovery };
