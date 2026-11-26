const { isDeepStrictEqual } = require("node:util");
const bcrypt = require("bcryptjs");
const { ACTIVE_CASHIER_FOR_STAFF } = require("../synced-staff-login.cjs");
const { staffReplicaEmail } = require("./cloud-client.cjs");
const { readDatabaseGuid } = require("./grouped-store-settings.cjs");
const { readPage } = require("./page-policy.cjs");
const { recordId } = require("./uuid-fields.cjs");
const { tagBootstrapDiagnostic } = require("../diagnostics.cjs");

const TABLE = "app_users";
const MAX_PAGES = 5;

async function readSavedStaff(request, scope) {
  const result = await request.input("id", scope.id).input("branch", scope.branchId).query(`
    SELECT a.user_id,a.store_id,a.is_active,a.email,a.row_version,a.role,a.role_slug,a.permissions,
      c.pin_hash cashier_pin_hash,c.store_id cashier_store_id
    FROM dbo.app_users a OUTER APPLY (${ACTIVE_CASHIER_FOR_STAFF}) c
    WHERE a.id=@id AND a.store_id=@branch;`);
  return result.recordset?.length === 1 ? result.recordset[0] : null;
}

function matchesStaff(row, scope) {
  return row?.is_active === true && recordId(row.store_id) === scope.branchId && row.user_id === scope.username;
}

function legacyStaff(row, scope) {
  return matchesStaff(row, scope) && row.email === staffReplicaEmail({ user_id: scope.username }) &&
    recordId(row.cashier_store_id) === scope.branchId &&
    typeof row.cashier_pin_hash === "string" && /^\$2[aby]\$(?:0[4-9]|1[0-2])\$[./A-Za-z0-9]{53}$/.test(row.cashier_pin_hash) &&
    Number.isSafeInteger(Number(row.row_version)) && Number(row.row_version) > 0;
}

function matchesHostedAuthority(row, scope) {
  return row.role === scope.role && row.role_slug === scope.roleSlug &&
    isDeepStrictEqual(row.permissions, scope.permissions);
}

async function readHostedStaff(cloud, scope) {
  let cursor = null;
  let size = 100;
  const seen = new Set();
  for (let page = 0; page < MAX_PAGES; page++) {
    const { batch, limit, nextLimit } = await readPage(pageLimit => {
      scope.assertCurrent();
      return cloud.bootstrapPage({ table: TABLE, branchId: scope.branchId, historyDays: 90, cursor, limit: pageLimit });
    }, size, { table: TABLE });
    scope.assertCurrent();
    if (!Array.isArray(batch?.rows) || batch.rows.length > Math.max(100, limit) ||
        (batch.cursor !== null && (typeof batch.cursor !== "string" || !batch.cursor || batch.cursor.length > 512 ||
          !batch.rows.length || seen.has(batch.cursor))))
      throw Object.assign(new Error("The offline staff download returned an invalid page."), { code: "EOFFLINE_STAFF_PAGE" });
    const matches = batch.rows.filter(row => recordId(row?.id) === scope.id);
    if (matches.length > 1)
      throw Object.assign(new Error("The offline staff download returned a duplicate account."), { code: "EOFFLINE_STAFF_PAGE" });
    if (matches.length === 1) return matches[0];
    if (batch.cursor === null) return null;
    cursor = batch.cursor;
    seen.add(cursor);
    size = nextLimit;
  }
  return null;
}

/** Repair only the retained account whose PIN Main just verified online. */
function createOfflineStaffRefresh({ cloud, manager, coordinator, registry, reader, runApply }) {
  const table = registry.tables.find(entry => entry.cloudTable === TABLE && entry.sqlServerTable === TABLE &&
    entry.scope === "branch" && entry.direction === "pull");
  return async function refresh(scope, pin) {
    if (!table || !scope || coordinator.paused) return false;
    scope.assertCurrent();
    const saved = await readSavedStaff(scope.pool.request(), scope);
    if (!legacyStaff(saved, scope)) return false;
    const databaseGuid = await readDatabaseGuid(scope.pool.request());
    const row = await readHostedStaff(cloud, scope).catch(error => {
      throw tagBootstrapDiagnostic(error, { table: TABLE, phase: "download" });
    });
    if (!matchesStaff(row, scope) || !matchesHostedAuthority(row, scope) ||
        !Number.isSafeInteger(row.row_version) || row.row_version < Number(saved.row_version) ||
        typeof row.pin_hash !== "string" || typeof row.offline_login_pin_hash !== "string")
      return false;
    const projectedEmail = staffReplicaEmail(row);
    if (!projectedEmail.endsWith("@pos-internal.local")) return false;
    const change = { entity_id: JSON.stringify({ id: scope.id }), row_data: row, tombstone: false };
    return coordinator.withExclusive(async () =>
      await runApply(async () => {
        scope.assertCurrent();
        if (coordinator.paused) return false;
        const sql = manager.sql();
        const transaction = new sql.Transaction(scope.pool);
        await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
        try {
          const current = await readSavedStaff(transaction.request(), scope);
          if (await readDatabaseGuid(transaction.request()) !== databaseGuid || !legacyStaff(current, scope) ||
              row.row_version < Number(current.row_version) ||
              (await reader.unacknowledged(table, [change.entity_id], transaction, {
                branchId: scope.branchId, changes: [change],
              })).size || !await bcrypt.compare(pin, current.cashier_pin_hash)) {
            await transaction.rollback();
            return false;
          }
          scope.assertCurrent();
          await cloud.applyLocalBatch(transaction, table, { rows: [change], tombstones: [] });
          const refreshed = await readSavedStaff(transaction.request(), scope);
          if (!matchesStaff(refreshed, scope) || refreshed.email !== projectedEmail ||
              Number(refreshed.row_version) !== row.row_version ||
              !matchesHostedAuthority({ ...refreshed, permissions: typeof refreshed.permissions === "string"
                ? JSON.parse(refreshed.permissions) : refreshed.permissions }, scope))
            throw Object.assign(new Error("The scoped offline staff update could not be verified."), { code: "EOFFLINE_STAFF_APPLY" });
          scope.assertCurrent();
          await transaction.commit();
          return true;
        } catch (error) {
          await Promise.resolve(transaction.rollback()).catch(() => undefined);
          throw tagBootstrapDiagnostic(error, { table: TABLE, phase: "local_apply" });
        }
      }) === true,
    );
  };
}

module.exports = { createOfflineStaffRefresh };
