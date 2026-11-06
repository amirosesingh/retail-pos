"use strict";

// Main-private transport evidence. An IPC object or {ok:true} is never a receipt.
const { createHash } = require("node:crypto");
const { normalizeLegacyPayload, normalizeLegacyRecovery } = require("../security/legacy-shift-recovery-protocol.cjs");
const { parseExactJson, decimal, instant, exactRows } = require("./shift-recovery-exact.cjs");
const { GRAPH_TABLES } = require("../db/shift-intents.cjs");
const { classifyRetainedShiftGraph } = require("./shift-recovery-classification.cjs");
const { recordId } = require("./uuid-fields.cjs");
const witnesses = new WeakMap();
const MAX_RESPONSE_BYTES = 1024 * 1024;
const hash = raw => createHash("sha256").update(raw, "utf8").digest("hex");
const HASH = /^[a-f0-9]{64}$/;
const fail = () => { throw Object.assign(new Error("The server has not confirmed this administrator-reviewed recovery. Its saved upload remains pending."), { code: "ELEGACY_RECOVERY_RECEIPT", table: "shifts" }); };
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const sameSet = (values, names) => Array.isArray(values) && values.length === names.length && new Set(values).size === values.length && values.every(value => names.includes(value));

function eventIdentity(event) {
  try {
    const payload = normalizeLegacyPayload(JSON.parse(event.payloadJson)), proof = normalizeLegacyRecovery(event.proof);
    if (hash(event.payloadJson) !== event.payloadHash || event.payloadHash !== proof.payloadHash ||
        hash(payload.localGraphText) !== payload.evidenceHash || hash(payload.cloudGraphText) !== payload.cloudWitnessHash ||
        ["recoveryId", "branchId", "terminalId", "shiftId"].some(key => event[key] !== payload[key] || proof[key] !== payload[key]) ||
        event.evidenceHash !== payload.evidenceHash || event.cloudWitnessHash !== payload.cloudWitnessHash) fail();
    return JSON.stringify([event.recoveryId, event.payloadHash, event.branchId, event.terminalId, event.shiftId,
      event.evidenceHash, event.cloudWitnessHash, proof.authorId, proof.keyId, proof.projectOrigin, proof.signature]);
  } catch (error) { if (error?.code === "ELEGACY_RECOVERY_RECEIPT") throw error; fail(); }
}

function graphTables(tables, event, registry) {
  if (!Array.isArray(tables) || tables.length !== GRAPH_TABLES.length) fail();
  const seen = new Set(), result = new Map(); let total = 0;
  for (const part of tables) {
    const schema = registry.tables.find(table => table.cloudTable === part?.table);
    if (!record(part) || !GRAPH_TABLES.includes(part.table) || seen.has(part.table) || !schema || !Array.isArray(part.rows)) fail();
    seen.add(part.table);
    const columns = schema.columns.map(column => column.cloudColumn);
    if (!part.rows.every(row => record(row) && sameSet(Object.keys(row), columns) &&
        row.store_id === event.branchId && (part.table === "shifts" ? row.id : row.shift_id) === event.shiftId) ||
        !exactRows(schema, part.rows, part.rows)) fail();
    total += part.rows.length; if (total > 2000) fail();
    result.set(part.table, part.rows);
  }
  const parents = result.get("shifts"), counts = result.get("shift_cash_counts"), recons = result.get("shift_reconciliations");
  if (parents.length !== 1 || parents[0].status !== "CLOSED" || parents[0].state !== "CLOSED" ||
      instant(parents[0].closed_at) === undefined || !counts.length || counts.filter(row => row.kind === "ORIGINAL").length !== 1 ||
      !recons.length || recons.some(row => !counts.some(count => count.id === row.count_id))) fail();
  // Reuse the exact typed graph checks for tender/count/reconciliation links,
  // selected parent summaries, alerts and nullable legacy tender facts.
  if (classifyRetainedShiftGraph({ registry, branchId: event.branchId, shiftId: event.shiftId,
    localTables: tables, cloudTables: tables }).kind !== "exact") fail();
  return result;
}

function bindAcceptedRequest(event, accepted, registry) {
  const payload = normalizeLegacyPayload(JSON.parse(event.payloadJson));
  const requested = parseExactJson(payload.localGraphText, { maxBytes: MAX_RESPONSE_BYTES, maxDepth: 64 });
  if (!Array.isArray(requested) || requested.length !== GRAPH_TABLES.length) fail();
  const normalized = requested.map(part => {
    const schema = registry.tables.find(table => table.cloudTable === part?.table);
    if (!schema || !accepted.has(part.table) || !Array.isArray(part.rows)) fail();
    const remote = new Map(accepted.get(part.table).map(row => [recordId(row.id), row]));
    return { table: part.table, rows: part.rows.map(row => {
      const saved = remote.get(recordId(row?.id)); if (!saved) fail();
      const result = { ...row };
      for (const column of schema.columns) {
        const key = column.sqlServerColumn, target = saved[column.cloudColumn];
        if (["row_version", "updated_at"].includes(column.cloudColumn)) result[key] = target;
        else if (/^(timestamp|timestamptz)/.test(column.cloudType) && row[key] !== null && target !== null) {
          const sourceTime = instant(row[key]), targetTime = instant(target);
          if (sourceTime === undefined || targetTime === undefined) fail();
          if (sourceTime !== targetTime) {
            // The reviewed PostgreSQL typed insert rounds 100ns SQL Server
            // instants to microseconds. Permit only that bounded conversion,
            // including the half-microsecond tie, never millisecond truncation.
            const difference = BigInt(sourceTime) - BigInt(targetTime);
            if (difference < -5n || difference > 5n || BigInt(targetTime) % 10n !== 0n) fail();
            result[key] = target;
          }
        }
      }
      return result;
    }) };
  });
  if (classifyRetainedShiftGraph({ registry, branchId: event.branchId, shiftId: event.shiftId,
    localTables: normalized, cloudTables: [...accepted].map(([table, rows]) => ({ table, rows })) }).kind !== "exact") fail();
}

