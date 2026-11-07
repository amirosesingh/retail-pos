const { createHash } = require("node:crypto");
const { binding } = require("../verified-activation.cjs");
const { recordId } = require("./uuid-fields.cjs");

const TABLE = "pos_store_settings";
const CHECKPOINT = "__grouped_store_settings_v1__";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_SEQ = 9223372036854775807n;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{7}Z$/;
const SNAPSHOT_REASONS = new Set(["EPOCH_MISMATCH", "REPLAY_EXPIRED", "FEED_GAP", "GROUP_TOO_LARGE"]);
const fail = (message, code = "ESYNC_GROUPED_PROTOCOL") => Object.assign(new Error(message), { code, table: TABLE });

function hasKeys(value, keys) {
  return value != null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function sequence(value) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,18})$/.test(value) || BigInt(value) > MAX_SEQ)
    throw fail("The grouped settings sequence is invalid.");
  return BigInt(value);
}

function operationsScope(source) {
  const terminal = binding(source.terminal);
  const branch = terminal?.branchId;
  if (terminal?.mode !== "operations" || terminal.platform !== "pc" || !branch || branch.length > 128 ||
      !HASH.test(source.terminal.deviceBindingProof ?? "") || !source.pool || !source.profile ||
      typeof source.project?.projectOrigin !== "string" || !/^https:\/\/[^/]+/i.test(source.project.projectOrigin) ||
      recordId(source.project.branchId) !== branch)
    throw fail("The grouped settings feed requires the registered Operations PC and its configured database.", "ESYNC_GROUPED_SCOPE");
  return branch;
}

function snapshotRequired(value) {
  return hasKeys(value, ["status", "reason"]) && value.status === "SNAPSHOT_REQUIRED" && SNAPSHOT_REASONS.has(value.reason);
}

