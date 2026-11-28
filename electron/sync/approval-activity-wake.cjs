const { boundedText } = require("./shift-recovery-exact.cjs");
const { recordId } = require("./uuid-fields.cjs");

const TABLE = "activity_events";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const RESPONSE_LIMIT = 512 * 1024;
const MAX_ROWS = 50;
const MIN_INTERVAL_MS = 1_500;
const PREFIX = {
  approval_requested: "approval-req-",
  approval_granted: "approval-decision-",
  approval_rejected: "approval-decision-",
  approval_expired: "approval-expired-",
};
const invalid = () => new Error("The scoped approval activity response was invalid.");

function rowsFrom(value, scope, table) {
  if (value?.ok !== true || value.protocol !== "native-approval-activity-v1" ||
      value.projectUrl !== scope.projectUrl || value.branchId !== scope.branchId ||
      !Array.isArray(value.rows) || value.rows.length > MAX_ROWS) throw invalid();
  const ids = new Set();
  const events = new Set();
  for (const row of value.rows) {
    if (!row || typeof row !== "object" || Array.isArray(row) || !UUID.test(row.id) || !UUID.test(row.entity_id) ||
        row.store_id !== scope.branchId || (row.branch_id !== null && row.branch_id !== scope.branchId) ||
        row.entity_type !== "authorization_request" || !Object.hasOwn(PREFIX, row.event_type) ||
        row.client_event_id !== PREFIX[row.event_type] + row.entity_id || ids.has(recordId(row.id)) ||
        events.has(row.client_event_id) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$/.test(row.created_at) ||
        !Number.isFinite(Date.parse(row.created_at))) throw invalid();
    ids.add(recordId(row.id));
    events.add(row.client_event_id);
    for (const column of table.columns) {
      const data = row[column.cloudColumn];
      if (data === null && column.nullable) continue;
      if (column.cloudColumn === "cleared_by") {
        if (!Array.isArray(data) || !data.every(item => typeof item === "string")) throw invalid();
      } else if (typeof data !== "string") throw invalid();
    }
    if (row.amount !== null && !/^-?(?:0|[1-9]\d{0,25})(?:\.\d{1,12})?$/.test(row.amount)) throw invalid();
    const meta = JSON.parse(row.meta);
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) throw invalid();
  }
  return value.rows;
}

async function insertMissing(transaction, table, rows, reader, scope) {
  // The local clear path acquires the activity row before its journal entry.
  const keys = await transaction.request().input("ids", JSON.stringify(rows.map(row => row.id)))
    .input("events", JSON.stringify(rows.map(row => row.client_event_id))).query(`
      SELECT id,client_event_id FROM dbo.activity_events WITH (UPDLOCK,HOLDLOCK)
      WHERE id IN (SELECT CONVERT(uniqueidentifier,[value]) FROM OPENJSON(@ids))
      UNION ALL
      SELECT id,client_event_id FROM dbo.activity_events WITH (UPDLOCK,HOLDLOCK)
      WHERE client_event_id IN (SELECT CONVERT(nvarchar(450),[value]) FROM OPENJSON(@events));`);
  const existingIds = new Set((keys.recordset ?? []).map(row => recordId(row.id)));
  const existingEvents = new Set((keys.recordset ?? []).map(row => row.client_event_id?.toLowerCase()));
  const missing = rows.filter(row => !existingIds.has(recordId(row.id)) && !existingEvents.has(row.client_event_id.toLowerCase()));
  const pending = await reader.unacknowledged(table, missing.map(row => JSON.stringify({ id: recordId(row.id) })), transaction);
  const protectedIds = new Set([...pending].map(id => id.toLowerCase()));
  let inserted = 0;
  const columns = table.columns.map(column => `[${column.sqlServerColumn}]`);
  const values = columns.map((_, index) => `@v${index}`);
  for (const row of missing) {
    if (protectedIds.has(JSON.stringify({ id: recordId(row.id) }))) continue;
    const request = transaction.request();
    table.columns.forEach((column, index) => {
      const value = row[column.cloudColumn];
      request.input(`v${index}`, column.cloudColumn === "cleared_by" ? JSON.stringify(value) : value);
    });
    const result = await request.input("eventId", row.id).input("clientEventId", row.client_event_id).query(`
      WITH CHANGE_TRACKING_CONTEXT (0x434C4F5544)
      INSERT dbo.activity_events (${columns.join(",")})
      SELECT ${values.join(",")}
      WHERE NOT EXISTS (SELECT 1 FROM dbo.activity_events WITH (UPDLOCK,HOLDLOCK)
        WHERE id=@eventId OR client_event_id=@clientEventId);`);
    inserted += result.rowsAffected?.[0] ?? 0;
  }
  scope.assertCurrent();
  return inserted;
}

/** One bounded notification catch-up shares the native coordinator lease. */
function createApprovalActivityWake({ capture, coordinator, manager, registry, reader, publish, runApply, fetchResponse = fetch }) {
  const table = registry.tables.find(table => table.cloudTable === TABLE && table.sqlServerTable === TABLE && table.scope === "branch");
  let inFlight = null;
  let lastStarted = 0;
  const skipped = { ok: false, skipped: true };
  return function wake() {
    const scope = capture();
    if (!table || !scope || coordinator.paused) return Promise.resolve(skipped);
    if (inFlight) {
      inFlight.pendingKey = scope.key;
      return inFlight.promise;
    }
    const job = { pendingKey: null };
    inFlight = job;
    job.promise = (async () => {
      const delay = Math.max(0, lastStarted + MIN_INTERVAL_MS - Date.now());
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      return coordinator.withExclusive(async () => {
        scope.assertCurrent();
        if (coordinator.paused) return skipped;
        lastStarted = Date.now();
        const response = await fetchResponse(`${scope.backendUrl}/api/v1/pos/activity-preferences`, {
          method: "POST", redirect: "error", cache: "no-store",
          headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(8_000),
          body: JSON.stringify({ action: "native_approval_wake", sessionToken: scope.sessionToken,
            terminalToken: scope.terminalToken, deviceBindingProof: scope.deviceBindingProof, projectUrl: scope.projectUrl }),
        });
        if (!response.ok) return skipped;
        const rows = rowsFrom(JSON.parse(await boundedText(response, RESPONSE_LIMIT)), scope, table);
        scope.assertCurrent();
        if (!rows.length) return { ok: true, inserted: 0 };
        return runApply(async () => {
          scope.assertCurrent();
          const sql = manager.sql();
          const transaction = new sql.Transaction(scope.pool);
          await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
          let inserted;
          try {
            inserted = await insertMissing(transaction, table, rows, reader, scope);
            await transaction.commit();
          } catch (error) {
            await Promise.resolve(transaction.rollback()).catch(() => undefined);
            throw error;
          }
          if (inserted) publish({ kind: "general", branchId: scope.branchId, source: "cloud", tables: [TABLE] });
          return { ok: true, inserted };
        });
      });
    })().catch(() => skipped).finally(() => {
      inFlight = null;
      if (job.pendingKey && capture()?.key === job.pendingKey) void wake();
    });
    return job.promise;
  };
}

module.exports = { createApprovalActivityWake };
