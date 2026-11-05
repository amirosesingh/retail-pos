const {
  ShiftIntentStore,
  GRAPH_TABLES,
  validateGraph,
  sameRow,
  UUID,
} = require("../db/shift-intents.cjs");
const { recordId } = require("./uuid-fields.cjs");
const { toLocalValue, toCloudRow } = require("./row-codec.cjs");
const {witnessBytes,exactGraph,exactRows,projection,decimal,instant,stringifyExactJson}=require("./shift-recovery-exact.cjs");
const id = (value) => recordId(String(value ?? "").trim());
const refuse = (message, code = "ESYNC_GRAPH") => {
  throw Object.assign(new Error(message), { code, table: "shifts" });
};

// Fetch a single consistent graph per affected shift before opening the local
// transaction. Never assemble a cloud baseline from separately paged tables.
async function prepareShiftGraphs({
  cloud,
  connectionManager,
  branchId,
  changes,
  byteBudget = 64 * 1024 * 1024,
}) {
  const branch = id(branchId),
    shifts = new Set();
  for (const change of changes) {
    if (!GRAPH_TABLES.includes(change.table_name)) continue;
    let key;
    try {
      key = JSON.parse(change.entity_id);
    } catch {
      refuse("Invalid closing download key.");
    }
    if (!UUID.test(id(key?.id))) refuse("Invalid closing download key.");
    const row = change.row_data;
    if (row && (id(row.store_id) !== branch || id(row.id) !== id(key.id)))
      refuse("The closing download crosses its verified branch.", "SYNC_BRANCH_FORBIDDEN");
    let shift = change.table_name === "shifts" ? id(key.id) : id(row?.shift_id);
    if (!shift && change.tombstone) {
      const result = await connectionManager.pool
        .request()
        .input("id", key.id)
        .input("branch", branch)
        .query(
          `SELECT shift_id FROM dbo.[${change.table_name}] WHERE id=@id AND store_id=@branch;`,
        );
      shift = id(result.recordset?.[0]?.shift_id);
      if (!shift)
        refuse(
          "The closing tombstone has no safely attributable parent.",
          "ELOCAL_PENDING_UNVERIFIED",
        );
    }
    if (!UUID.test(shift)) refuse("The closing download has no verified shift.");
    shifts.add(shift);
  }
  const graphs = new Map(),exactNoops=new Set();
  let graphBytes = 0;
  for (const shiftId of [...shifts].sort()) {
    const graph = await cloud.shiftGraph({ branchId: branch, shiftId });
    validateGraph(graph, branch, shiftId, { allowUnclosed: true });
    if (graph.graphToken !== null || exactGraph(graph,branch,shiftId)) {
      graphBytes += Buffer.byteLength(JSON.stringify(graph), "utf8")+witnessBytes(graph);
      if (graphBytes > byteBudget)
        refuse(
          "Closing snapshots exceed this page's memory budget; retry a smaller page.",
          "EOVERSIZED",
        );
      graphs.set(shiftId, graph);
    }
  }
  return {
    graphs,
    exactNoops,
    covers(change) {
      if (!GRAPH_TABLES.includes(change.table_name)) return false;
      let key;
      try {
        key = JSON.parse(change.entity_id);
      } catch {
        return false;
      }
      const shift = change.table_name === "shifts" ? id(key.id) : id(change.row_data?.shift_id);
      // An absent tombstone is never silently swallowed. Whole-graph validation
      // below also preserves all saved audit rows rather than deleting history.
      return !change.tombstone && graphs.has(shift) && (graphs.get(shift).graphToken!==null || exactNoops.has(shift));
    },
  };
}

