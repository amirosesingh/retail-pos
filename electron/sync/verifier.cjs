const { createHash } = require("node:crypto");
const { scopedWhere } = require("../db/branch-scope.cjs");
const { toCloudRow } = require("./row-codec.cjs");

const MOD = 1n << 256n;
const PAGE = 500;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object" && !(value instanceof Date))
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

function decimal(value) {
  let text = String(value).trim().toLowerCase();
  if (!/[e.]/.test(text)) return text.replace(/^(-?)0+(?=\d)/, "$1") || "0";
  const number = Number(text);
  return Number.isFinite(number) ? number.toString() : text;
}

function normalize(column, value) {
  if (value === null || value === undefined) return null;
  const type = String(column.cloudType ?? "").toLowerCase();
  // SQL Server's ODBC driver commonly returns uniqueidentifier values in
  // uppercase while PostgreSQL/Supabase serializes uuid values in lowercase.
  // UUID text is case-insensitive, so canonicalize it before hashing or an
  // identical row is reported as a completely different primary key.
  if (type === "uuid") return String(value).toLowerCase();
  if (/timestamp|date|time/.test(type)) {
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.valueOf()) ? String(value) : date.toISOString();
  }
  if (/int|numeric|decimal|real|double/.test(type)) return decimal(value);
  if (type === "boolean") return value === true || value === 1 || String(value).toLowerCase() === "true";
  if (type === "jsonb" || type.endsWith("[]")) {
    if (typeof value === "string") {
      try { return stable(JSON.parse(value)); } catch { return value; }
    }
    return stable(value);
  }
  return String(value);
}

function canonicalRow(table, row) {
  return JSON.stringify(Object.fromEntries(table.columns.map((column) => [
    column.cloudColumn,
    normalize(column, row[column.cloudColumn] ?? row[column.sqlServerColumn]),
  ])));
}

function accumulator() { return { count: 0n, sum: 0n, xor: 0n }; }
function add(state, table, row) {
  const hex = createHash("sha256").update(canonicalRow(table, row)).digest("hex");
  const value = BigInt(`0x${hex}`);
  state.count += 1n;
  state.sum = (state.sum + value) % MOD;
  state.xor ^= value;
}
function finish(state) {
  return `${state.count}:${state.sum.toString(16).padStart(64, "0")}:${state.xor.toString(16).padStart(64, "0")}`;
}
function signatureRows(table, rows) {
  const state = accumulator();
  for (const row of rows) add(state, table, row);
  return finish(state);
}

function keyset(primary, alias = "source") {
  return primary.map((column, index) => `(${primary.slice(0, index).map((prior, part) => `${alias}.[${prior.sqlServerColumn}]=@cursor${part}`).concat(`${alias}.[${column.sqlServerColumn}]>@cursor${index}`).join(" AND ")})`).join(" OR ");
}

async function localSignature({ connectionManager, registry, table, branchId, historyDays, terminalId = "" }) {
  const primary = table.columns.filter((column) => column.primaryKey);
  if (!primary.length) throw new Error(`No stable key is registered for ${table.sqlServerTable}.`);
  const state = accumulator();
  let cursor = null;
  const cutoff = new Date(Date.now() - Math.max(30, Number(historyDays) || 90) * 86400000);
  for (;;) {
    const request = connectionManager.pool.request().input("branch", String(branchId)).input("terminal", String(terminalId ?? "")).input("cutoff", cutoff).input("limit", PAGE);
    if (cursor) primary.forEach((column, index) => request.input(`cursor${index}`, cursor[column.sqlServerColumn]));
    const scope = scopedWhere(registry, table, { historyDays, alias: "source" });
    const after = cursor ? ` AND (${keyset(primary)})` : "";
    const order = primary.map((column) => `source.[${column.sqlServerColumn}]`).join(",");
    const result = await request.query(`SELECT TOP (@limit) source.* FROM dbo.[${table.sqlServerTable}] source WHERE ${scope}${after} ORDER BY ${order};`);
    const rows = result.recordset ?? [];
    for (const row of rows) add(state, table, toCloudRow(table, row));
    if (rows.length < PAGE) break;
    cursor = Object.fromEntries(primary.map((column) => [column.sqlServerColumn, rows.at(-1)[column.sqlServerColumn]]));
  }
  return finish(state);
}

async function cloudSignature({ cloud, table, branchId, historyDays }) {
  const state = accumulator();
  let cursor = null;
  do {
    const batch = await cloud.bootstrapPage({ table: table.cloudTable, branchId, historyDays, cursor, limit: PAGE });
    const rows = batch.rows ?? [];
    for (const row of rows) add(state, table, row);
    cursor = batch.cursor ?? null;
  } while (cursor);
  return finish(state);
}

async function verifyTables({ connectionManager, registry, cloud, branchId, historyDays = 90, tableNames = null, onTable = null }) {
  const wanted = tableNames?.length ? new Set(tableNames.map(String)) : null;
  const tables = [];
  for (const table of registry.tables) {
    if (wanted && !wanted.has(table.cloudTable)) continue;
    const [localSignatureValue, cloudSignatureValue] = await Promise.all([
      localSignature({ connectionManager, registry, table, branchId, historyDays, terminalId: cloud.terminalId?.() ?? "" }),
      cloudSignature({ cloud, table, branchId, historyDays }),
    ]);
    const result = {
      table: table.cloudTable,
      localSignature: localSignatureValue,
      cloudSignature: cloudSignatureValue,
      status: localSignatureValue === cloudSignatureValue ? "VERIFIED" : "DIFFERENT",
      verified: localSignatureValue === cloudSignatureValue,
      verifiedAt: new Date().toISOString(),
    };
    tables.push(result);
    onTable?.(result, tables);
  }
  return { verified: tables.every((table) => table.verified), verifiedAt: new Date().toISOString(), tables };
}

module.exports = { canonicalRow, signatureRows, localSignature, cloudSignature, verifyTables };
