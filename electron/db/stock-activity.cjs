const { canonicalInstant, identifier, fail } = require('./stock-history-contract.cjs');

const keys = new Set(['branchId', 'cutoff', 'side', 'productId', 'cursor', 'limit']);
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const onSide = (occurredAt, cutoff, side) => side === 'through-cutoff' ? occurredAt <= cutoff : occurredAt > cutoff;

function activityRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.has(key)) ||
      Buffer.byteLength(JSON.stringify(value), 'utf8') > 4096) fail();
  const branchId = identifier(value.branchId), cutoff = canonicalInstant(value.cutoff), side = value.side;
  if (!['through-cutoff', 'after-cutoff'].includes(side) || /\p{Cc}/u.test(branchId)) fail();
  const productId = value.productId === undefined ? undefined : identifier(value.productId, true);
  const limit = value.limit === undefined ? 50 : value.limit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail();
  let cursor;
  if (value.cursor !== undefined) {
    if (!value.cursor || typeof value.cursor !== 'object' || Array.isArray(value.cursor) ||
        Object.keys(value.cursor).length !== 2 || !Object.hasOwn(value.cursor, 'occurredAt') || !Object.hasOwn(value.cursor, 'id')) fail();
    cursor = { occurredAt: canonicalInstant(value.cursor.occurredAt), id: identifier(value.cursor.id, true) };
    if (!onSide(cursor.occurredAt, cutoff, side)) fail();
  }
  return { branchId, cutoff, side, ...(productId ? { productId } : {}), cursor, limit };
}

function comparePosition(a, b) {
  if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

function units(value) {
  if (value == null) return null;
  if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) fail();
  return value;
}

function normalizeActivityRow(row, request) {
  const id = identifier(row.id, true), productId = identifier(row.product_id, true), branchId = identifier(row.store_id);
  const occurredAt = canonicalInstant(row.occurred_at);
  if (branchId !== request.branchId || (request.productId && productId !== request.productId) ||
      !onSide(occurredAt, request.cutoff, request.side) || typeof row.kind !== 'string' || !row.kind || row.kind.length > 80 ||
      (row.reference != null && typeof row.reference !== 'string') || (row.product_name != null && typeof row.product_name !== 'string')) fail();
  return { id, branchId, productId, occurredAt, kind: row.kind, reference: row.reference ?? null,
    ...(row.product_name ? { productName: row.product_name } : {}), delta: units(row.delta), before: units(row.before), after: units(row.after) };
}

function activityPage(request, result) {
  const records = new Map();
  const direction = request.side === 'through-cutoff' ? -1 : 1;
  if (!Array.isArray(result) || result.length > (request.limit + 1) * 2) fail();
  for (const raw of result) {
    const row = normalizeActivityRow(raw, request);
    if (request.cursor && direction * comparePosition(row, request.cursor) <= 0) fail();
    const previous = records.get(row.id);
    if (!previous) {
      records.set(row.id, row);
      continue;
    }
    if (previous.kind !== 'adjustment' || row.kind !== 'adjustment' || previous.productId !== row.productId ||
        previous.occurredAt !== row.occurredAt || previous.delta !== row.delta ||
        (previous.before !== null && row.before !== null && previous.before !== row.before) ||
        (previous.after !== null && row.after !== null && previous.after !== row.after)) fail();
    const productName = previous.productName ?? row.productName;
    records.set(row.id, { ...previous, reference: previous.reference ?? row.reference,
      ...(productName ? { productName } : {}),
      before: previous.before ?? row.before, after: previous.after ?? row.after });
  }
  const ordered = [...records.values()].sort((a, b) => direction * comparePosition(a, b));
  const rows = ordered.slice(0, request.limit), last = rows.at(-1);
  const { branchId, cutoff, side, productId } = request;
  return { branchId, cutoff, side, ...(productId ? { productId } : {}), rows,
    next: ordered.length > request.limit ? { occurredAt: last.occurredAt, id: last.id } : null };
}

/** Read from the registered SQL replica without requiring the verified-history tables. */
async function readStockActivity(pool, request) {
  const through = request.side === 'through-cutoff';
  const comparison = through ? '<' : '>', cutoffComparison = through ? '<=' : '>';
  const direction = through ? 'DESC' : 'ASC';
  const store = uuid.test(request.branchId) ? 'LOWER(source.store_id)' : 'source.store_id';
  const position = 'LOWER(CONVERT(char(36),source.id)) COLLATE Latin1_General_100_BIN2';
  const fields = `TOP (@page_size) ${position} AS id, LOWER(CONVERT(char(36),source.product_id)) AS product_id,
    source.store_id, LEFT(source.product_name,300) AS product_name,
    CONVERT(varchar(27),CONVERT(datetime2(7),SWITCHOFFSET(source.created_at,'+00:00')),126)+'Z' AS occurred_at`;
  const filter = `WHERE ${store} COLLATE Latin1_General_100_BIN2 = @branch_id COLLATE Latin1_General_100_BIN2
    AND DATALENGTH(source.store_id) = DATALENGTH(@branch_id)
    AND source.product_id IS NOT NULL AND (@product IS NULL OR source.product_id = @product)
    AND source.created_at ${cutoffComparison} @cutoff
    AND (@cursor_time IS NULL OR source.created_at ${comparison} @cursor_time OR
      (source.created_at = @cursor_time AND ${position} ${comparison} @cursor_id COLLATE Latin1_General_100_BIN2))
    ORDER BY source.created_at ${direction}, ${position} ${direction}`;
  const result = await pool.request()
    .input('branch_id', request.branchId).input('product_id', request.productId ?? null).input('page_size', request.limit + 1)
    .input('cutoff_raw', request.cutoff).input('cursor_raw', request.cursor?.occurredAt ?? null).input('cursor_id', request.cursor?.id ?? null)
    .query(`DECLARE @cutoff datetimeoffset(7) = CONVERT(datetimeoffset(7), @cutoff_raw, 127);
      DECLARE @cursor_time datetimeoffset(7) = CONVERT(datetimeoffset(7), @cursor_raw, 127);
      DECLARE @product uniqueidentifier = CONVERT(uniqueidentifier, @product_id);
      WITH inventory_activity AS (
        SELECT ${fields}, source.activity_type AS kind, LEFT(source.reference,240) AS reference,
          source.quantity_delta AS delta, source.stock_before AS [before], source.stock_after AS [after]
        FROM dbo.item_activity_logs source ${filter}
      ), adjustments AS (
        SELECT ${fields}, N'adjustment' AS kind, CONVERT(nvarchar(240),NULL) AS reference,
          source.delta, source.previous_stock AS [before], source.updated_stock AS [after]
        FROM dbo.stock_adjustments source ${filter}
      )
      SELECT * FROM inventory_activity UNION ALL SELECT * FROM adjustments;`);
  return activityPage(request, result.recordset);
}

module.exports = { activityPage, activityRequest, readStockActivity };
