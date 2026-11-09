const { createHash } = require("node:crypto");
const { UUID, validateGraph, ShiftIntentStore } = require("../db/shift-intents.cjs");
const { applyShiftGraphs } = require("./shift-graph.cjs");
const { rememberGraph, exactGraph, exactRows, projection, instant } = require("./shift-recovery-exact.cjs");
const { validateCoverage } = require("./shift-coverage.cjs");
const { recordId } = require("./uuid-fields.cjs");

const fields = (value, keys) => value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const fail = (message, code = "ESYNC_GROUPED_SHIFT_PROTOCOL") => Object.assign(new Error(message), { code, table: "shifts" });
const invalid = () => fail("The grouped managed shift is outside the verified closing scope or shape.");

function parseManagedShiftGroup(group, branch) {
  if (!fields(group, ["seq", "operation_id", "financial", "changes"]) ||
      !fields(group.financial, ["kind", "shift_id"]) || group.financial.kind !== "shift_v1" ||
      typeof group.seq !== "string" || !/^[1-9]\d{0,18}$/.test(group.seq) || BigInt(group.seq)>9223372036854775807n ||
      !UUID.test(group.operation_id ?? "") || !Array.isArray(group.changes) || group.changes.length !== 1)
    throw invalid();
  const shiftId = group.financial.shift_id;
  const [change] = group.changes;
  if (typeof shiftId !== "string" || !UUID.test(shiftId) ||
      !fields(change, ["table_name", "entity_id", "row_data", "row_version", "tombstone"]) ||
      change.table_name !== "shifts" || change.tombstone !== false) throw invalid();
  const row = change.row_data;
  let key, graph;
  try { key = JSON.parse(change.entity_id); } catch { throw invalid(); }
  if (!fields(key, ["id"]) || key.id !== shiftId ||
      !fields(row, ["id", "store_id", "row_version", "graph_json", "graph_sha256"]) ||
      row.id !== shiftId || row.store_id !== branch || !Number.isInteger(row.row_version) ||
      row.row_version < 1 || row.row_version > 2147483647 || change.row_version !== String(row.row_version) ||
      typeof row.graph_json !== "string" || Buffer.byteLength(row.graph_json, "utf8") > 196608 ||
      typeof row.graph_sha256 !== "string" || createHash("sha256").update(row.graph_json, "utf8").digest("hex") !== row.graph_sha256)
    throw invalid();
  try { graph = JSON.parse(row.graph_json); } catch { throw invalid(); }
  if (!fields(graph, ["ok", "shiftGraphVersion", "branchId", "shiftId", "graphToken", "closedAtRaw", "tables"]) ||
      graph.branchId !== branch || graph.shiftId !== shiftId) throw invalid();
  const parent = validateGraph(graph, branch, shiftId).get("shifts")[0];
  if (parent.row_version !== row.row_version) throw invalid();
  return { kind: "shift_v1", seq: group.seq, operationId: group.operation_id, shiftId, branch,
    rowVersion: row.row_version, changes: group.changes, graph: rememberGraph(graph, row.graph_json, "1") };
}

async function applyManagedShiftGroup(worker, transaction, context, facts) {
  const { branch } = context;
  if (facts.branch !== branch) throw invalid();
  const local = await transaction.request().input("branch", branch).input("shift", facts.shiftId).query(`
    SELECT row_version,status,state,CONVERT(nvarchar(40),closed_at,127) AS closed_at
    FROM dbo.shifts WITH(UPDLOCK,HOLDLOCK)
    WHERE id=@shift AND store_id COLLATE Latin1_General_100_BIN2=@branch COLLATE Latin1_General_100_BIN2;`);
  const parent = local.recordset?.[0];
  if (Number(parent?.row_version) > facts.rowVersion) {
    if (await proveAcceptedOlderClosing(worker, transaction, context, facts, parent)) return 0;
    throw fail("A newer saved closing needs a verified history comparison before applying this grouped graph.",
      "ESYNC_GROUPED_REVIEW_REQUIRED");
  }
  return applyShiftGraphs({ transaction, connectionManager: worker.connectionManager, registry: worker.registry,
    reader: worker.reader, branchId: branch, prepared: { graphs: new Map([[facts.shiftId, facts.graph]]), exactNoops: new Set() } });
}

async function proveAcceptedOlderClosing(worker, transaction, context, facts, parent) {
  const { source, branch } = context;
  const terminal = recordId(source?.terminal?.tokenId);
  const projectOrigin = source?.project?.projectOrigin;
  const closedAt = instant(parent.closed_at);
  if (!UUID.test(terminal ?? "") || !projectOrigin || parent.status !== "CLOSED" || parent.state !== "CLOSED" ||
      closedAt === undefined || closedAt !== instant(facts.graph.closedAtRaw)) return false;

  // A newer independent row version is never authority. Only this source's
  // previously verified acknowledgement and exact retained rows establish
  // that the older closing is already present and may advance as a no-op.
  const receipt = (await transaction.request().input("branch", branch).input("shift", facts.shiftId)
    .input("token", facts.graph.graphToken).query(`
      SELECT TOP(1) intent_id,ack_coverage_json FROM dbo.pos_sync_shift_intents WITH(UPDLOCK,HOLDLOCK)
      WHERE branch_id=@branch AND shift_id=@shift AND accepted_token=@token
        AND acknowledged_at IS NOT NULL AND ack_coverage_json IS NOT NULL ORDER BY intent_sequence DESC;`)).recordset?.[0];
  if (!receipt) return false;
  const store = new ShiftIntentStore(worker.connectionManager, worker.registry);
  const intent = await store.get(receipt.intent_id, branch, transaction);
  if (!intent?.acknowledged || intent.shiftId !== facts.shiftId ||
      intent.shiftAuthor?.terminalId !== terminal || intent.shiftAuthor.projectOrigin !== projectOrigin) return false;
  const coverage = validateCoverage(JSON.parse(receipt.ack_coverage_json), intent, worker.registry);
  if (!coverage.tables.find(part => part.table === "shifts")?.rows.some(row => row.id === facts.shiftId)) return false;

  const exact = exactGraph(facts.graph, branch, facts.shiftId);
  if (!exact) return false;
  for (const part of exact.tables) {
    if (part.table === "shifts" || !part.rows.length) continue;
    const table = worker.registry.tables.find(entry => entry.cloudTable === part.table && entry.sqlServerTable === part.table);
    if (!table) return false;
    const saved = await transaction.request().input("shift", facts.shiftId)
      .input("ids", JSON.stringify(part.rows.map(row => row.id))).query(`
        SELECT ${projection(table)} FROM dbo.[${part.table}] AS source WITH(UPDLOCK,HOLDLOCK)
        WHERE shift_id=@shift AND id IN (SELECT TRY_CONVERT(uniqueidentifier,[value]) FROM OPENJSON(@ids));`);
    if (!exactRows(table, saved.recordset, part.rows)) return false;
  }
  return true;
}

module.exports = { parseManagedShiftGroup, applyManagedShiftGroup };
