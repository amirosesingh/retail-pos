const { UUID } = require("../db/shift-intents.cjs");

const fields = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const fail = (message, code = "ESYNC_GROUPED_DRAWER_PROTOCOL") => Object.assign(new Error(message), { code, table: "drawer_events" });
const invalid = () => fail("The grouped drawer audit is outside the verified scope or shape.");
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$/;
const text = (value, min, max) => typeof value === "string" && value.length >= min && value.length <= max && !value.includes("\0");
const optionalText = value => value === null || text(value, 0, 1024);

function drawerStage(note) {
  if (note === "OPEN_REQUESTED") return "1";
  if (note === "OPENED" || (typeof note === "string" && note.startsWith("FAILED: "))) return "2";
  return null;
}

function parseDrawerAuditGroup(group, branch) {
  if (!fields(group, ["seq", "operation_id", "financial", "changes"]) ||
      !fields(group.financial, ["kind", "event_id"]) || group.financial.kind !== "drawer_v1" ||
      typeof group.seq !== "string" || !/^[1-9]\d{0,18}$/.test(group.seq) || BigInt(group.seq) > 9223372036854775807n ||
      !UUID.test(group.operation_id ?? "") || !Array.isArray(group.changes) || group.changes.length !== 1) throw invalid();
  const [change] = group.changes;
  const eventId = group.financial.event_id;
  if (typeof eventId !== "string" || !UUID.test(eventId) ||
      !fields(change, ["table_name", "entity_id", "row_data", "row_version", "tombstone"]) ||
      change.table_name !== "drawer_events" || change.tombstone !== false) throw invalid();
  const row = change.row_data;
  let key;
  try { key = JSON.parse(change.entity_id); } catch { throw invalid(); }
  if (!fields(key, ["id"]) || key.id !== eventId ||
      !fields(row, ["id", "store_id", "terminal_id", "shift_id", "staff_id", "staff_name", "role",
        "reason", "note", "approved_by", "created_at"]) ||
      row.id !== eventId || row.store_id !== branch || !text(branch, 1, 128) ||
      typeof row.terminal_id !== "string" || !UUID.test(row.terminal_id) ||
      (row.shift_id !== null && (typeof row.shift_id !== "string" || !UUID.test(row.shift_id))) ||
      ![row.staff_id, row.staff_name, row.role, row.approved_by].every(optionalText) ||
      !text(row.reason, 3, 400) || !text(row.note, 1, 308) ||
      !text(row.created_at, 1, 40) || !INSTANT.test(row.created_at) || !Number.isFinite(Date.parse(row.created_at)) ||
      !drawerStage(row.note) || change.row_version !== drawerStage(row.note)) throw invalid();
  return { kind: "drawer_v1", seq: group.seq, operationId: group.operation_id, eventId, branch, changes: group.changes, row };
}

