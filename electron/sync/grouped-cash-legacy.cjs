const grouped = require("./grouped-store-settings.cjs");
const { recordId } = require("./uuid-fields.cjs");

const tables = new Map([
  ["sales", "store_id"], ["sale_items", "branch_id"],
  ["payment_transactions", "store_id"], ["item_activity_logs", "store_id"],
  ["stock_delta_applied", "store_id"],
]);
const ledger = "stock_delta_applied";
const receiptTable = (table, extended) => tables.has(table) && (table !== ledger || extended);
const rowKey = table => table === ledger ? "movement_id" : "id";
const uuid = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const seq = /^(0|[1-9][0-9]{0,18})$/;
const max = 9223372036854775807n;
const permits = new WeakMap();
const fail = () => grouped.fail("This receipt download has no verified mixed feed coverage.", "ESYNC_CASH_LEGACY_COVERAGE");
const held = () => grouped.fail("Legacy receipt download is waiting for the grouped checkout.", "ELOCAL_UPLOAD_PENDING");
const changes = batch => [...(batch.rows ?? []), ...(batch.tombstones ?? [])];
const keyOf = ({ table_name, id, version }) => JSON.stringify([table_name, id, version ?? null]);
const sequence = value => typeof value === "string" && seq.test(value) && BigInt(value) <= max;

function entryFor(change, branch, extended) {
  let entity;
  try { entity = JSON.parse(change.entity_id); } catch { throw fail(); }
  const field = rowKey(change.table_name);
  const id = recordId(entity?.[field]);
  if (!entity || Object.keys(entity).length !== 1 || !uuid.test(id) ||
      (change.tombstone !== true && (recordId(change.row_data?.[field]) !== id ||
        recordId(change.row_data?.[tables.get(change.table_name)]) !== branch))) throw fail();
  if (!extended) return { table_name: change.table_name, id };
  const version = change.tombstone === true ? null : String(change.row_data?.row_version ??
    (change.table_name === ledger ? 1 : change.row_version));
  if (version !== null && !/^[1-9]\d{0,9}$/.test(version)) throw fail();
  return { table_name: change.table_name, id, version };
}

async function prepareLegacyCashPage(cloud, source, context, batch) {
  const cashRows = changes(batch).filter(change => receiptTable(change.table_name, context.extended));
  if (!cashRows.length || context.projection !== grouped.MIXED_PROJECTION) return null;
  const position = await grouped.readPosition(source.pool.request(), context);
  if (!position && !context.extended) return { batch, position: null };
  const candidates = new Map(cashRows.map(change => {
    const entry = entryFor(change, context.branch, context.extended);
    return [keyOf(entry), entry];
  }));
  const result = await cloud.cashLegacyCoverage(source, position?.epoch ?? null, [...candidates.values()], context.extended);
  cloud.assertRequestContext(source, false);
  if (result?.status !== "OK" || result.scope_id !== context.branch || !uuid.test(result.epoch ?? "") ||
      (position && result.epoch !== position.epoch) ||
      !Array.isArray(result.entries) || result.entries.length > candidates.size) throw fail();
  const owners = new Map();
  for (const entry of result.entries) {
    const key = keyOf(entry ?? {});
    if (!candidates.has(key) || owners.has(key) || !sequence(entry.seq) || entry.seq === "0" ||
        (context.extended && typeof entry.owned !== "boolean")) throw fail();
    owners.set(key, { seq: BigInt(entry.seq), owned: entry.owned });
  }
  return { batch, position, owners };
}

function allowCashApply(transaction, accepted) {
  const permitted = permits.get(transaction) ?? new Set();
  for (const change of accepted) permitted.add(change);
  permits.set(transaction, permitted);
}

async function applyLegacyCashCoverage(transaction, context, batch, proof) {
  if (!proof) return batch;
  if (batch !== proof.batch) throw fail();
  const position = await grouped.readPosition(transaction.request(), context, true);
  if (!proof.position) {
    if (!context.extended || position || proof.owners.size) throw held();
    allowCashApply(transaction, changes(batch).filter(change => receiptTable(change.table_name, true)));
    return batch;
  }
  if (!position || position.epoch !== proof.position.epoch ||
      position.extended !== proof.position.extended || BigInt(position.seq) < BigInt(proof.position.seq)) throw fail();
  const skip = new Set();
  const apply = [];
  for (const change of changes(batch)) {
    if (!receiptTable(change.table_name, context.extended)) continue;
    const owner = proof.owners.get(keyOf(entryFor(change, context.branch, context.extended)));
    if (owner !== undefined) {
      if (context.extended) {
        // Check the current row projection, not the older event's version.
        // Once the legacy cursor advances, every skipped row must already be
        // committed by its grouped owner on this SQL Server.
        if (BigInt(position.seq) < owner.seq) throw held();
        if (owner.owned && change.tombstone === false) { skip.add(change); continue; }
      }
      const original = change.tombstone === false && String(change.row_version) === "1" &&
        String(change.row_data?.row_version) === "1";
      if (!context.extended && original) { skip.add(change); continue; }
      // Legacy feed reads the current row for older cursor entries. Do not
      // discard a correction, or let it reach SQL Server before its birth.
      if (BigInt(position.seq) < owner.seq) throw held();
    }
    apply.push(change);
  }
  allowCashApply(transaction, apply);
  return skip.size ? { ...batch, rows: batch.rows.filter(change => !skip.has(change)) } : batch;
}

async function assertCashDownload(transaction, tableName, batch) {
  const branchColumn = tables.get(tableName);
  if (!branchColumn) return;
  const permitted = permits.get(transaction);
  const pending = changes(batch).filter(change => !permitted?.has(change));
  if (!pending.length) return;
  const result = await transaction.request().input("checkpoint", grouped.MIXED_CHECKPOINT).query(`
    SELECT branch_id,committed_cursor FROM dbo.sync_checkpoints WITH (UPDLOCK,HOLDLOCK)
    WHERE organization_id=N'default' AND entity_type=@checkpoint AND direction=N'pull';`);
  const fenced = new Set((result.recordset ?? []).filter(row => {
    if (tableName !== ledger) return true;
    try { return JSON.parse(row.committed_cursor)?.extended === true; } catch { throw fail(); }
  }).map(row => recordId(row.branch_id)));
  if (!fenced.size) return;
  for (const change of pending) {
    const branch = recordId(change.row_data?.[branchColumn] ?? batch.branchId);
    if (fenced.has(branch)) throw fail();
    let id;
    const field = rowKey(tableName);
    try { id = recordId(change.row_data?.[field] ?? JSON.parse(change.entity_id)[field]); }
    catch { throw fail(); }
    if (!uuid.test(id)) throw fail();
    const local = await transaction.request().input("id", id).query(`
      SELECT [${branchColumn}] AS branch FROM dbo.[${tableName}] WITH (HOLDLOCK)
      WHERE [${field}]=TRY_CONVERT(uniqueidentifier,@id);`);
    if (fenced.has(recordId(local.recordset?.[0]?.branch))) throw fail();
  }
}

module.exports = { prepareLegacyCashPage, applyLegacyCashCoverage, allowCashApply, assertCashDownload };
