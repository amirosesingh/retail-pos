"use strict";

// Planning only. A classification is NOT an upload intent, fresh cloud witness,
// administrator approval, row-write authorization or checkpoint acknowledgement.
const { recordId } = require("./uuid-fields.cjs");
const { decimal, instant, isExactNumber, parseExactJson } = require("./shift-recovery-exact.cjs");
const TABLES = Object.freeze(["shifts", "shift_cash_counts", "shift_reconciliations", "shift_close_events", "shift_notifications", "shift_variance_alerts"]);
const SUMMARY = Object.freeze(["expected_cash", "expected_card", "expected_digital", "variance_cash", "variance_total"]);
const METADATA = new Set(["row_version", "updated_at"]);
const ID_TEXT = new Set(["store_id", "terminal_id"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMIT = 6 * 1024 * 1024;
const TENDERS = ["cash", "card", "digital"];
const RECON_PARENT = ["counted_card", "counted_digital", "expected_cash", "expected_card", "expected_digital", "variance_cash", "variance_card", "variance_digital", "variance_total", "variance_status"];
const REQUIRED = {
  shifts: ["id", "store_id", "terminal_id", "status", "state", "opened_at", "closed_at", "created_at", "updated_at", "row_version", "counted_cash", "final_counted_cash", ...RECON_PARENT],
  shift_cash_counts: ["id", "store_id", "shift_id", "kind", ...TENDERS.map(tender => `counted_${tender}`)],
  shift_reconciliations: ["id", "store_id", "shift_id", "count_id", "counted_cash", ...RECON_PARENT],
  shift_close_events: ["id", "store_id", "shift_id"],
  shift_notifications: ["id", "store_id", "shift_id"],
  shift_variance_alerts: ["id", "store_id", "shift_id", "reconciliation_id"],
};
function refuse(code = "ESYNC_GRAPH") {
  throw Object.assign(new Error("The retained closing graph cannot be classified safely."), { code, table: "shifts" });
}
function plain(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}
function own(object, key) {
  if (!plain(object)) refuse();
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor || !Object.hasOwn(descriptor, "value")) refuse();
  return descriptor.value;
}
function arrayValues(value, maximum) {
  if (!Array.isArray(value) || value.length > maximum) refuse();
  const copy = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, "value")) refuse();
    copy.push(descriptor.value);
  }
  if (Reflect.ownKeys(value).length !== copy.length + 1) refuse();
  return copy;
}
const id = value => typeof value === "string" ? recordId(value) : "";
function spend(budget, value) {
  if (++budget.nodes > 500000) refuse();
  if (typeof value === "string") budget.bytes += Buffer.byteLength(value, "utf8") + 4;
  else budget.bytes += 8;
  if (budget.bytes > LIMIT) refuse();
}
function exactTree(value, budget, depth = 0) {
  if (depth > 64) refuse();
  spend(budget, value);
  if (isExactNumber(value)) {
    const number = decimal(value);
    if (number === undefined) refuse();
    return ["number", number];
  }
  if (value === null || typeof value === "boolean" || typeof value === "string") return [typeof value, value];
  // A normal JSON number may already have lost precision; never certify it.
  if (Array.isArray(value)) return ["array", arrayValues(value, 500000).map(item => exactTree(item, budget, depth + 1))];
  if (plain(value)) return ["object", Object.keys(value).sort().map(key => {
    spend(budget, key); return [key, exactTree(own(value, key), budget, depth + 1)];
  })];
  refuse();
}
function cell(column, value, local, budget) {
  spend(budget, value);
  if (value === null) return ["null"];
  const type = String(column.cloudType).toLowerCase();
  if (/^(?:numeric|decimal|money|smallmoney|bigint|integer|smallint|real|double precision)/.test(type)) {
    const number = decimal(value);
    if (number === undefined) refuse();
    return ["numeric", number];
  }
  if (/^timestamp/.test(type)) {
    const stamp = instant(value);
    if (stamp === undefined) refuse();
    return ["timestamp", stamp];
  }
  if (type === "date") {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || instant(`${value}T00:00:00Z`) === undefined) refuse();
    return ["date", value];
  }
  if (type === "uuid") {
    if (!UUID.test(typeof value === "string" ? value : "")) refuse();
    return ["uuid", id(value)];
  }
  if (type === "boolean") {
    if (local && isExactNumber(value) && ["0", "1e0"].includes(decimal(value))) value = decimal(value) === "1e0";
    if (local && (value === 0 || value === 1)) value = Boolean(value);
    if (typeof value !== "boolean") refuse();
    return ["boolean", value];
  }
  if (type === "jsonb" || type.endsWith("[]")) {
    if (local && typeof value === "string") value = parseExactJson(value, { maxBytes: LIMIT, maxDepth: 64 });
    return exactTree(value, budget);
  }
  if (typeof value !== "string") refuse();
  return ["text", ID_TEXT.has(column.cloudColumn) ? id(value) : value];
}
function registryTables(registry) {
  if (!registry || !Array.isArray(registry.tables)) refuse();
  const result = new Map();
  for (const name of TABLES) {
    const matches = registry.tables.filter(table => table.cloudTable === name);
    if (matches.length !== 1 || !Array.isArray(matches[0].columns) || matches[0].columns.length > 256) refuse();
    const table = matches[0], keys = new Set(), sqlKeys = new Set();
    for (const column of table.columns) {
      if (!/^[a-z_][a-z0-9_]*$/i.test(column.cloudColumn || "") || !/^[a-z_][a-z0-9_]*$/i.test(column.sqlServerColumn || "") ||
          typeof column.cloudType !== "string" || keys.has(column.cloudColumn) || sqlKeys.has(column.sqlServerColumn)) refuse();
      keys.add(column.cloudColumn); sqlKeys.add(column.sqlServerColumn);
    }
    if (REQUIRED[name].some(key => !keys.has(key))) refuse();
    result.set(name, table);
  }
  return result;
}
function graph(input, tables, branch, shift, local) {
  if (!Array.isArray(input) || input.length !== TABLES.length) refuse();
  const rows = new Map(), values = new Map(), budget = { bytes: 0, nodes: 0 };
  let total = 0;
  for (const entry of arrayValues(input, TABLES.length)) {
    const name = own(entry, "table"), source = own(entry, "rows");
    if (!TABLES.includes(name) || rows.has(name) || !Array.isArray(source) || (total += source.length) > 2000) refuse();
    const table = tables.get(name), mapped = new Map(), raw = new Map();
    const sourceKeys = new Set(table.columns.map(column => local ? column.sqlServerColumn : column.cloudColumn));
    const field = key => table.columns.find(column => column.cloudColumn === key);
    for (const row of arrayValues(source, 2000)) {
      if (!plain(row) || Object.keys(row).some(key => !sourceKeys.has(key))) refuse();
      const facts = Object.create(null), physical = Object.create(null);
      for (const column of table.columns) {
        const value = own(row, local ? column.sqlServerColumn : column.cloudColumn);
        spend(budget, column.cloudColumn);
        facts[column.cloudColumn] = cell(column, value, local, budget);
        physical[column.cloudColumn] = value;
      }
      const key = id(physical.id);
      if (!UUID.test(key) || mapped.has(key)) refuse();
      if (id(physical.store_id) !== branch || id(name === "shifts" ? physical.id : physical.shift_id) !== shift)
        refuse("SYNC_BRANCH_FORBIDDEN");
      if (!field("id") || !field("store_id")) refuse();
      mapped.set(key, facts); raw.set(key, physical);
    }
    rows.set(name, mapped); values.set(name, raw);
  }
  if (rows.size !== TABLES.length || rows.get("shifts").size !== 1 || !rows.get("shifts").has(shift)) refuse();
  const parents = values.get("shifts"), parent = parents.get(shift);
  const closed = parent.status === "CLOSED" || parent.state === "CLOSED" || parent.closed_at !== null;
  if (closed && (parent.status !== "CLOSED" || parent.state !== "CLOSED" || parent.closed_at === null)) refuse();
  if (closed && instant(parent.closed_at) === undefined) refuse();
  const counts = [...values.get("shift_cash_counts").values()];
  const reconciliations = [...values.get("shift_reconciliations").values()];
  const originals = counts.filter(count => count.kind === "ORIGINAL");
  if (originals.length > 1 || (closed && (originals.length !== 1 || !reconciliations.length)) ||
      counts.some(count => !["ORIGINAL", "RECOUNT"].includes(count.kind))) refuse();
  for (const recon of reconciliations) {
    const count = values.get("shift_cash_counts").get(id(recon.count_id));
    if (!count || !TENDERS.every(tender => equal(rows.get("shift_cash_counts").get(id(count.id))[`counted_${tender}`],
      rows.get("shift_reconciliations").get(id(recon.id))[`counted_${tender}`]))) refuse();
  }
  for (const alert of values.get("shift_variance_alerts").values())
    if (alert.reconciliation_id !== null && !values.get("shift_reconciliations").has(id(alert.reconciliation_id))) refuse();
  if (closed) {
    // Legacy closings legitimately stored uncounted card/digital tenders as
    // NULL. Preserve that fact exactly; never convert it into zero/evidence.
    for (const count of counts) if (rows.get("shift_cash_counts").get(id(count.id)).counted_cash[0] !== "numeric") refuse();
    for (const recon of reconciliations) {
      const facts = rows.get("shift_reconciliations").get(id(recon.id));
      if (["counted_cash", "expected_cash", "expected_card", "expected_digital", "variance_cash", "variance_total"].some(key => facts[key][0] !== "numeric") ||
          typeof recon.variance_status !== "string" || !recon.variance_status) refuse();
    }
    const facts = rows.get("shifts").get(shift);
    const headerMatches = [...rows.get("shift_reconciliations").values()].some(recon =>
      RECON_PARENT.every(key => (local && SUMMARY.includes(key) && parent[key] === null) || equal(facts[key], recon[key])) &&
      equal(facts.final_counted_cash[0] === "null" ? facts.counted_cash : facts.final_counted_cash, recon.counted_cash));
    if (!headerMatches) refuse();
  }
  return { rows, values, parent, closed };
}
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
function sameTable(left, right) {
  if (left.size !== right.size) return false;
  for (const [key, facts] of left) if (!right.has(key) || !equal(facts, right.get(key))) return false;
  return true;
}
function result(kind, fields, reasonCode) {
  return Object.freeze({ kind, needsReview: kind !== "exact", autoApply: false,
    changedParentFields: Object.freeze([...fields].sort()), reasonCode });
}
function selectedReconciliation(remote, shift) {
  const parent = remote.rows.get("shifts").get(shift);
  return [...remote.rows.get("shift_reconciliations").values()].filter(recon =>
    RECON_PARENT.every(key => equal(parent[key], recon[key])) &&
    equal(parent.final_counted_cash[0] === "null" ? parent.counted_cash : parent.final_counted_cash, recon.counted_cash));
}
function precisionCandidate(local, remote) {
  if (typeof local !== "string" || !/\.\d{7}(?:Z|[+-]\d{2}:\d{2})$/.test(local) || typeof remote !== "string") return false;
  const left = instant(local), right = instant(remote);
  if (left === undefined || right === undefined) return false;
  const l = BigInt(left), r = BigInt(right), delta = l > r ? l - r : r - l;
  // A bounded review candidate only, never permission to round or overwrite.
  return l % 10n !== 0n && r % 10n === 0n && delta > 0n && delta <= 5n;
}