async function applyShiftGraphs({
  transaction,
  connectionManager,
  registry,
  reader,
  branchId,
  prepared,
  recovery,
}) {
  if (!prepared?.graphs.size) return 0;
  if (!reader) refuse("The local closing-change guard is required.", "ELOCAL_PENDING_UNVERIFIED");
  const sql = connectionManager.sql(),
    store = new ShiftIntentStore(connectionManager, registry);
  const query = (statement, inputs = {}) => {
    const request = new sql.Request(transaction);
    for (const [key, value] of Object.entries(inputs)) request.input(key, value);
    return request.query(statement);
  };
  let applied = 0;
  for (const [shiftId, graph] of prepared.graphs) {
    const tables = validateGraph(graph, branchId, shiftId,{allowUnclosed:true});
    const exact = exactGraph(graph, branchId, shiftId);
    if (witnessBytes(graph) && !exact) refuse("The exact closing response changed before application.");
    const exactTables = exact ? new Map(exact.tables.map(part => [part.table, part.rows])) : null;
    const parentTable = registry.tables.find((table) => table.cloudTable === "shifts");
    const parentChange = {
      entity_id: JSON.stringify({ id: shiftId }),
      row_data: tables.get("shifts")[0],
      tombstone: false,
    };
    if (
      (
        await reader.unacknowledged(parentTable, [parentChange.entity_id], transaction, {
          branchId,
          changes: [parentChange],
          incomingGraph: graph,
          requireExact: Boolean(recovery?.requiresExact(shiftId)),
        })
      ).size
    )
      refuse(
        "The complete closing graph is waiting for a pending local upload.",
        "ELOCAL_UPLOAD_PENDING",
      );
    const unaccepted = await query(
      "SELECT TOP(1) intent_id FROM dbo.pos_sync_shift_intents WITH(UPDLOCK,HOLDLOCK) WHERE branch_id=@branch AND shift_id=@shift AND acknowledged_at IS NULL;",
      { branch: branchId, shift: shiftId },
    );
    if (unaccepted.recordset?.length)
      refuse("A protected closing intent remains pending.", "ELOCAL_UPLOAD_PENDING");
    if(reader.exactShiftGraphNoop?.(transaction,branchId,graph)){
      // Exact expired-CT proof permits no business writes, clocks or baseline
      // adoption. It is a read-only match, not an acknowledgement of old edits.
      recovery?.note(transaction,shiftId,graph);prepared.exactNoops?.add(shiftId);continue;
    }
    if(recovery?.requiresExact(shiftId))refuse("Retained closing history did not receive an exact no-op proof.","ELOCAL_PENDING_UNVERIFIED");
    if(graph.graphToken===null)continue;
    const ordered = registry.tables
      .filter((table) => GRAPH_TABLES.includes(table.cloudTable))
      .sort((a, b) => a.dependencyOrder - b.dependencyOrder);
    for (const table of ordered) {
      const rows = (exactTables ?? tables).get(table.cloudTable),
        saved =
          (
            await query(
              `SELECT ${exact ? projection(table) : "*"} FROM dbo.[${table.sqlServerTable}]${exact ? " source" : ""} WITH(UPDLOCK,HOLDLOCK) WHERE ${table.cloudTable === "shifts" ? "id" : "shift_id"}=@shift;`,
              { shift: shiftId },
            )
          ).recordset ?? [];
      if (saved.some((row) => id(row.store_id) !== id(branchId)))
        refuse("The saved closing graph belongs to another branch.", "SYNC_BRANCH_FORBIDDEN");
      const remoteIds = new Set(rows.map((row) => id(row.id)));
      if (saved.some((row) => !remoteIds.has(id(row.id))))
        refuse(
          "The cloud graph is missing saved closing history. Retained records need reconciliation.",
          "ESYNC_APPLY_CONFLICT",
        );
      const immutable = [
        "shift_cash_counts",
        "shift_reconciliations",
        "shift_close_events",
      ].includes(table.cloudTable);
      for (const row of rows) {
        const old = saved.find((item) => id(item.id) === id(row.id));
        const equal = old && (exact ? exactRows(table, [old], [row]) : sameRow(table, toCloudRow(table, old), row));
        if (old && immutable && !equal)
          refuse(
            "Saved immutable closing history differs from the cloud graph.",
            "ESYNC_APPLY_CONFLICT",
          );
        if (equal) continue;
        if (exact) {
          if (table.columns.some(column => !Object.hasOwn(row, column.cloudColumn))) refuse("The complete cloud graph omits registered facts.");
          const request = new sql.Request(transaction), names = [];
          for (const [index, column] of table.columns.entries()) {
            if (old && column.sqlServerColumn !== "id" && exactRows({ ...table, columns: [column] }, [old], [row])) continue;
            const storage = String(column.sqlServerType).toLowerCase(), type = String(column.cloudType).toLowerCase();
            if (!/^[a-z_][a-z0-9_]*$/i.test(column.sqlServerColumn) || !/^(?:uniqueidentifier|bit|date|datetime2\(\d\)|datetimeoffset\(\d\)|nvarchar\((?:max|\d+)\)|varchar\((?:max|\d+)\)|(?:decimal|numeric)\(\d+,\s*\d+\)|bigint|int|smallint|tinyint|float|real|money|smallmoney)$/.test(storage)) refuse("The exact closing column type is unsupported.");
            const value = row[column.cloudColumn], parameter = `v${index}`;
            let text = value;
            if (value !== null) {
              if (/^(numeric|decimal|money|smallmoney|bigint|integer|smallint|real|double precision)/.test(type)) {
                if (decimal(value) === undefined) refuse("A closing number has no exact source token.");
                text = typeof value === "string" ? value : stringifyExactJson(value);
              } else if (type === "jsonb" || type.endsWith("[]")) text = stringifyExactJson(value);
              else if (type === "boolean") { if (typeof value !== "boolean") refuse("A closing boolean is invalid."); text = value ? "1" : "0"; }
              else if (typeof value !== "string" || /^timestamp/.test(type) && instant(value) === undefined) refuse("A closing value has no exact source representation.");
            }
            request.input(parameter, sql.NVarChar(sql.MAX), text);
            // Let text assignment reject overflow; an explicit text CAST could
            // silently truncate it. Numeric/time casts retain their raw token.
            names.push([column.sqlServerColumn, /^(?:n?varchar)/.test(storage) ? `@${parameter}` : `CONVERT(${storage},@${parameter})`]);
          }
          const source = names.map(([name, value]) => `${value} AS [${name}]`).join(",");
          const updates = names.filter(([name]) => name !== "id").map(([name]) => `target.[${name}]=source.[${name}]`).join(",");
          await request.query(`WITH CHANGE_TRACKING_CONTEXT(0x434C4F5544) MERGE dbo.[${table.sqlServerTable}] WITH(HOLDLOCK) target USING(SELECT ${source}) source ON target.id=source.id
            ${old && !immutable ? `WHEN MATCHED THEN UPDATE SET ${updates}` : ""}
            ${old ? "" : `WHEN NOT MATCHED THEN INSERT(${names.map(([name]) => `[${name}]`).join(",")}) VALUES(${names.map(([name]) => `source.[${name}]`).join(",")})`};`);
          applied++; continue;
        }
        const inputs = {},
          names = table.columns
            .filter((column) => Object.hasOwn(row, column.cloudColumn))
            .map((column, index) => {
              const parameter = `v${index}`;
              inputs[parameter] = toLocalValue(column, row[column.cloudColumn]);
              return [column.sqlServerColumn, parameter];
            });
        if (names.length !== table.columns.length)
          refuse("The complete cloud graph omits registered facts.");
        const source = names.map(([name, parameter]) => `@${parameter} AS [${name}]`).join(",");
        const updates = names
          .filter(([name]) => name !== "id")
          .map(([name]) => `target.[${name}]=source.[${name}]`)
          .join(",");
        await query(
          `WITH CHANGE_TRACKING_CONTEXT(0x434C4F5544) MERGE dbo.[${table.sqlServerTable}] WITH(HOLDLOCK) target USING(SELECT ${source}) source ON target.id=source.id
          ${immutable ? "" : `WHEN MATCHED THEN UPDATE SET ${updates}`} WHEN NOT MATCHED THEN INSERT(${names.map(([name]) => `[${name}]`).join(",")}) VALUES(${names.map(([name]) => `source.[${name}]`).join(",")});`,
          inputs,
        );
        applied++;
      }
      const confirmed =
        (
          await query(
            `SELECT ${exact ? projection(table) : "*"} FROM dbo.[${table.sqlServerTable}]${exact ? " source" : ""} WITH(UPDLOCK,HOLDLOCK) WHERE ${table.cloudTable === "shifts" ? "id" : "shift_id"}=@shift;`,
            { shift: shiftId },
          )
        ).recordset ?? [];
      if (exact ? !exactRows(table, confirmed, rows) : (
        confirmed.length !== rows.length ||
        rows.some(
          (row) =>
            !confirmed.some(
              (savedRow) =>
                id(savedRow.id) === id(row.id) && sameRow(table, toCloudRow(table, savedRow), row),
            ),
        )
      ))
        refuse(
          "The local database did not confirm the complete cloud closing graph.",
          "ESYNC_APPLY_DEFERRED",
        );
    }
    if (exact && exactGraph(graph, branchId, shiftId) !== exact) refuse("The exact closing response changed during application.");
    await store.adopt(transaction, graph);
  }
  return applied;
}
module.exports = { prepareShiftGraphs, applyShiftGraphs };
