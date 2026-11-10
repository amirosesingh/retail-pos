const { createHash } = require("node:crypto");
const { registeredRows } = require("./grouped-correction-receipt.cjs");
const { parseStockRow, applyGroupedStock } = require("./grouped-live-stock.cjs");

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const exact = (row, keys) => row && typeof row === "object" && !Array.isArray(row) &&
  Object.keys(row).length === keys.length && keys.every(key => Object.hasOwn(row, key));
const fail = (message, code = "ESYNC_FINANCIAL_GROUP_PROTOCOL") => Object.assign(new Error(message), { code, table: "stock_transfers" });
const invalid = () => fail("The grouped transfer is outside its authorized scope or shape.");
const review = () => fail("The saved transfer does not match the verified transfer boundary.", "ESYNC_GROUPED_REVIEW_REQUIRED");
const uuid = value => typeof value === "string" && UUID.test(value);
const branchId = value => typeof value === "string" && value.length > 0 && value.length <= 128 && !value.includes("\0");

function parseTransferDispatchGroup(group, branch) {
  if (!exact(group, ["seq", "operation_id", "financial", "changes"]) ||
      !exact(group.financial, ["kind", "transfer_id"]) || group.financial.kind !== "transfer_v1" ||
      typeof group.seq !== "string" || !/^[1-9]\d{0,18}$/.test(group.seq) || BigInt(group.seq) > 9223372036854775807n ||
      !uuid(group.operation_id) || !uuid(group.financial.transfer_id) || !Array.isArray(group.changes) || group.changes.length !== 1)
    throw invalid();
  const [change] = group.changes;
  if (!exact(change, ["table_name", "entity_id", "row_version", "tombstone", "row_data"]) ||
      change.table_name !== "stock_transfers" || change.tombstone !== false ||
      !exact(change.row_data, ["id", "store_id", "row_version", "graph_json", "graph_sha256"])) throw invalid();
  const { id, store_id, row_version, graph_json, graph_sha256 } = change.row_data;
  if (id !== group.financial.transfer_id || store_id !== branch || !branchId(branch) ||
      !Number.isInteger(row_version) || row_version < 1 || row_version > 2147483647 || change.row_version !== String(row_version) ||
      typeof graph_json !== "string" || Buffer.byteLength(graph_json, "utf8") > 196608 ||
      createHash("sha256").update(graph_json, "utf8").digest("hex") !== graph_sha256) throw invalid();
  let key, graph;
  try { key = JSON.parse(change.entity_id); graph = JSON.parse(graph_json); } catch { throw invalid(); }
  const receipt = Object.hasOwn(graph ?? {}, "movements");
  const fields = ["branch_id", "transfer", "request", "lines", "stock", "logs"];
  if (receipt) fields.push("movements");
  if (!exact(key, ["id"]) || key.id !== id || !exact(graph, fields))
    throw invalid();
  const { transfer, request, lines, stock, logs } = graph;
  if (graph.branch_id !== branch || transfer?.id !== id || transfer.row_version !== row_version ||
      transfer.kind !== "transfer" ||
      typeof transfer.dispatched_at !== "string" || typeof transfer.dispatched_by !== "string" ||
      !branchId(transfer.from_store_id) || !branchId(transfer.to_store_id) || transfer.from_store_id === transfer.to_store_id ||
      ![transfer.from_store_id, transfer.to_store_id].includes(branch) ||
      !Array.isArray(lines) || lines.length < 1 || lines.length > 100 ||
      !Array.isArray(stock) || stock.length > 100 || !Array.isArray(logs) || logs.length > 100) throw invalid();
  if (receipt) {
    assertReceiptGraph(graph, branch);
    return transferFacts(group, branch, [transfer], lines, stock, logs);
  }
  if (transfer.status !== "dispatched" ||
      (request === null ? transfer.source_request_id !== null : !uuid(request?.id) || request.id === id ||
        request.id !== transfer.source_request_id || request.kind !== "request" || request.status !== "completed" ||
        request.from_store_id !== transfer.from_store_id || request.to_store_id !== transfer.to_store_id ||
        request.source_request_id !== null || request.closed_at !== transfer.dispatched_at)) throw invalid();
  const dispatched = new Map();
  let childCount = 0;
  for (const line of lines) {
    if (!line || (line.transfer_id !== id && line.transfer_id !== request?.id)) throw invalid();
    if (line.transfer_id !== id) continue;
    childCount++;
    if (!Number.isInteger(line.quantity_dispatched) || line.quantity_dispatched < 0 ||
        line.quantity_dispatched > (line.quantity_approved ?? line.quantity)) throw invalid();
    if (line.quantity_dispatched === 0) continue;
    if (!uuid(line.product_id) || dispatched.has(line.product_id)) throw invalid();
    dispatched.set(line.product_id, line.quantity_dispatched);
  }
  const source = branch === transfer.from_store_id;
  if (!childCount || stock.length !== (source ? dispatched.size : 0) || logs.length !== stock.length) throw invalid();
  const balances = new Map(stock.map(raw => {
    const row = parseStockRow(raw);
    if (!dispatched.has(row.product_id)) throw invalid();
    return [row.product_id, row.branch_balance];
  }));
  if (balances.size !== stock.length || logs.some(row => !row || row.store_id !== branch ||
      row.activity_type !== "transfer_out" || row.reference !== transfer.ref || row.staff_name !== transfer.dispatched_by ||
      row.note !== "Warehouse dispatch" || !balances.has(row.product_id) || row.stock_after !== balances.get(row.product_id) ||
      row.quantity_delta !== -dispatched.get(row.product_id) || row.stock_before + row.quantity_delta !== row.stock_after) ||
      new Set(logs.map(row => row.product_id)).size !== logs.length) throw invalid();
  return transferFacts(group, branch, request ? [request, transfer] : [transfer], lines, stock, logs);
}

