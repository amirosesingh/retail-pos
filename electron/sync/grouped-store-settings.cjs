const { createHash } = require("node:crypto");
const { binding } = require("../verified-activation.cjs");
const { recordId } = require("./uuid-fields.cjs");
const { toLocalValue } = require("./row-codec.cjs");

const TABLE = "pos_store_settings";
const CHECKPOINT = "__grouped_store_settings_v1__";
const MIXED_PROJECTION = "settings_cash_v1";
const MIXED_CHECKPOINT = "__grouped_settings_cash_v1__";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_MIXED_MANIFEST_BYTES = 7 * 256 * 1024;
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

function httpsOrigin(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value;
  }
  catch { return false; }
}

function pilotEnrollment(value) {
  const fields = ["branchId", "terminalId", "backendOrigin", "projectOrigin", "databaseGuid"];
  if (value?.projection === MIXED_PROJECTION) fields.push("projection");
  if (value?.projection === MIXED_PROJECTION && value.recovery === "paged_stock_v1") fields.push("recovery");
  if (value?.recovery === "paged_stock_v1" && value?.extended === true) fields.push("extended");
  if (!hasKeys(value, fields) ||
      typeof value.branchId !== "string" || !value.branchId || value.branchId.length > 128 ||
      recordId(value.branchId) !== value.branchId || typeof value.terminalId !== "string" || !UUID.test(value.terminalId) ||
      typeof value.databaseGuid !== "string" || !UUID.test(value.databaseGuid) ||
      !httpsOrigin(value.backendOrigin) || !httpsOrigin(value.projectOrigin)) return null;
  return Object.freeze({ ...value });
}

function installedGroupedSettingsPilot(env) {
  const mode = env.POS_GROUPED_SETTINGS_PILOT_MODE;
  const input = env.POS_GROUPED_SETTINGS_PILOT_ENROLLMENT;
  if (!["run", "handback"].includes(mode) || typeof input !== "string" || input.length > 1024) return null;
  try {
    const enrollment = pilotEnrollment(JSON.parse(input));
    return enrollment && (!enrollment.projection || enrollment.extended === true)
      ? Object.freeze({ enrollment, mode }) : null;
  } catch { return null; }
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

function groupsFor(page, branch, table, position, limit, parseCash = null, extended = false) {
  const fields = ["status", "scope_id", "epoch", "next_seq", "upper_seq", "has_more", "groups"];
  if (extended && Object.hasOwn(page ?? {}, "sealed_seq")) {
    sequence(page.sealed_seq);
    fields.push("sealed_seq");
  }
  if (!hasKeys(page, fields) ||
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
    if (sequence(group?.seq) !== previous + 1n ||
        (group.operation_id !== null && (typeof group.operation_id !== "string" || !UUID.test(group.operation_id))) ||
        !Array.isArray(group.changes))
      throw fail("The grouped settings page contains an unsupported or incomplete group.");
    previous = BigInt(group.seq);
    if (extended && Object.hasOwn(group, "financial"))
      return { seq: group.seq, financial: require("./grouped-financial-corrections.cjs").parseFinancialCorrection(group, branch) };
    if (extended && group.changes[0]?.table_name === "products_stock")
      return { seq: group.seq, stock: [require("./grouped-live-stock.cjs").parseStockGroup(group)] };
    if (hasKeys(group, ["seq", "operation_id", "changes"]) && group.changes.length === 1)
      return { seq: group.seq, change: changeFor(group.changes[0], branch, table) };
    if (parseCash && extended) {
      const { stock, ...checkout } = group;
      const parsed = require("./grouped-live-stock.cjs").parseStockRow(stock);
      const cash = parseCash(checkout, position.epoch);
      if (parsed.product_id !== cash.rows[1]?.change.row_data.product_id)
        throw fail("The grouped checkout stock belongs to a different product.");
      return { seq: group.seq, cash, stock: [parsed] };
    }
    if (parseCash) return { seq: group.seq, cash: parseCash(group, position.epoch) };
    throw fail("The grouped settings page contains an unsupported or incomplete group.");
  });
  if (previous !== next) throw fail("The grouped settings page skipped a sequence.");
  return groups;
}