function classifyRetainedShiftGraph({ registry, branchId, shiftId, localTables, cloudTables }) {
  try {
    const branch = id(branchId), shift = id(shiftId);
    if (!branch || branch.length > 128 || !UUID.test(shift)) refuse("SYNC_BRANCH_FORBIDDEN");
    const tables = registryTables(registry);
    const local = graph(localTables, tables, branch, shift, true), remote = graph(cloudTables, tables, branch, shift, false);
    const left = local.rows.get("shifts").get(shift), right = remote.rows.get("shifts").get(shift);
    const fields = Object.keys(left).filter(key => !equal(left[key], right[key]));
    const childrenSame = TABLES.slice(1).every(name => sameTable(local.rows.get(name), remote.rows.get(name)));
    if (!fields.length && childrenSame) return result("exact", fields, "EXACT_REGISTERED_FACTS");
    const changedBusiness = fields.filter(key => !METADATA.has(key));
    if (childrenSame && (!changedBusiness.length || (changedBusiness.length === 1 && changedBusiness[0] === "created_at" &&
      precisionCandidate(local.parent.created_at, remote.parent.created_at))))
      return result("metadata-only-candidate", fields, changedBusiness.length ? "CREATED_AT_PRECISION_REVIEW" : "SYNC_METADATA_REVIEW");
    if (childrenSame && local.closed && remote.closed && changedBusiness.length && changedBusiness.every(key => SUMMARY.includes(key)) &&
        changedBusiness.every(key => local.parent[key] === null && remote.parent[key] !== null) && selectedReconciliation(remote, shift).length)
      return result("parent-summary-candidate", fields, "SAVED_RECONCILIATION_PARENT_PROJECTION");
    if (local.closed && !remote.closed && remote.parent.status === "OPEN" && remote.parent.state === "ACTIVE" &&
        TABLES.slice(1).every(name => !remote.rows.get(name).size))
      return result("legacy-local-closing-needs-review", fields, "LOCAL_CLOSING_WITHOUT_CLOUD_CLOSING");
    if (local.closed && remote.closed && (!childrenSame || changedBusiness.length))
      return result("competing-closings-needs-review", fields, "COMPETING_CLOSING_FACTS");
    return result("unverified-difference-needs-review", fields, "UNSUPPORTED_RETAINED_DIFFERENCE");
  } catch (error) {
    if (error?.code === "SYNC_BRANCH_FORBIDDEN") refuse("SYNC_BRANCH_FORBIDDEN");
    refuse();
  }
}

module.exports = { classifyRetainedShiftGraph, TABLES, SUMMARY };