function assertReceiptGraph({ transfer, request, lines, stock, logs, movements }, branch) {
  const arrived = transfer.status === "received";
  if (request !== null || (transfer.source_request_id !== null &&
      (!uuid(transfer.source_request_id) || transfer.source_request_id === transfer.id)) ||
      !["received", "completed", "completed_with_discrepancy"].includes(transfer.status) ||
      typeof transfer.received_at !== "string" ||
      (arrived ? transfer.verified_at !== null || transfer.posted_at !== null :
        typeof transfer.verified_at !== "string" || transfer.posted_at !== transfer.verified_at) ||
      !Array.isArray(movements) || movements.length !== logs.length) throw invalid();
  const verified = new Map();
  let short = false;
  const ids = new Set();
  for (const line of lines) {
    if (line?.transfer_id !== transfer.id || !uuid(line.id) || ids.has(line.id) ||
        !Number.isInteger(line.quantity_dispatched) || line.quantity_dispatched < 0 ||
        line.quantity_dispatched > (line.quantity_approved ?? line.quantity) ||
        !Number.isInteger(line.quantity_received) || line.quantity_received < 0 ||
        line.quantity_received > line.quantity_dispatched ||
        (arrived ? line.quantity_verified !== null : line.quantity_verified !== line.quantity_received)) throw invalid();
    ids.add(line.id);
    if (arrived) continue;
    if (line.quantity_verified < line.quantity_dispatched) short = true;
    if (line.quantity_verified > 0) {
      if (!uuid(line.product_id)) throw invalid();
      verified.set(line.id, line);
    }
  }
  if (short !== (transfer.status === "completed_with_discrepancy") ||
      (short && (typeof transfer.discrepancy_reason !== "string" || !transfer.discrepancy_reason.trim()))) throw invalid();
  if (arrived || branch !== transfer.to_store_id) {
    if (logs.length || stock.length) throw invalid();
    return;
  }
  if (logs.length !== verified.size) throw invalid();
  const auditIds = new Set();
  const finalBalances = new Map();
  for (const [index, movement] of movements.entries()) {
    if (!exact(movement, ["line_id", "log_id"])) throw invalid();
    const line = verified.get(movement.line_id);
    const log = logs[index];
    if (!line || !uuid(log?.id) || movement.log_id !== log.id || auditIds.has(log.id) ||
        !uuid(log.product_id) || (transfer.transfer_scope !== "INTER_GROUP" && log.product_id !== line.product_id) ||
        log.store_id !== branch || log.activity_type !== "transfer_in" || log.reference !== transfer.ref ||
        log.staff_name !== (transfer.verified_by ?? "") || log.created_at !== transfer.posted_at ||
        log.quantity_delta !== line.quantity_verified || !Number.isInteger(log.stock_before) ||
        !Number.isInteger(log.stock_after) || log.stock_before + log.quantity_delta !== log.stock_after ||
        (finalBalances.has(log.product_id) && finalBalances.get(log.product_id) !== log.stock_before)) throw invalid();
    verified.delete(movement.line_id);
    auditIds.add(log.id);
    finalBalances.set(log.product_id, log.stock_after);
  }
  for (const raw of stock) {
    const row = parseStockRow(raw);
    if (finalBalances.get(row.product_id) !== row.branch_balance) throw invalid();
    finalBalances.delete(row.product_id);
  }
}