function readSnapshot(value, branch, table, mixed) {
  if (!hasKeys(value, ["status", "scope_id", "epoch", "seq", "pin_id", "expires_at", "manifest_json", "manifest_sha256"]) ||
      value.status !== "OK" || value.scope_id !== branch || typeof value.epoch !== "string" || !UUID.test(value.epoch) ||
      typeof value.pin_id !== "string" || !UUID.test(value.pin_id) || typeof value.expires_at !== "string" ||
      typeof value.manifest_json !== "string" ||
      Buffer.byteLength(value.manifest_json, "utf8") > (mixed ? MAX_MIXED_MANIFEST_BYTES : MAX_RESPONSE_BYTES) ||
      typeof value.manifest_sha256 !== "string" || !HASH.test(value.manifest_sha256) ||
      createHash("sha256").update(value.manifest_json, "utf8").digest("hex") !== value.manifest_sha256)
    throw fail("The grouped settings snapshot manifest does not match its scoped proof.");
  const expires = Date.parse(value.expires_at);
  if (!Number.isFinite(expires) || expires <= Date.now()) throw fail("The grouped settings snapshot pin expired.");
  sequence(value.seq);
  let manifest;
  try { manifest = JSON.parse(value.manifest_json); }
  catch { throw fail("The grouped settings snapshot manifest is malformed."); }
  const fields = ["scope_id", "epoch", "seq", "changes"];
  if (mixed) fields.push("cash_groups");
  if (!hasKeys(manifest, fields) || manifest.scope_id !== branch ||
      manifest.epoch !== value.epoch || manifest.seq !== value.seq ||
      !Array.isArray(manifest.changes) || manifest.changes.length !== 1)
    throw fail("The grouped settings snapshot must contain one complete row for its scope, epoch and sequence.");
  const snapshot = { epoch: value.epoch, seq: value.seq, expires, change: changeFor(manifest.changes[0], branch, table) };
  if (mixed && (!Array.isArray(manifest.cash_groups) || manifest.cash_groups.length > 100))
    throw fail("The mixed snapshot cannot prove its complete cash groups.");
  return { snapshot, cashGroups: manifest.cash_groups };
}

// For stale settings review only. Advancing a mixed position requires the
// separate snapshot parser and a successful atomic apply of every cash group.
function settingsFromSnapshot(value, branch, table, projection) {
  return readSnapshot(value, branch, table, projection === MIXED_PROJECTION).snapshot;
}

function snapshotFor(value, branch, table, parseCash = null) {
  const { snapshot, cashGroups } = readSnapshot(value, branch, table, Boolean(parseCash));
  if (!parseCash) return snapshot;
  let previous = 0n;
  const operations = new Set();
  const entities = new Set();
  snapshot.cash = cashGroups.map(group => {
    const current = sequence(group?.seq);
    if (current <= previous || current > BigInt(value.seq) || operations.has(group.operation_id))
      throw fail("The mixed snapshot contains a repeated or out-of-order cash group.");
    const facts = parseCash(group, value.epoch);
    for (const { table, change } of facts.rows) {
      const id = `${table.cloudTable}:${change.row_data.id}`;
      if (entities.has(id)) throw fail("The mixed snapshot repeats a cash receipt row.");
      entities.add(id);
    }
    operations.add(group.operation_id);
    previous = current;
    return facts;
  });
  return snapshot;
}

async function readDatabaseGuid(request) {
  const result = await request.query(`
    SELECT LOWER(CONVERT(nvarchar(36),database_guid)) AS database_guid
    FROM sys.database_recovery_status WHERE database_id=DB_ID();`);
  const guid = result.recordset?.[0]?.database_guid;
  if (result.recordset?.length !== 1 || typeof guid !== "string" || !UUID.test(guid))
    throw fail("The local database identity cannot be verified.", "ESYNC_GROUPED_DATABASE_UNVERIFIED");
  return guid;
}

function checkpointFor(projection) {
  return projection === MIXED_PROJECTION ? MIXED_CHECKPOINT : CHECKPOINT;
}