function changeFor(value, branch, table) {
  const row = value?.row_data;
  let key;
  try { key = JSON.parse(value?.entity_id); }
  catch { throw fail("The grouped settings row has an invalid key."); }
  if (!hasKeys(value, ["table_name", "entity_id", "row_data", "row_version", "tombstone"]) ||
      value.table_name !== TABLE || value.tombstone !== false || typeof value.entity_id !== "string" ||
      !hasKeys(key, ["store_id"]) || key.store_id !== branch ||
      !hasKeys(row, table.columns.map(column => column.cloudColumn)) || row.store_id !== branch ||
      value.row_version !== row.row_version || sequence(value.row_version) < 1n || BigInt(value.row_version) > 2147483647n)
    throw fail("The grouped settings row does not match its complete branch projection.");

  for (const column of table.columns) {
    const field = column.cloudColumn;
    const data = row[field];
    if (data === null && column.nullable) continue;
    const type = column.sqlServerType;
    const valid = field === "row_version" ||
      (type === "bit" && typeof data === "boolean") ||
      (type === "int" && Number.isInteger(data) && data >= -2147483648 && data <= 2147483647) ||
      (type === "decimal(38,12)" && typeof data === "string" && /^-?(?:0|[1-9]\d{0,25})(?:\.\d{1,12})?$/.test(data)) ||
      (type === "datetimeoffset(7)" && typeof data === "string" && UTC_INSTANT.test(data) && Number.isFinite(Date.parse(data))) ||
      (/^nvarchar\(/.test(type) && typeof data === "string" && !data.includes("\0"));
    if (!valid) throw fail("The grouped settings row contains an invalid native value.");
  }
  return { ...value, entity_id: JSON.stringify(key), row_data: { ...row, row_version: Number(value.row_version) } };
}

function groupsFor(page, branch, table, position, limit) {
  if (!hasKeys(page, ["status", "scope_id", "epoch", "next_seq", "upper_seq", "has_more", "groups"]) ||
      page.status !== "OK" || page.scope_id !== branch || page.epoch !== position.epoch ||
      !Array.isArray(page.groups) || page.groups.length > limit ||
      (position.upper !== null && page.upper_seq !== position.upper))
    throw fail("The grouped settings page does not match its requested scope and epoch.");

  const next = sequence(page.next_seq);
  const upper = sequence(page.upper_seq);
  let previous = sequence(position.seq);
  if (previous > next || next > upper || page.has_more !== (next < upper) || (page.has_more && !page.groups.length))
    throw fail("The grouped settings page did not advance safely.");

  const groups = page.groups.map(group => {
    if (!hasKeys(group, ["seq", "operation_id", "changes"]) || sequence(group.seq) !== previous + 1n ||
        (group.operation_id !== null && (typeof group.operation_id !== "string" || !UUID.test(group.operation_id))) ||
        !Array.isArray(group.changes) || group.changes.length !== 1)
      throw fail("The grouped settings page contains an unsupported or incomplete group.");
    previous = BigInt(group.seq);
    return { seq: group.seq, change: changeFor(group.changes[0], branch, table) };
  });
  if (previous !== next) throw fail("The grouped settings page skipped a sequence.");
  return groups;
}

function snapshotFor(value, branch, table) {
  if (!hasKeys(value, ["status", "scope_id", "epoch", "seq", "pin_id", "expires_at", "manifest_json", "manifest_sha256"]) ||
      value.status !== "OK" || value.scope_id !== branch || typeof value.epoch !== "string" || !UUID.test(value.epoch) ||
      typeof value.pin_id !== "string" || !UUID.test(value.pin_id) || typeof value.expires_at !== "string" ||
      typeof value.manifest_json !== "string" || Buffer.byteLength(value.manifest_json, "utf8") > MAX_RESPONSE_BYTES ||
      typeof value.manifest_sha256 !== "string" || !HASH.test(value.manifest_sha256) ||
      createHash("sha256").update(value.manifest_json, "utf8").digest("hex") !== value.manifest_sha256)
    throw fail("The grouped settings snapshot manifest does not match its scoped proof.");
  const expires = Date.parse(value.expires_at);
  if (!Number.isFinite(expires) || expires <= Date.now()) throw fail("The grouped settings snapshot pin expired.");
  sequence(value.seq);
  let manifest;
  try { manifest = JSON.parse(value.manifest_json); }
  catch { throw fail("The grouped settings snapshot manifest is malformed."); }
  if (!hasKeys(manifest, ["scope_id", "epoch", "seq", "changes"]) || manifest.scope_id !== branch ||
      manifest.epoch !== value.epoch || manifest.seq !== value.seq ||
      !Array.isArray(manifest.changes) || manifest.changes.length > 1)
    throw fail("The grouped settings snapshot does not match its scope, epoch or sequence.");
  return { epoch: value.epoch, seq: value.seq, expires, change: manifest.changes.length ? changeFor(manifest.changes[0], branch, table) : null };
}

async function readPosition(request, branch, source, locked = false) {
  const result = await request.input("branch", branch).input("entity", CHECKPOINT).query(`
    SELECT committed_cursor FROM dbo.sync_checkpoints ${locked ? "WITH (UPDLOCK,HOLDLOCK)" : ""}
    WHERE organization_id=N'default' AND branch_id=@branch AND entity_type=@entity AND direction=N'pull';`);
  if (!result.recordset?.length) return null;
  let position;
  try { position = JSON.parse(result.recordset[0].committed_cursor); }
  catch { throw fail("The saved grouped settings position is invalid."); }
  if (result.recordset.length !== 1 || !hasKeys(position, ["source", "epoch", "seq", "upper"]) ||
      position.source !== source || typeof position.epoch !== "string" || !UUID.test(position.epoch) ||
      (position.upper !== null && sequence(position.upper) <= sequence(position.seq)))
    throw fail("The saved grouped settings position does not belong to this database and registration.");
  sequence(position.seq);
  return position;
}

async function readLocalRow(transaction, branch, table, change) {
  const request = transaction.request().input("branch", branch);
  const expected = change?.row_data;
  const comparisons = expected ? table.columns.map((column, index) => {
    const field = `[${column.sqlServerColumn}]`;
    const parameter = `@value${index}`;
    const value = expected[column.cloudColumn];
    if (value === null) return `${field} IS NULL`;
    request.input(parameter.slice(1), value);
    if (column.sqlServerType.startsWith("nvarchar("))
      return `DATALENGTH(${field})=DATALENGTH(${parameter}) AND CONVERT(varbinary(max),${field})=CONVERT(varbinary(max),${parameter})`;
    return `${field}=CONVERT(${column.sqlServerType},${parameter})`;
  }) : [];
  const result = await request.query(`
    SELECT CASE WHEN ${comparisons.join(" AND ") || "1=0"} THEN 1 ELSE 0 END AS matching
    FROM dbo.pos_store_settings WITH (UPDLOCK,HOLDLOCK) WHERE store_id=@branch;`);
  if (result.recordset?.length > 1) throw fail("The local settings key is ambiguous.");
  return result.recordset?.[0] ?? null;
}

async function assertLocalTracking(transaction, branch) {
  const result = await transaction.request().input("branch", branch).query(`
    DECLARE @baseline bigint=(SELECT change_tracking_version FROM dbo.sync_checkpoints WITH (HOLDLOCK)
      WHERE organization_id=N'default' AND branch_id=@branch AND entity_type=N'pos_store_settings' AND direction=N'push');
    DECLARE @minimum bigint=CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(N'dbo.pos_store_settings'));
    DECLARE @current bigint=CHANGE_TRACKING_CURRENT_VERSION();
    IF @baseline IS NULL OR @minimum IS NULL OR @current IS NULL OR @baseline<@minimum OR @baseline>@current
      SELECT N'unverified' AS state;
    ELSE IF EXISTS (SELECT 1 FROM CHANGETABLE(CHANGES dbo.pos_store_settings, @baseline) AS ct
      WHERE ct.store_id=@branch AND (ct.SYS_CHANGE_CONTEXT IS NULL OR ct.SYS_CHANGE_CONTEXT<>0x434C4F5544))
      SELECT N'pending' AS state;
    ELSE SELECT N'clear' AS state;`);
  const state = result.recordset?.[0]?.state;
  if (state === "pending") throw fail("A local settings edit is still pending upload.", "ELOCAL_UPLOAD_PENDING");
  if (state !== "clear") throw fail("Local settings Change Tracking cannot prove the upload boundary.", "ELOCAL_PENDING_UNVERIFIED");
}

module.exports = {
  TABLE, CHECKPOINT, MAX_RESPONSE_BYTES, fail, operationsScope, snapshotRequired,
  groupsFor, snapshotFor, readPosition, readLocalRow, assertLocalTracking,
};