function transferFacts(group, branch, headers, lines, stock, logs) {
  return { kind: "transfer_v1", seq: group.seq, branch, headers, lines, stock, logs,
    changes: [...group.changes, { table_name: "stock_transfer_items" },
      ...(stock.length ? [{ table_name: "products" }] : []), ...(logs.length ? [{ table_name: "item_activity_logs" }] : [])] };
}

const identities = {
  stock_transfers: ["ref", "kind", "from_store_id", "to_store_id", "source_request_id", "created_at"],
  stock_transfer_items: ["transfer_id", "product_id", "created_at"],
  item_activity_logs: ["product_id", "store_id", "activity_type", "reference", "created_at"],
};

async function persistRows(worker, transaction, branch, { table, rows }) {
  if (!rows.length) return 0;
  const name = table.sqlServerTable;
  const keys = rows.map(({ id }) => JSON.stringify({ id }));
  if ((await worker.reader.unacknowledged(table, keys, transaction, { branchId: branch })).size)
    throw fail("The transfer has an unacknowledged local change.", "ELOCAL_UPLOAD_PENDING");
  const columns = table.columns.map(column => `[${column.sqlServerColumn}]`);
  const typed = table.columns.map((column, index) => `${columns[index]} ${column.sqlServerType}`);
  const comparisons = new Map(table.columns.map((column, index) => {
    const field = columns[index];
    const comparable = side => column.sqlServerType.startsWith("nvarchar(")
      ? `CONVERT(varbinary(max),${side}.${field})` : `${side}.${field}`;
    return [column.sqlServerColumn, `${comparable("saved")} IS DISTINCT FROM ${comparable("expected")}`];
  }));
  const sameIdentity = identities[name].map(field => comparisons.get(field)).join(" OR ");
  const differs = [...comparisons.values()].join(" OR ");
  const assignments = columns.filter(field => field !== "[id]").map(field => `${field}=expected.${field}`);
  const result = await transaction.request().input("rows", JSON.stringify(rows)).input("branch", branch).input("table", name).query(`
    DECLARE @expected TABLE(${typed.join(",")},PRIMARY KEY(id));
    INSERT @expected SELECT ${columns.join(",")} FROM OPENJSON(@rows) WITH (${typed.join(",")});
    DECLARE @locked int,@changed int=0;
    SELECT @locked=COUNT(*) FROM @expected wanted
      JOIN dbo.[${name}] saved WITH(UPDLOCK,HOLDLOCK) ON saved.id=wanted.id;
    DECLARE @baseline bigint=(SELECT change_tracking_version FROM dbo.sync_checkpoints WITH(HOLDLOCK)
      WHERE organization_id=N'default' AND branch_id=@branch AND entity_type=@table AND direction=N'push');
    DECLARE @minimum bigint=CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(N'dbo.${name}'));
    IF @baseline IS NULL OR @minimum IS NULL OR @baseline<@minimum OR @baseline>CHANGE_TRACKING_CURRENT_VERSION()
      BEGIN SELECT N'unverified' AS state; RETURN; END;
    DECLARE @pending bit=CASE WHEN EXISTS(SELECT 1 FROM CHANGETABLE(CHANGES dbo.[${name}],@baseline) AS ct
      JOIN @expected wanted ON wanted.id=ct.id
      WHERE ct.SYS_CHANGE_CONTEXT IS NULL OR ct.SYS_CHANGE_CONTEXT<>0x434C4F5544) THEN 1 ELSE 0 END;
    SET @minimum=CHANGE_TRACKING_MIN_VALID_VERSION(OBJECT_ID(N'dbo.${name}'));
    IF @minimum IS NULL OR @baseline<@minimum BEGIN SELECT N'unverified' AS state; RETURN; END;
    IF @pending=1 BEGIN SELECT N'pending' AS state; RETURN; END;
    IF EXISTS(SELECT 1 FROM dbo.[${name}] saved JOIN @expected expected ON expected.id=saved.id
      WHERE ${sameIdentity} OR saved.row_version>expected.row_version OR
        (saved.row_version=expected.row_version AND (${differs})))
      BEGIN SELECT N'review' AS state; RETURN; END;
    WITH CHANGE_TRACKING_CONTEXT (0x434C4F5544)
    UPDATE saved SET ${assignments.join(",")} FROM dbo.[${name}] saved
      JOIN @expected expected ON expected.id=saved.id WHERE saved.row_version<expected.row_version;
    SET @changed=@@ROWCOUNT;
    WITH CHANGE_TRACKING_CONTEXT (0x434C4F5544)
    INSERT dbo.[${name}](${columns.join(",")}) SELECT ${columns.join(",")} FROM @expected expected
    WHERE NOT EXISTS(SELECT 1 FROM dbo.[${name}] saved WITH(UPDLOCK,HOLDLOCK) WHERE saved.id=expected.id);
    SET @changed+=@@ROWCOUNT;
    SELECT CASE WHEN EXISTS(SELECT 1 FROM @expected expected LEFT JOIN dbo.[${name}] saved ON saved.id=expected.id
      WHERE saved.id IS NULL OR ${differs}) THEN N'review' ELSE N'applied' END AS state,@changed AS changed;`);
  const state = result.recordset?.[0];
  if (state?.state === "unverified") throw fail("The local transfer tracking boundary is unverified.", "ELOCAL_PENDING_UNVERIFIED");
  if (state?.state === "pending") throw fail("The transfer has an unacknowledged local change.", "ELOCAL_UPLOAD_PENDING");
  if (state?.state !== "applied") throw review();
  return state.changed;
}

