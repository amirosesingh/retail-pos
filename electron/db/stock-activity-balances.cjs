const { canonicalInstant, identifier, fail } = require('./stock-history-contract.cjs');
const { activityPage } = require('./stock-activity.cjs');

const keys = new Set(['branchId', 'cutoff', 'productIds']);
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const throughLimit = 3, afterLimit = 2;
const throughReadLimit = throughLimit + 1;

function activityBalancesRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !keys.has(key)) ||
      !Array.isArray(value.productIds) || value.productIds.length < 1 || value.productIds.length > 50) fail();
  const branchId = identifier(value.branchId), cutoff = canonicalInstant(value.cutoff);
  if (/\p{Cc}/u.test(branchId)) fail();
  const productIds = Array.from(value.productIds, productId => identifier(productId, true));
  if (new Set(productIds).size !== productIds.length) fail();
  return { branchId, cutoff, productIds };
}

/** Bounded recorded evidence from the local replica for one report page. */
async function readStockActivityBalances(pool, input) {
  const request = activityBalancesRequest(input);
  const { branchId, cutoff, productIds } = request;
  const store = uuid.test(branchId) ? 'LOWER(source.store_id)' : 'source.store_id';
  const position = 'LOWER(CONVERT(char(36),source.id)) COLLATE Latin1_General_100_BIN2';
  const scope = `INNER JOIN selected_product selected ON selected.id=source.product_id
    WHERE ${store} COLLATE Latin1_General_100_BIN2=@branch_id COLLATE Latin1_General_100_BIN2
      AND DATALENGTH(source.store_id)=DATALENGTH(@branch_id)`;
  // Rank just the requested products in one read per source. These legacy
  // relations have store indexes, so a per-product query can repeat large scans.
  const result = await pool.request()
    .input('branch_id', branchId).input('cutoff_raw', cutoff).input('products_json', JSON.stringify(productIds))
    .input('through_limit', throughReadLimit).input('after_limit', afterLimit)
    .query(`DECLARE @cutoff datetimeoffset(7)=CONVERT(datetimeoffset(7),@cutoff_raw,127);
      WITH selected_product AS (
        SELECT CONVERT(uniqueidentifier,value) id FROM OPENJSON(@products_json)
      ), candidates AS (
        SELECT 0 source_key,${position} id,source.product_id,source.store_id,source.created_at,
          CONVERT(nvarchar(300),LEFT(source.product_name,300)) product_name,source.activity_type kind,
          CONVERT(nvarchar(240),LEFT(source.reference,240)) reference,
          source.quantity_delta delta,source.stock_before [before],source.stock_after [after]
        FROM dbo.item_activity_logs source ${scope}
        UNION ALL
        SELECT 1,${position},source.product_id,source.store_id,source.created_at,
          CONVERT(nvarchar(300),LEFT(source.product_name,300)),N'adjustment',NULL,
          source.delta,source.previous_stock,source.updated_stock
        FROM dbo.stock_adjustments source ${scope}
      ), sides AS (
        SELECT *,CASE WHEN created_at<=@cutoff THEN 0 ELSE 1 END side_key FROM candidates
      ), bounded AS (
        SELECT *,ROW_NUMBER() OVER (PARTITION BY source_key,product_id,side_key ORDER BY
          CASE WHEN side_key=0 THEN created_at END DESC,CASE WHEN side_key=0 THEN id END DESC,
          CASE WHEN side_key=1 THEN created_at END ASC,CASE WHEN side_key=1 THEN id END ASC) position_number
        FROM sides
      )
      SELECT source_key,side_key,id,LOWER(CONVERT(char(36),product_id)) product_id,store_id,
        CONVERT(varchar(27),CONVERT(datetime2(7),SWITCHOFFSET(created_at,'+00:00')),126)+'Z' occurred_at,
        product_name,kind,reference,delta,[before],[after]
      FROM bounded WHERE position_number<=CASE WHEN side_key=0 THEN @through_limit ELSE @after_limit END
      ORDER BY source_key,product_id,side_key,position_number;`);

  const byProduct = new Map(productIds.map(productId => [productId, [[], []]]));
  const positions = new Map();
  if (!Array.isArray(result.recordset) || result.recordset.length > productIds.length * 2 * (throughReadLimit + afterLimit)) fail();
  for (const row of result.recordset) {
    const productId = identifier(row.product_id, true), id = identifier(row.id, true);
    if (!byProduct.has(productId) || (row.source_key !== 0 && row.source_key !== 1) ||
        (row.side_key !== 0 && row.side_key !== 1)) fail();
    const existing = positions.get(id);
    if (existing && (existing.productId !== productId || existing.side !== row.side_key)) fail();
    positions.set(id, { productId, side: row.side_key });
    const rows = byProduct.get(productId)[row.side_key];
    const limit = row.side_key === 0 ? throughReadLimit : afterLimit;
    if (rows.filter(value => value.source_key === row.source_key).length >= limit) fail();
    rows.push(row);
  }
  const products = productIds.map(productId => {
    const [through, after] = byProduct.get(productId);
    const throughRows = activityPage({ branchId, cutoff, productId, side: 'through-cutoff', limit: throughReadLimit * 2 }, through).rows;
    const afterRows = activityPage({ branchId, cutoff, productId, side: 'after-cutoff', limit: afterLimit * 2 }, after).rows;
    // The extra row detects whether a source was cut short. A timestamp
    // shared with its oldest retained row cannot prove contiguous coverage.
    let boundary;
    for (const source of [0, 1]) {
      const times = through.filter(row => row.source_key === source)
        .map(row => canonicalInstant(row.occurred_at)).sort().reverse();
      if (times.length < throughReadLimit) continue;
      const oldest = times[throughLimit - 1];
      if (!boundary || oldest > boundary) boundary = oldest;
    }
    return { productId,
      through: boundary ? throughRows.filter(row => row.occurredAt > boundary) : throughRows,
      after: afterRows };
  });
  return { branchId, cutoff, products };
}

module.exports = { activityBalancesRequest, readStockActivityBalances };
