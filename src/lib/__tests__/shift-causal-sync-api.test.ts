import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const require = createRequire(import.meta.url);
vi.mock("../external-supabase-config", () => ({ runtimeEnvValue: () => "test-service", supabaseConfig: () => ({ url: "https://cloud.test", key: "test-public" }) }));
vi.mock("../commerce-sync-readiness.server", () => ({ commerceSyncIsolationReady: async () => true }));
import { handleSyncRequest } from "../sync-endpoint.server";
import { syncAggregateSchema } from "../sync-shift-intent.server";
const terminal = "00000000-0000-4000-8000-000000000001", intentId = "00000000-0000-4000-8000-000000000002";
const shiftId = "00000000-0000-4000-8000-000000000003", branch = "00000000-0000-4000-8000-00000000000a";
const foreign = "00000000-0000-4000-8000-00000000000b", proof = "a".repeat(64);
const tables = ["shifts", "shift_cash_counts", "shift_reconciliations", "shift_close_events", "shift_notifications", "shift_variance_alerts"];
const operations = tables.map(table => ({ table, rows: table === "shifts" ? [{ id: shiftId, store_id: branch, status: "CLOSED", state: "CLOSED" }] : [], changes: [] }));
const frozen = () => ({ version: 1, intentId, branchId: branch, shiftId, kind: "ORIGINAL", baseToken: null, predecessorIntentId: null, predecessorIntentHash: null, operations });
function aggregate(payload = frozen()) { const { branchId: _branch, operations: _operations, ...headers } = payload; return { batchId: intentId, organizationId: "default", branchId: branch, shiftIntent: { ...headers, payloadJson: JSON.stringify(payload) } }; }
const request = (body: unknown) => handleSyncRequest(new Request("https://pos.test/api/v1/pos/sync", { method: "POST", body: JSON.stringify({ terminalToken: terminal, deviceBindingProof: proof, ...(body as object) }) }));
const rpc = vi.fn(); let active = true, registryStatus = 200, rpcStatus = 200; let rpcResponse: unknown;
beforeEach(() => {
  active = true; registryStatus = 200; rpcStatus = 200; rpcResponse = { ok: true }; rpc.mockClear();
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    if (url.includes("/terminal_tokens?")) return Response.json([{ id: terminal, platform: "pc", status: active ? "used" : "revoked", location_id: branch, is_claimed: true, claim_proof: proof }], { status: registryStatus });
    if (url.includes("/stores?")) return Response.json([{ id: branch }]);
    if (url.includes("/rpc/")) { rpc(url, JSON.parse(String(options?.body))); return Response.json(rpcResponse, { status: rpcStatus }); }
    throw new Error(`Unexpected isolated request: ${url}`);
  }));
});
describe("frozen shift intent request contract", () => {
  it("keeps preflight in standalone generated push repairs and requires the reviewed protocol prerequisite", () => {
    const script = new URL("../../../scripts/generate-supabase-sync-contract.cjs", import.meta.url), scriptRequire = createRequire(script);
    const writes = new Map<string, string>(); const fs = scriptRequire("node:fs");
    runInNewContext(readFileSync(script, "utf8"), { require: (name: string) => name === "node:fs" ? { ...fs, writeFileSync: (target: string, value: string) => writes.set(target, value) } : scriptRequire(name),
      __dirname: dirname(fileURLToPath(script)), process: { argv: ["node", fileURLToPath(script), "--push-migration", "supabase/migrations/20261102082439_shift_closing_causal_intents.sql"] }, console: { log() {} } });
    const sql = [...writes].find(([target]) => target.endsWith("20261102082439_shift_closing_causal_intents.sql"))![1];
    expect(sql).toContain("BEGIN;"); expect(sql.trimEnd()).toMatch(/COMMIT;$/); expect(sql).toContain("Reviewed SHIFT36 prerequisite");
    expect(sql.match(/PERFORM public\.pos_sync_shift_preflight\(/g)).toHaveLength(2);
    expect(sql.indexOf("Reviewed SHIFT36 prerequisite")).toBeLessThan(sql.indexOf("CREATE OR REPLACE FUNCTION public.pos_sync_push_batch"));
  });
  it("derives operations without altering the frozen UTF8 payload or request hash", () => {
    const input = aggregate(); const result = syncAggregateSchema.parse(input);
    expect(result.operations).toEqual(operations); expect(result.shiftIntent?.payloadJson).toBe(input.shiftIntent.payloadJson);
    expect(createHash("sha256").update(result.shiftIntent!.payloadJson, "utf8").digest("hex")).toBe(createHash("sha256").update(input.shiftIntent.payloadJson, "utf8").digest("hex"));
  });
  it.each(["baseToken", "intentId", "kind", "shiftId"])("rejects a changed outer %s", field => {
    const input = aggregate(); (input.shiftIntent as Record<string, unknown>)[field] = field === "baseToken" ? "a".repeat(64) : field === "kind" ? "RECOUNT" : terminal;
    expect(syncAggregateSchema.safeParse(input).success).toBe(false);
  });
  it("rejects duplicate transport operations, unknown frozen fields and incomplete preconditions", () => {
    expect(syncAggregateSchema.safeParse({ ...aggregate(), operations }).success).toBe(false);
    expect(syncAggregateSchema.safeParse(aggregate({ ...frozen(), invented: true } as ReturnType<typeof frozen>)).success).toBe(false);
    const input = aggregate(); input.shiftIntent.payloadJson = input.shiftIntent.payloadJson.replace('"predecessorIntentId":null', `"predecessorIntentId":"${terminal}"`);
    expect(syncAggregateSchema.safeParse(input).success).toBe(false);
  });
  it("preserves legacy aggregates and rejects absent operations", () => {
    expect(syncAggregateSchema.parse({ batchId: intentId, organizationId: "default", branchId: branch, operations }).operations).toEqual(operations);
    expect(syncAggregateSchema.safeParse({ batchId: intentId, organizationId: "default", branchId: branch }).success).toBe(false);
  });
});
describe("actual relay authorization and routing", () => {
  it.each(["1.4.79", "beta"])("preserves the actual %s CloudClient legacy aggregate wire contract", async version => {
    let Client;
    if (version === "1.4.79") {
      const snapshot = JSON.parse(readFileSync(new URL("./fixtures/legacy-cloud-client-1.4.79.json", import.meta.url), "utf8"));
      expect(createHash("sha256").update(snapshot.source, "utf8").digest("hex")).toBe(snapshot.sha256);
      const module = { exports: {} as { CloudClient?: unknown } };
      runInNewContext(snapshot.source, { module, exports: module.exports, require: (name: string) => name.startsWith("./") ? require("../../../electron/sync/" + name.slice(2)) : require(name),
        fetch: (...args: Parameters<typeof fetch>) => fetch(...args), AbortSignal, Buffer, URL });
      Client = module.exports.CloudClient;
    } else Client = require("../../../electron/sync/cloud-client.cjs").CloudClient;
    // Production attached its binding proof only on this existing transport
    // path. Do not bypass or pretend to fix old Operations proof omission.
    const cloud = new Client({ configStore: { get: () => "https://pos.test" }, terminalStore: { read: () => ({ tokenId: terminal, locationId: branch,
      deviceUse: version === "1.4.79" ? "management" : "operations", deviceBindingProof: proof, deviceClaimProof: proof }) } });
    const outbound = vi.fn(); const priorFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
      if (url.startsWith("https://pos.test/")) { outbound(JSON.parse(String(options?.body))); return handleSyncRequest(new Request(url, options)); }
      return priorFetch(url, options);
    }));
    await cloud.pushAggregate({ batchId: intentId, branchId: branch, operations: [{ table: "sales", rows: [], changes: [], dependencyOrder: 9, optionalOldMetadata: "preserved legacy acceptance" }] });
    expect(outbound).toHaveBeenCalledWith(expect.objectContaining({ terminalToken: terminal, deviceBindingProof: proof, sqlServerAggregate: expect.objectContaining({ batchId: intentId, branchId: branch }) }));
    expect(rpc).toHaveBeenCalledWith(expect.stringContaining("/rpc/pos_sync_push_aggregate"), expect.objectContaining({ p_branch_id: branch, p_terminal_id: terminal, p_operations: [{ table: "sales", rows: [], changes: [] }] }));
  });
  it("routes the atomic read with the verified terminal and branch", async () => {
    expect((await request({ sqlServerShiftGraph: { organizationId: "default", branchId: branch, shiftId } })).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(expect.stringContaining("/rpc/pos_sync_shift_graph"), { p_organization_id: "default", p_branch_id: branch, p_terminal_id: terminal, p_shift_id: shiftId });
  });
  it("routes frozen intents through the protected service routine", async () => {
    const input = aggregate(); expect((await request({ sqlServerAggregate: input })).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(expect.stringContaining("/rpc/pos_sync_push_shift_intent"), expect.objectContaining({ p_branch_id: branch, p_terminal_id: terminal, p_operations: null, p_shift_intent: input.shiftIntent }));
    expect(Object.keys(rpc.mock.calls[0][1]).sort()).toEqual(["p_batch_id", "p_branch_id", "p_operations", "p_organization_id", "p_shift_intent", "p_terminal_id"]);
  });
  it("applies the existing nested download policy to the graph without changing its opaque token", async () => {
    rpcResponse = { ok: true, shiftGraphVersion: 1, graphToken: "f".repeat(64), tables: [{ table: "shift_close_events", rows: [{ detail: {
      terminal: { table_name: "terminal_tokens", claim_proof: "private", claim_secret_hash: "private", claimed_proof_hash: "private", name: "Till" },
      product: { table_name: "products", ecom_price: 100, ecom_enabled: true, retail_price: 10 }, ordinary: { secret: "existing policy preserves this unrelated key" },
    } }] }] };
    const response = await request({ sqlServerShiftGraph: { organizationId: "default", branchId: branch, shiftId } });
    expect(await response.json()).toMatchObject({ graphToken: "f".repeat(64), tables: [{ table: "shift_close_events", rows: [{ detail: {
      terminal: { table_name: "terminal_tokens", name: "Till" }, product: { table_name: "products", retail_price: 10 }, ordinary: { secret: "existing policy preserves this unrelated key" },
    } }] }] });
    const serialized = JSON.stringify(await (await request({ sqlServerShiftGraph: { organizationId: "default", branchId: branch, shiftId } })).json());
    expect(serialized).not.toContain('"private"'); expect(serialized).not.toContain("ecom_price");
  });
  it("serializes the frozen graph once to PostgREST and keeps every required named argument", async () => {
    const payload = frozen(); payload.operations[0].rows[0] = { ...payload.operations[0].rows[0], detail: "x".repeat(1024 * 1024) } as typeof payload.operations[0]["rows"][0];
    const input = aggregate(payload); expect((await request({ sqlServerAggregate: input })).status).toBe(200);
    const sqlBody = rpc.mock.calls[0][1]; expect(sqlBody.p_operations).toBeNull();
    expect(new TextEncoder().encode(JSON.stringify(sqlBody)).byteLength).toBeLessThan(new TextEncoder().encode(JSON.stringify(input)).byteLength + 1024);
  });
  it("does not fall back to a legacy write when the protected RPC is unavailable", async () => {
    rpcStatus = 404; rpcResponse = { code: "PGRST202", message: "The protected routine is not installed" };
    const response = await request({ sqlServerAggregate: aggregate() }); expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "PGRST202" }); expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toContain("pos_sync_push_shift_intent");
  });
  it("denies foreign branch, revoked terminal and missing binding proof before any RPC", async () => {
    expect((await request({ sqlServerShiftGraph: { organizationId: "default", branchId: foreign, shiftId } })).status).toBe(403);
    active = false; expect((await request({ sqlServerShiftGraph: { organizationId: "default", branchId: branch, shiftId } })).status).toBe(401);
    active = true; expect((await request({ deviceBindingProof: undefined, sqlServerShiftGraph: { organizationId: "default", branchId: branch, shiftId } })).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("retains temporary authorization failures and enforces the existing envelope byte budget", async () => {
    registryStatus = 503; expect((await request({ sqlServerShiftGraph: { organizationId: "default", branchId: branch, shiftId } })).status).toBe(503);
    expect((await request({ padding: "x".repeat(8 * 1024 * 1024) })).status).toBe(413); expect(rpc).not.toHaveBeenCalled();
  });
});
