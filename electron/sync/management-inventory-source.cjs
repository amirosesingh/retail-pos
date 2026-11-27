const { verifyTables } = require('./verifier.cjs');
const { fail } = require('../db/stock-history-contract.cjs');
const { recordId } = require('./uuid-fields.cjs');

const inventoryTables = ['stores', 'products', 'stock_transfers', 'stock_transfer_items', 'pos_settings', 'settings_scoped'];
const retryDelay = 5 * 60_000;
const validGuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const tracked = inventoryTables.map(table => `CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(N'dbo.${table}')) IS NOT NULL`).join(' AND ');

function projectInventoryVerificationRow(table, row, branch) {
  if (table.cloudTable !== 'products') return row;
  const stock = typeof row.stock_by_store === 'string' ? JSON.parse(row.stock_by_store) : row.stock_by_store;
  if (stock == null) return { ...row, stock_by_store: {} };
  if (typeof stock !== 'object' || Array.isArray(stock)) fail('ESTOCK_HISTORY_MANAGEMENT_SOURCE');
  const quantity = Object.entries(stock).filter(([id]) => recordId(id) === branch).map(([, value]) => value);
  if (quantity.length > 1 || (quantity.length === 1 && !Number.isSafeInteger(quantity[0])))
    fail('ESTOCK_HISTORY_MANAGEMENT_SOURCE');
  return { ...row, stock_by_store: quantity.length ? { [branch]: quantity[0] } : {} };
}

async function physicalDatabase(pool) {
  const result = await pool.request().query(`
    SELECT LOWER(CONVERT(nvarchar(36),database_guid)) AS database_guid,
      CONVERT(varchar(20),CHANGE_TRACKING_CURRENT_VERSION()) AS version
    FROM sys.database_recovery_status WHERE database_id=DB_ID() AND ${tracked};`);
  const row = result.recordset?.[0];
  if (result.recordset?.length !== 1 || !validGuid.test(row?.database_guid) || !/^\d+$/.test(row?.version))
    fail('ESTOCK_HISTORY_MANAGEMENT_SOURCE');
  return row;
}

/** Establish current-stock provenance off the report read path and without holding the sync lease across network requests. */
function createManagementInventorySource({ manager, cloud, registry, ready, verify = verifyTables }) {
  let knownContext, active;
  const verified = new Map();
  const retry = new Map();
  const same = (source, next) => next?.pool === source.pool && manager.pool === source.pool &&
    next.fingerprint === source.fingerprint && next.stamp === source.stamp;
  function scope() {
    if (!ready()) return null;
    const source = cloud.verifiedManagementStockScope();
    if (!source || !knownContext || !same(knownContext, source)) {
      knownContext = source;
      verified.clear();
      retry.clear();
    }
    return source;
  }
  async function verifyNext() {
    if (active) return active;
    const source = scope();
    if (!source || source.branches.length > 500) return false;
    const branch = source.branches.find(id => !verified.has(id) && (retry.get(id) ?? 0) <= Date.now());
    if (!branch) return false;
    const deadline = Date.now() + 45_000;
    const assertSource = () => {
      if (Date.now() > deadline || !same(source, scope())) fail('ESTOCK_HISTORY_MANAGEMENT_SOURCE');
    };
    active = (async () => {
      try {
        assertSource();
        const before = await physicalDatabase(source.pool);
        const report = await verify({ connectionManager: manager, registry, cloud, branchId: branch, historyDays: 7300,
          tableNames: inventoryTables, assertSource, maxRows: 20_000, maxPages: 42, projectRow: projectInventoryVerificationRow });
        const after = await physicalDatabase(source.pool);
        assertSource();
        if (before.database_guid !== after.database_guid || before.version !== after.version || !report.verified ||
            !inventoryTables.every(name => report.tables.some(table => table.table === name && table.verified)))
          return false;
        verified.set(branch, after);
        return true;
      } finally {
        if (knownContext === source || (knownContext && same(source, knownContext))) retry.set(branch, Date.now() + retryDelay);
      }
    })().catch(() => false).finally(() => { active = null; });
    return active;
  }
  return { verifyNext, async assertVerified(source, branches) {
    if (!same(source, scope()) || !branches.length || branches.some(branch => !verified.has(branch)))
      fail('ESTOCK_HISTORY_MANAGEMENT_SOURCE');
    const actual = await physicalDatabase(source.pool);
    if (!same(source, scope()) || branches.some(branch => {
      const proof = verified.get(branch);
      return !proof || proof.database_guid !== actual.database_guid || BigInt(proof.version) > BigInt(actual.version);
    })) {
      verified.clear();
      fail('ESTOCK_HISTORY_MANAGEMENT_SOURCE');
    }
  } };
}

module.exports = { createManagementInventorySource, projectInventoryVerificationRow };
