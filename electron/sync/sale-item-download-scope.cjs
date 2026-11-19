"use strict";
const { recordId } = require("./uuid-fields.cjs");
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const fail = (code = "SYNC_BRANCH_FORBIDDEN") => {
  throw Object.assign(new Error(code === "ESYNC_DOWNLOAD_PARENT_MISSING"
    ? "A sale required by this download is unavailable. The page and saved work remain pending."
    : "The sale-item download does not match the verified branch. The page and saved work remain pending."), { code, table: "sale_items" });
};
const uuid = value => { const id = recordId(value); if (typeof id !== "string" || !UUID.test(id)) fail("ESYNC_ENTITY"); return id; };
const assigned = value => value != null && (typeof value !== "string" || value.trim() !== "");
function entityId(change) {
  let key;
  try { key = JSON.parse(change.entity_id); } catch { key = { id: change.entity_id }; }
  if (!key || typeof key !== "object" || Array.isArray(key) || Object.getPrototypeOf(key) !== Object.prototype ||
      Object.keys(key).length !== 1 || !Object.hasOwn(key, "id")) fail("ESYNC_ENTITY");
  const id = uuid(key?.id);
  if (change.row_data && uuid(change.row_data.id) !== id) fail("ESYNC_ENTITY");
  return id;
}

// Ordinary terminal feed only. Management's independently authorized replica
// path does not use this helper. A nullable legacy child label grants no scope:
// the locked sales parent is authoritative, including when products were moved.
async function assertSaleItemDownloadScope({ transaction, connectionManager, changes, branchId }) {
  if (!Array.isArray(changes) || changes.length > 2000) fail("ESYNC_ENTITY");
  if (!changes.length) return;
  const branch = recordId(branchId);
  if (typeof branch !== "string" || !branch || branch.length > 128 || branch !== branch.trim() || /[\u0000-\u001f\u007f]/.test(branch)) fail();
  if (!transaction || transaction.parent !== connectionManager.pool || typeof transaction.request !== "function") fail("ELOCAL_PENDING_UNVERIFIED");
  const identities = new Map();
  const requested = changes.map(change => {
    const id = entityId(change), tombstone = change.tombstone === true;
    if (assigned(change.row_data?.branch_id) && recordId(change.row_data.branch_id) !== branch) fail();
    const saleId = tombstone ? null : uuid(change.row_data?.sale_id), identity = JSON.stringify([saleId, tombstone]);
    if (identities.has(id) && identities.get(id) !== identity) fail();
    identities.set(id, identity);
    return { id, saleId, tombstone };
  });
  const result = await transaction.request().input("changes", JSON.stringify(requested)).query(`
    SELECT CASE WHEN @@TRANCOUNT>0 AND EXISTS(SELECT 1 FROM sys.dm_exec_sessions
      WHERE session_id=@@SPID AND transaction_isolation_level=4) THEN 1 ELSE 0 END ready;
    SELECT CONVERT(int,wanted.[key]) ordinal,
      CONVERT(varchar(36),parent.id) parent_id,parent.store_id parent_store,
      CONVERT(varchar(36),saved.id) existing_id,CONVERT(varchar(36),saved.sale_id) existing_sale_id,
      saved.branch_id existing_branch,CONVERT(varchar(36),saved_parent.id) existing_parent_id,
      saved_parent.store_id existing_parent_store
    FROM OPENJSON(@changes) wanted
    CROSS APPLY OPENJSON(wanted.value) WITH(id uniqueidentifier '$.id',sale_id uniqueidentifier '$.saleId') input
    LEFT JOIN dbo.sales parent WITH(UPDLOCK,HOLDLOCK) ON parent.id=input.sale_id
    LEFT JOIN dbo.sale_items saved WITH(UPDLOCK,HOLDLOCK) ON saved.id=input.id
    LEFT JOIN dbo.sales saved_parent WITH(UPDLOCK,HOLDLOCK) ON saved_parent.id=saved.sale_id
    ORDER BY CONVERT(int,wanted.[key]);`);
  const sets = result.recordsets;
  if (!Array.isArray(sets) || sets.length !== 2 || sets[0]?.length !== 1 || sets[0][0].ready !== 1 || sets[1]?.length !== requested.length) fail("ELOCAL_PENDING_UNVERIFIED");
  for (let index = 0; index < requested.length; index++) {
    const request = requested[index], row = sets[1][index];
    if (row.ordinal !== index) fail("ELOCAL_PENDING_UNVERIFIED");
    if (!request.tombstone) {
      if (!row.parent_id) fail("ESYNC_DOWNLOAD_PARENT_MISSING");
      if (recordId(row.parent_id) !== request.saleId || recordId(row.parent_store) !== branch) fail();
    }
    if (!row.existing_id) continue; // Serializable key-range lock makes absent tombstones harmless.
    if (recordId(row.existing_id) !== request.id || assigned(row.existing_branch) && recordId(row.existing_branch) !== branch) fail();
    if (!row.existing_parent_id) fail("ESYNC_DOWNLOAD_PARENT_MISSING");
    if (recordId(row.existing_parent_store) !== branch || recordId(row.existing_parent_id) !== recordId(row.existing_sale_id) ||
        !request.tombstone && recordId(row.existing_sale_id) !== request.saleId) fail();
  }
}
module.exports = { assertSaleItemDownloadScope };