function validateCoverage(coverage, accepted, registry) {
  if (!record(coverage) || decimal(coverage.version) !== "1e0" || coverage.mode !== "matched_request_rows" ||
      !Array.isArray(coverage.tables) || coverage.tables.length !== GRAPH_TABLES.length) fail();
  const seen = new Set();
  for (const part of coverage.tables) {
    const schema = registry.tables.find(table => table.cloudTable === part?.table);
    if (!record(part) || !schema || !accepted.has(part.table) || seen.has(part.table) || !Array.isArray(part.rows)) fail();
    seen.add(part.table);
    const fields = schema.columns.map(column => column.cloudColumn), managed = fields.filter(name => ["row_version", "updated_at"].includes(name));
    if (!sameSet(part.fields, fields.filter(name => !managed.includes(name))) || !sameSet(part.serverManagedFields, managed)) fail();
    const rows = new Map(accepted.get(part.table).map(row => [row.id, row])), matched = new Set();
    if (part.rows.length !== rows.size) fail();
    for (const match of part.rows) {
      if (!record(match) || !rows.has(match.id) || matched.has(match.id) || !record(match.serverValues) || !sameSet(Object.keys(match.serverValues), managed)) fail();
      matched.add(match.id);
      for (const key of managed) {
        const value = match.serverValues[key], expected = rows.get(match.id)[key];
        if (value === null || expected === null) { if (value !== expected) fail(); }
        else if (key === "row_version") { if (decimal(value) === undefined || decimal(value) !== decimal(expected)) fail(); }
        else if (instant(value) === undefined || instant(value) !== instant(expected)) fail();
      }
    }
  }
}

function rememberLegacyRecoveryReceipt({ event, raw, registry, assertCurrent }) {
  try {
    if (typeof assertCurrent !== "function" || typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > MAX_RESPONSE_BYTES) fail();
    assertCurrent(); const identity = eventIdentity(event);
    const exact = parseExactJson(raw, { maxBytes: MAX_RESPONSE_BYTES, maxDepth: 128 });
    if (!record(exact) || decimal(exact.version) !== "1e0" || exact.provenance !== "ADMIN_REVIEWED_LEGACY" ||
        exact.financial_verification !== "UNVERIFIED_HISTORICAL" || exact.recovery_id !== event.recoveryId || exact.payload_hash !== event.payloadHash ||
        exact.evidence_hash !== event.evidenceHash || exact.cloud_witness_hash !== event.cloudWitnessHash || exact.branch_id !== event.branchId ||
        exact.terminal_id !== event.terminalId || exact.shift_id !== event.shiftId || exact.reviewer_id !== event.proof.authorId || exact.key_id !== event.proof.keyId ||
        !HASH.test(exact.accepted_token) || !HASH.test(exact.current_token) || typeof exact.superseded !== "boolean" ||
        exact.superseded !== (exact.accepted_token !== exact.current_token) || typeof exact.accepted_graph_text !== "string" ||
        !HASH.test(exact.accepted_graph_hash) || hash(exact.accepted_graph_text) !== exact.accepted_graph_hash) fail();
    const acceptedGraph = parseExactJson(exact.accepted_graph_text, { maxBytes: MAX_RESPONSE_BYTES, maxDepth: 128 });
    const accepted = graphTables(acceptedGraph, event, registry);
    bindAcceptedRequest(event, accepted, registry);
    validateCoverage(exact.coverage, accepted, registry);
    if (!record(exact.graph) || exact.graph.graphToken !== exact.current_token) fail();
    const current = graphTables(exact.graph.tables, event, registry);
    if (instant(exact.graph.closedAtRaw) !== instant(current.get("shifts")[0].closed_at)) fail();
    if (!exact.superseded) for (const name of GRAPH_TABLES) {
      const schema = registry.tables.find(table => table.cloudTable === name);
      if (!exactRows(schema, accepted.get(name), current.get(name))) fail();
    }
    assertCurrent();
    const witness = Object.freeze({});
    // Neither the exact graph nor this brand is exposed through renderer IPC.
    witnesses.set(witness, { identity, assertCurrent, receiptJson: raw });
    return witness;
  } catch (error) { if (error?.code === "ELEGACY_RECOVERY_RECEIPT") throw error; fail(); }
}

function assertLegacyRecoveryReceipt(witness, event) {
  const saved = witnesses.get(witness);
  if (!saved || saved.identity !== eventIdentity(event)) fail();
  saved.assertCurrent();
  return Object.freeze({ receiptJson: saved.receiptJson });
}

module.exports = { MAX_RESPONSE_BYTES, rememberLegacyRecoveryReceipt, assertLegacyRecoveryReceipt };
