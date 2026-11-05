import { createRequire } from "node:module";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const { loadRegistry } = require("../../../electron/db/schema-registry.cjs");
const { CloudClient } = require("../../../electron/sync/cloud-client.cjs");
const { rememberLegacyRecoveryReceipt, assertLegacyRecoveryReceipt } = require("../../../electron/sync/legacy-shift-recovery-receipt.cjs");
const { legacyRecoveryMessage } = require("../../../electron/security/legacy-shift-recovery-protocol.cjs");
type Row = Record<string, unknown>;
type Table = { cloudTable: string; columns: Array<{ cloudColumn: string; cloudType: string; nullable: boolean }> };
const registry: { tables: Table[] } = loadRegistry();
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const branch = id(10), terminal = id(20), shift = id(1), at = "2026-11-01T12:00:00.123456Z";
const names = ["shifts", "shift_cash_counts", "shift_reconciliations", "shift_close_events", "shift_notifications", "shift_variance_alerts"];
const hash = (raw: string) => createHash("sha256").update(raw, "utf8").digest("hex");
function fixture() {
  const row = (name: string, n: number) => {
    const schema = registry.tables.find(t => t.cloudTable === name)!;
    const result: Row = {};
    for (const column of schema.columns) {
      const type = column.cloudType;
      result[column.cloudColumn] = column.nullable ? null : type === "uuid" ? id(n) : /^(numeric|bigint|integer|smallint|real|double)/.test(type) ? 0
        : type === "boolean" ? false : /^time/.test(type) ? at : type === "date" ? "2026-11-01" : type === "jsonb" ? {} : type.endsWith("[]") ? [] : "fixture";
    }
    if (Object.hasOwn(result, "row_version")) result.row_version = 3;
    if (Object.hasOwn(result, "updated_at")) result.updated_at = at;
    return { ...result, id: id(n), store_id: branch, ...(name === "shifts" ? {} : { shift_id: shift }) };
  };
  const parent = { ...row("shifts", 1), terminal_id: terminal, status: "CLOSED", state: "CLOSED", closed_at: at,
    counted_cash: 0, final_counted_cash: 0, counted_card: null, counted_digital: null, expected_cash: 0, expected_card: 0, expected_digital: 0,
    variance_cash: 0, variance_card: null, variance_digital: null, variance_total: 0, variance_status: "NO_VARIANCE" };
  const count = { ...row("shift_cash_counts", 2), kind: "ORIGINAL", counted_cash: 0, counted_card: null, counted_digital: null };
  const recon = { ...row("shift_reconciliations", 3), count_id: id(2), counted_cash: 0, counted_card: null, counted_digital: null,
    expected_cash: 0, expected_card: 0, expected_digital: 0, variance_cash: 0, variance_card: null, variance_digital: null, variance_total: 0, variance_status: "NO_VARIANCE" };
  const tables = names.map(table => ({ table, rows: table === "shifts" ? [parent] : table === "shift_cash_counts" ? [count] : table === "shift_reconciliations" ? [recon] : [] }));
  const localGraphText = JSON.stringify(tables), cloudGraphText = "[]", recoveryId = id(30);
  const payloadJson = JSON.stringify({ version: 1, recoveryId, branchId: branch, terminalId: terminal, shiftId: shift, evidenceHash: hash(localGraphText),
    cloudWitnessHash: hash(cloudGraphText), localGraphText, cloudGraphText, reason: "Reviewed original saved closing", financialVerification: "UNVERIFIED_HISTORICAL" });
  const unsigned = { version: 1, algorithm: "Ed25519", keyId: id(40), authorId: id(50), subject: "fixture-admin", projectOrigin: "https://cloud.test",
    terminalId: terminal, branchId: branch, shiftId: shift, recoveryId, action: "LEGACY_CLOSING_RECOVERY_V1", payloadHash: hash(payloadJson) };
  const pair = generateKeyPairSync("ed25519");
  const event = { recoveryId, branchId: branch, terminalId: terminal, shiftId: shift, payloadHash: hash(payloadJson), evidenceHash: hash(localGraphText),
    cloudWitnessHash: hash(cloudGraphText), payloadJson, proof: { ...unsigned, signature: sign(null, Buffer.from(legacyRecoveryMessage(unsigned)), pair.privateKey).toString("base64url") } };
  const acceptedGraphText = JSON.stringify(tables);
  const receipt = { version: 1, recovery_id: recoveryId, payload_hash: event.payloadHash, evidence_hash: event.evidenceHash, cloud_witness_hash: event.cloudWitnessHash,
    branch_id: branch, terminal_id: terminal, shift_id: shift, reviewer_id: id(50), key_id: id(40), accepted_graph_text: acceptedGraphText,
    accepted_graph_hash: hash(acceptedGraphText), accepted_token: "a".repeat(64), current_token: "a".repeat(64), superseded: false,
    financial_verification: "UNVERIFIED_HISTORICAL", provenance: "ADMIN_REVIEWED_LEGACY",
    coverage: { version: 1, mode: "matched_request_rows", tables: tables.map(part => {
      const fields = registry.tables.find(t => t.cloudTable === part.table)!.columns.map(column => column.cloudColumn);
      const managed = fields.filter(name => ["row_version", "updated_at"].includes(name));
      return { table: part.table, fields: fields.filter(name => !managed.includes(name)), serverManagedFields: managed,
        rows: part.rows.map(saved => ({ id: saved.id, serverValues: Object.fromEntries(managed.map(name => [name, (saved as Row)[name]])) })) };
    }) },
    graph: { tables, graphToken: "a".repeat(64), closedAtRaw: at },
  };
  return { event, receipt };
}
afterEach(() => vi.unstubAllGlobals());
describe("Main-private legacy recovery acceptance", () => {
  it("requires the actual response witness and preserves exact raw receipt bytes", () => {
    const { event, receipt } = fixture(), raw = JSON.stringify(receipt), assertCurrent = vi.fn();
    const witness = rememberLegacyRecoveryReceipt({ event, raw, registry, assertCurrent });
    expect(assertLegacyRecoveryReceipt(witness, event)).toEqual({ receiptJson: raw });
    expect(assertCurrent).toHaveBeenCalledTimes(3);
    expect(() => assertLegacyRecoveryReceipt({ ok: true }, event)).toThrow();
    expect(() => assertLegacyRecoveryReceipt(structuredClone(witness), event)).toThrow();
  });
  it.each(["payload_hash", "recovery_id", "branch_id", "terminal_id", "shift_id", "reviewer_id", "key_id", "accepted_graph_hash", "financial_verification", "provenance"])("rejects a mismatched %s", field => {
    const { event, receipt } = fixture();
    (receipt as Row)[field] = "wrong";
    expect(() => rememberLegacyRecoveryReceipt({ event, raw: JSON.stringify(receipt), registry, assertCurrent() {} })).toThrow();
  });
  it("rejects incomplete coverage and incomplete or cross-branch stored graphs", () => {
    for (const kind of ["coverage", "missing-table", "cross-branch", "missing-column"]) {
      const { event, receipt } = fixture();
      if (kind === "coverage") receipt.coverage.tables[0].rows = [];
      else {
        const graph = JSON.parse(receipt.accepted_graph_text);
        if (kind === "missing-table") graph.pop();
        if (kind === "cross-branch") graph[0].rows[0].store_id = id(99);
        if (kind === "missing-column") delete graph[0].rows[0].closed_at;
        receipt.accepted_graph_text = JSON.stringify(graph); receipt.accepted_graph_hash = hash(receipt.accepted_graph_text);
      }
      expect(() => rememberLegacyRecoveryReceipt({ event, raw: JSON.stringify(receipt), registry, assertCurrent() {} })).toThrow();
    }
  });
  it("rejects source changes before metadata acknowledgement and event mutation", () => {
    const { event, receipt } = fixture(); let changed = false;
    const witness = rememberLegacyRecoveryReceipt({ event, raw: JSON.stringify(receipt), registry, assertCurrent() { if (changed) throw new Error("Source changed"); } });
    expect(() => assertLegacyRecoveryReceipt(witness, { ...event, payloadJson: event.payloadJson + " " })).toThrow();
    changed = true; expect(() => assertLegacyRecoveryReceipt(witness, event)).toThrow();
  });
  it("allows an immutable accepted receipt after a later correction without replacing its history", () => {
    const { event, receipt } = fixture(); receipt.superseded = true; receipt.current_token = "b".repeat(64); receipt.graph.graphToken = receipt.current_token;
    receipt.graph.tables = structuredClone(receipt.graph.tables); (receipt.graph.tables[0].rows[0] as Row).row_version = 5;
    const raw = JSON.stringify(receipt), witness = rememberLegacyRecoveryReceipt({ event, raw, registry, assertCurrent() {} });
    expect(assertLegacyRecoveryReceipt(witness, event).receiptJson).toBe(raw);
    expect(JSON.parse(receipt.accepted_graph_text)[0].rows[0].row_version).toBe(3);
  });
  it("does not accept changed current facts under an unsuperseded token", () => {
    const { event, receipt } = fixture(); receipt.graph.tables = structuredClone(receipt.graph.tables); (receipt.graph.tables[0].rows[0] as Row).row_version = 5;
    expect(() => rememberLegacyRecoveryReceipt({ event, raw: JSON.stringify(receipt), registry, assertCurrent() {} })).toThrow();
  });
  it("bounds malformed and oversized response bodies", () => {
    const { event } = fixture();
    for (const raw of ["{}", "{", " ".repeat(1024 * 1024 + 1)])
      expect(() => rememberLegacyRecoveryReceipt({ event, raw, registry, assertCurrent() {} })).toThrow();
  });
  it("uses the actual CloudClient transport, keeps proof bytes and returns only a private witness", async () => {
    const { event, receipt } = fixture();
    const outgoing: Row[] = [], pool = {}, manager = {}, identity = { branchId: branch, terminalId: terminal, projectOrigin: "https://cloud.test" };
    const cloud = new CloudClient({ configStore: { get: () => "https://pos.test" }, terminalStore: { read: () => ({ tokenId: terminal, deviceBindingProof: "a".repeat(64) }) } });
    cloud.financialBasisIdentity = () => ({ pool, manager, identity });
    vi.stubGlobal("fetch", vi.fn(async (_url: string, options: RequestInit) => { outgoing.push(JSON.parse(String(options.body))); return Response.json(receipt); }));
    const witness = await cloud.pushLegacyRecovery(event);
    expect(outgoing[0]).toMatchObject({ terminalToken: terminal, deviceBindingProof: "a".repeat(64), sqlServerLegacyRecovery: {
      payloadJson: event.payloadJson, attestation: event.proof, branchId: branch,
    } });
    expect(assertLegacyRecoveryReceipt(witness, event).receiptJson).toBe(JSON.stringify(receipt));
    expect(witness).toEqual({});
  });
});
