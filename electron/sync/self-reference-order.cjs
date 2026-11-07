const { recordId } = require("./uuid-fields.cjs");
const rowKey = value => typeof value === "string" ? recordId(value) : Number.isFinite(value) ? value : null;

// Only reorder dependencies already present in this authorized page. A parent
// outside the page still has to exist locally under the database's FK checks.
function orderSelfReferencingRows(table, rows) {
  if (rows.length < 2) return rows;
  const selfReferences = table.columns.filter(column => column.foreignKeyTarget?.table === table.cloudTable);
  if (!selfReferences.length) return rows;

  const primary = table.columns.filter(column => column.primaryKey).map(column => column.cloudColumn);
  const targets = new Map(selfReferences.map(column => [column.foreignKeyTarget.column, new Map()]));
  const previous = new Map();
  const prerequisites = rows.map(({ row_data: row }, index) => {
    for (const [key, positions] of targets) {
      const value = rowKey(row?.[key]);
      if (value !== null && !positions.has(value)) positions.set(value, index);
    }
    const key = primary.map(column => rowKey(row?.[column]));
    if (!key.length || key.includes(null)) return [];
    const identity = JSON.stringify(key);
    const prior = previous.get(identity);
    previous.set(identity, index);
    return prior === undefined ? [] : [prior];
  });

  for (const [index, { row_data: row }] of rows.entries()) {
    for (const column of selfReferences) {
      const key = column.foreignKeyTarget.column;
      const parentId = rowKey(row?.[column.cloudColumn]);
      if (parentId === null || parentId === rowKey(row?.[key])) continue;
      const parent = targets.get(key).get(parentId);
      if (parent !== undefined) prerequisites[index].push(parent);
    }
  }

  const state = new Uint8Array(rows.length);
  const ordered = [];
  function visit(index) {
    if (state[index] === 2) return true;
    if (state[index] === 1) return false;
    state[index] = 1;
    if (!prerequisites[index].every(visit)) return false;
    state[index] = 2;
    ordered.push(rows[index]);
    return true;
  }

  // A cycle can be valid when one of its parent rows already exists. In that
  // case retain the original order and let SQL decide. An impossible cycle
  // fails its FK check under the existing page transaction and keeps its cursor.
  return rows.every((_, index) => visit(index)) ? ordered : rows;
}

module.exports = { orderSelfReferencingRows };