async function readPosition(request, { branch, source, databaseGuid, projection, checkpoint = checkpointFor(projection) }, locked = false) {
  const result = await request.input("branch", branch).input("entity", checkpoint).query(`
    SELECT committed_cursor FROM dbo.sync_checkpoints ${locked ? "WITH (UPDLOCK,HOLDLOCK)" : ""}
    WHERE organization_id=N'default' AND branch_id=@branch AND entity_type=@entity AND direction=N'pull';`);
  if (!result.recordset?.length) return null;
  let position;
  try { position = JSON.parse(result.recordset[0].committed_cursor); }
  catch { throw fail("The saved grouped settings position is invalid."); }
  const keys = ["source", "databaseGuid", "epoch", "seq", "upper"];
  if (position?.extended === true && projection === MIXED_PROJECTION) {
    keys.push("extended", "cashGeneration");
    if (Object.hasOwn(position, "sealedSeq")) {
      sequence(position.sealedSeq);
      keys.push("sealedSeq");
    }
    if (position.cashGeneration !== null && !UUID.test(position.cashGeneration ?? ""))
      throw fail("The saved grouped cash sender generation is invalid.");
  }
  if (result.recordset.length !== 1 || !hasKeys(position, keys) ||
      position.source !== source.fingerprint || typeof position.epoch !== "string" || !UUID.test(position.epoch) ||
      (position.upper !== null && sequence(position.upper) <= sequence(position.seq)))
    throw fail("The saved grouped settings position does not belong to this database and registration.");
  if (position.databaseGuid !== databaseGuid)
    throw fail("The saved grouped settings position belongs to a different SQL Server database.", "ESYNC_GROUPED_DATABASE_CHANGED");
  sequence(position.seq);
  return position;
}

async function readLocalRow(transaction, table, change, keyColumn, key) {
  const request = transaction.request().input("key", key);
  const expected = change.row_data;
  const comparisons = table.columns.filter(column => Object.hasOwn(expected, column.cloudColumn)).map((column, index) => {
    const field = `[${column.sqlServerColumn}]`;
    const parameter = `@value${index}`;
    const value = toLocalValue(column, expected[column.cloudColumn]);
    if (value === null) return `${field} IS NULL`;
    request.input(parameter.slice(1), value);
    if (column.sqlServerType.startsWith("nvarchar("))
      return `DATALENGTH(${field})=DATALENGTH(${parameter}) AND CONVERT(varbinary(max),${field})=CONVERT(varbinary(max),${parameter})`;
    return `${field}=CONVERT(${column.sqlServerType},${parameter})`;
  });
  const result = await request.query(`
    SELECT CASE WHEN ${comparisons.join(" AND ")} THEN 1 ELSE 0 END AS matching, row_version
    FROM dbo.[${table.sqlServerTable}] WITH (UPDLOCK,HOLDLOCK) WHERE [${keyColumn}]=@key;`);
  if (result.recordset?.length > 1) throw fail("The grouped local row key is ambiguous.");
  return result.recordset?.[0] ?? null;
}

async function assertLocalTracking(transaction, branch) {
  const result = await transaction.request().input("branch", branch).query(`
    DECLARE @baseline bigint=(SELECT change_tracking_version FROM dbo.sync_checkpoints WITH (HOLDLOCK)
      WHERE organization_id=N'default' AND branch_id=@branch AND entity_type=N'pos_store_settings' AND direction=N'push');
    DECLARE @minimum bigint=CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(N'dbo.pos_store_settings'));
    DECLARE @current bigint=CHANGE_TRACKING_CURRENT_VERSION();
    IF @baseline IS NULL OR @minimum IS NULL OR @current IS NULL OR @baseline<@minimum OR @baseline>@current
    BEGIN
      SELECT N'unverified' AS state;
      RETURN;
    END;
    DECLARE @pending bit=CASE WHEN EXISTS (
      SELECT 1 FROM CHANGETABLE(CHANGES dbo.pos_store_settings, @baseline) AS ct
      WHERE ct.store_id=@branch AND (ct.SYS_CHANGE_CONTEXT IS NULL OR ct.SYS_CHANGE_CONTEXT<>0x434C4F5544)
    ) THEN 1 ELSE 0 END;
    -- Retention cleanup can invalidate the baseline while CHANGETABLE scans it.
    SET @minimum = CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(N'dbo.pos_store_settings'));
    SELECT CASE WHEN @minimum IS NULL OR @baseline<@minimum THEN N'unverified'
      WHEN @pending=1 THEN N'pending' ELSE N'clear' END AS state;`);
  const state = result.recordset?.[0]?.state;
  if (state === "pending") throw fail("A local settings edit is still pending upload.", "ELOCAL_UPLOAD_PENDING");
  if (state !== "clear") throw fail("Local settings Change Tracking cannot prove the upload boundary.", "ELOCAL_PENDING_UNVERIFIED");
}

module.exports = {
  TABLE, CHECKPOINT, MIXED_PROJECTION, MIXED_CHECKPOINT, MAX_RESPONSE_BYTES, checkpointFor, fail, operationsScope, pilotEnrollment, installedGroupedSettingsPilot, snapshotRequired,
  groupsFor, snapshotFor, settingsFromSnapshot, readDatabaseGuid, readPosition, readLocalRow, assertLocalTracking,
};