async function applyTransferDispatchGroup(worker, transaction, context, facts) {
  const { branch, financialEpoch: epoch } = context;
  if (facts.branch !== branch || !uuid(epoch)) throw invalid();
  const headers = registeredRows(worker.registry, "stock_transfers", facts.headers, invalid);
  const lines = registeredRows(worker.registry, "stock_transfer_items", facts.lines, invalid);
  const logs = registeredRows(worker.registry, "item_activity_logs", facts.logs, invalid);
  const transfer = headers.rows.at(-1);
  if (headers.rows.length === 1 && transfer.source_request_id) {
    const request = await transaction.request().input("id", transfer.source_request_id)
      .input("from", transfer.from_store_id).input("to", transfer.to_store_id).query(`
      SELECT id FROM dbo.stock_transfers WITH(HOLDLOCK) WHERE id=@id AND kind=N'request'
        AND from_store_id COLLATE Latin1_General_100_BIN2=@from COLLATE Latin1_General_100_BIN2
        AND to_store_id COLLATE Latin1_General_100_BIN2=@to COLLATE Latin1_General_100_BIN2;`);
    if (request.recordset?.length !== 1)
      throw fail("The linked request must arrive before the transfer receipt.", "ESYNC_CASH_RECEIPT_DEPENDENCY");
  }
  const products = [...new Set([...facts.lines, ...facts.logs].map(row => row.product_id).filter(Boolean))];
  if (products.length) {
    const result = await transaction.request().input("keys", JSON.stringify(products)).query(`
      SELECT COUNT(*) AS found FROM dbo.products AS product WITH(HOLDLOCK)
      JOIN OPENJSON(@keys) AS wanted ON product.id=TRY_CONVERT(uniqueidentifier,wanted.[value]);`);
    if (result.recordset?.[0]?.found !== products.length)
      throw fail("A registered transfer product must arrive before the transfer group.", "ESYNC_CASH_RECEIPT_DEPENDENCY");
  }
  let changed = 0;
  // The request is an actual self-referencing parent of the dispatch.
  for (const row of headers.rows) changed += await persistRows(worker, transaction, branch, { ...headers, rows: [row] });
  changed += await persistRows(worker, transaction, branch, lines);
  changed += await persistRows(worker, transaction, branch, logs);
  // The paged snapshot installs current stock first. The ordinary stock
  // applier then verifies or skips a dispatch balance superseded by that pin.
  changed += await applyGroupedStock(worker, transaction, branch, facts.stock, { epoch, seq: facts.seq });
  return changed;
}

module.exports = { parseTransferDispatchGroup, applyTransferDispatchGroup };