async function applyDrawerAuditGroup(worker, transaction, context, facts) {
  const { branch } = context;
  const table = worker.registry.tables.find(entry => entry.cloudTable === "drawer_events" && entry.sqlServerTable === "drawer_events");
  if (facts.branch !== branch || !table) throw invalid();
  const id = facts.eventId;
  if ((await worker.reader.unacknowledged(table, [JSON.stringify({ id })], transaction, { branchId: branch })).size)
    throw fail("The original drawer audit is still pending upload.", "ELOCAL_UPLOAD_PENDING");
  const result = await transaction.request().input("branch", branch).input("id", id)
    .input("payload", JSON.stringify(facts.row)).query(`
      DECLARE @baseline bigint=(SELECT change_tracking_version FROM dbo.sync_checkpoints WITH(HOLDLOCK)
        WHERE organization_id=N'default' AND branch_id=@branch AND entity_type=N'drawer_events' AND direction=N'push');
      DECLARE @minimum bigint=CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(N'dbo.drawer_events'));
      IF @baseline IS NULL OR @minimum IS NULL OR @baseline<@minimum OR @baseline>CHANGE_TRACKING_CURRENT_VERSION()
      BEGIN SELECT N'unverified' AS state; RETURN; END;
      DECLARE @saved nvarchar(max),@present bit=0;
      SELECT @saved=note,@present=1 FROM dbo.drawer_events WITH(UPDLOCK,HOLDLOCK) WHERE id=@id;
      DECLARE @pending bit=CASE WHEN EXISTS(SELECT 1 FROM CHANGETABLE(CHANGES dbo.drawer_events,@baseline) AS ct
        WHERE ct.id=@id AND (ct.SYS_CHANGE_CONTEXT IS NULL OR ct.SYS_CHANGE_CONTEXT<>0x434C4F5544)) THEN 1 ELSE 0 END;
      SET @minimum=CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(N'dbo.drawer_events'));
      IF @minimum IS NULL OR @baseline<@minimum BEGIN SELECT N'unverified' AS state; RETURN; END;
      IF @pending=1 BEGIN SELECT N'pending' AS state; RETURN; END;
      DECLARE @incoming TABLE(terminal_id nvarchar(128),shift_id nvarchar(128),staff_id nvarchar(1024),
        staff_name nvarchar(1024),role nvarchar(1024),reason nvarchar(400),note nvarchar(308),
        approved_by nvarchar(1024),created_at datetimeoffset(7));
      INSERT @incoming SELECT terminal_id,shift_id,staff_id,staff_name,role,reason,note,approved_by,created_at
      FROM OPENJSON(@payload) WITH (terminal_id nvarchar(128),shift_id nvarchar(128),staff_id nvarchar(1024),
        staff_name nvarchar(1024),role nvarchar(1024),reason nvarchar(400),note nvarchar(308),
        approved_by nvarchar(1024),created_at datetimeoffset(7));
      DECLARE @note nvarchar(308)=(SELECT note FROM @incoming);
      IF @present=0
      BEGIN
        WITH CHANGE_TRACKING_CONTEXT (0x434C4F5544)
        INSERT dbo.drawer_events(id,store_id,terminal_id,shift_id,staff_id,staff_name,role,reason,note,approved_by,created_at)
        SELECT @id,@branch,terminal_id,shift_id,staff_id,staff_name,role,reason,note,approved_by,created_at FROM @incoming;
        SELECT N'applied' AS state,1 AS changed; RETURN;
      END;
      IF NOT EXISTS(SELECT 1 FROM dbo.drawer_events saved CROSS JOIN @incoming desired WHERE saved.id=@id
        AND saved.store_id COLLATE Latin1_General_100_BIN2=@branch COLLATE Latin1_General_100_BIN2
        AND saved.terminal_id COLLATE Latin1_General_100_BIN2 IS NOT DISTINCT FROM desired.terminal_id COLLATE Latin1_General_100_BIN2
        AND saved.shift_id COLLATE Latin1_General_100_BIN2 IS NOT DISTINCT FROM desired.shift_id COLLATE Latin1_General_100_BIN2
        AND saved.staff_id COLLATE Latin1_General_100_BIN2 IS NOT DISTINCT FROM desired.staff_id COLLATE Latin1_General_100_BIN2
        AND saved.staff_name COLLATE Latin1_General_100_BIN2 IS NOT DISTINCT FROM desired.staff_name COLLATE Latin1_General_100_BIN2
        AND saved.role COLLATE Latin1_General_100_BIN2 IS NOT DISTINCT FROM desired.role COLLATE Latin1_General_100_BIN2
        AND saved.reason COLLATE Latin1_General_100_BIN2 IS NOT DISTINCT FROM desired.reason COLLATE Latin1_General_100_BIN2
        AND saved.approved_by COLLATE Latin1_General_100_BIN2 IS NOT DISTINCT FROM desired.approved_by COLLATE Latin1_General_100_BIN2
        AND saved.created_at=desired.created_at)
      BEGIN SELECT N'review' AS state; RETURN; END;
      IF @saved COLLATE Latin1_General_100_BIN2=@note COLLATE Latin1_General_100_BIN2 OR
        (@note=N'OPEN_REQUESTED' AND (@saved COLLATE Latin1_General_100_BIN2=N'OPENED' OR
          @saved COLLATE Latin1_General_100_BIN2 LIKE N'FAILED: %'))
      BEGIN SELECT N'applied' AS state,0 AS changed; RETURN; END;
      IF @saved IS NULL OR @saved COLLATE Latin1_General_100_BIN2<>N'OPEN_REQUESTED'
      BEGIN SELECT N'review' AS state; RETURN; END;
      WITH CHANGE_TRACKING_CONTEXT (0x434C4F5544)
      UPDATE dbo.drawer_events SET note=@note WHERE id=@id;
      SELECT N'applied' AS state,1 AS changed;`);
  const state = result.recordset?.[0];
  if (state?.state === "pending") throw fail("The original drawer audit is still pending upload.", "ELOCAL_UPLOAD_PENDING");
  if (state?.state === "unverified") throw fail("The local drawer audit boundary cannot be verified.", "ELOCAL_PENDING_UNVERIFIED");
  if (state?.state !== "applied") throw fail("The saved drawer audit requires review.", "ESYNC_GROUPED_REVIEW_REQUIRED");
  return state.changed;
}

module.exports = { drawerStage, parseDrawerAuditGroup, applyDrawerAuditGroup };
