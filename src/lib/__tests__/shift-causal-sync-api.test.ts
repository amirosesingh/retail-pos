import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { financialBasisMessage,openingFinancialBasisMessage } from "../../../electron/security/shift-financial-protocol.cjs";
import { intentMessage, closingStartMessage } from "../../../electron/security/shift-author-protocol.cjs";
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
const authorId = "00000000-0000-4000-8000-000000000007", keyId = "00000000-0000-4000-8000-000000000008";
const pair = generateKeyPairSync("ed25519"), publicKey = pair.publicKey.export({ type: "spki", format: "der" }).toString("base64url");
function aggregate(payload = frozen()) {
  const { branchId: _branch, operations: _operations, ...headers } = payload, payloadJson = JSON.stringify(payload);
  const unsigned = { version: 1, algorithm: "Ed25519", keyId, authorId, subject: "fixture-author", projectOrigin: "https://cloud.test", terminalId: terminal,
    branchId: branch, shiftId, intentId, action: payload.kind, payloadHash: createHash("sha256").update(payloadJson).digest("hex") };
  return { batchId: intentId, organizationId: "default", branchId: branch, shiftIntent: { ...headers, payloadJson },
    shiftAuthor: { ...unsigned, signature: sign(null, Buffer.from(intentMessage(unsigned)), pair.privateKey).toString("base64url") } };
}
const request = (body: unknown) => handleSyncRequest(new Request("https://pos.test/api/v1/pos/sync", { method: "POST", body: JSON.stringify({ terminalToken: terminal, deviceBindingProof: proof, ...(body as object) }) }));
function startProof() {
  const payloadJson = '{ "saved": "immutable start fixture" }';
  const unsigned = { version: 1, algorithm: "Ed25519", keyId, authorId, subject: "fixture-author", projectOrigin: "https://cloud.test", terminalId: terminal,
    branchId: branch.toUpperCase(), shiftId, eventId: intentId, payloadHash: createHash("sha256").update(payloadJson).digest("hex"), payloadJson };
  return { ...unsigned, signature: sign(null, Buffer.from(closingStartMessage(unsigned)), pair.privateKey).toString("base64url") };
}
const rpc = vi.fn(); let active = true, registryStatus = 200, rpcStatus = 200, authorAllowed = true; let rpcResponse: unknown;
beforeEach(() => {
  active = true; registryStatus = 200; rpcStatus = 200; authorAllowed = true; rpcResponse = { ok: true }; rpc.mockClear();
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    if (url.includes("/terminal_tokens?")) return Response.json([{ id: terminal, platform: "pc", status: active ? "used" : "revoked", location_id: branch, is_claimed: true, claim_proof: proof }], { status: registryStatus });
    if (url.includes("/stores?")) return Response.json([{ id: branch }]);
    if (url.includes("/app_users?")) return Response.json([{ id: authorId, user_id: "fixture-author", role: "staff", role_slug: "cashier", store_id: branch, is_active: authorAllowed,
      permissions: { can_shift_cash_count: true, can_shift_cash_recount: true, can_shift_variance_approve: true } }]);
    if (url.includes("/rpc/pos_shift_author_key")) return Response.json({ terminal_enrolled: true, key: { key_id: keyId, author_id: authorId, terminal_id: terminal,
      project_origin: "https://cloud.test", public_key: publicKey, subject: "fixture-author", revoked_at: null } });
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
    expect(sql).toContain("pos_sync_shift_author_receipt_guard");
    expect(sql).toContain("pos_sync_shift_author_guard");
    const canonical = [...writes].find(([target]) => target.endsWith("schema.sql"))![1];
    expect(canonical.indexOf("-- SHIFT_CAUSAL_CONTRACT_BEGIN")).toBeLessThan(canonical.indexOf("-- SHIFT_AUTHOR_CONTRACT_BEGIN"));
    expect(canonical.indexOf("-- SHIFT_AUTHOR_CONTRACT_END")).toBeLessThan(canonical.indexOf("-- SHIFT_CORRECTION_ACTIVITY_TYPE_BEGIN"));
    expect(canonical.indexOf("-- SHIFT_CORRECTION_ACTIVITY_TYPE_END")).toBeLessThan(canonical.lastIndexOf("-- Final public-schema privilege hardening"));
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
  it("retains exact outer start proof and frozen ORIGINAL bytes through both parser passes and scope alias alignment", async () => {
    const input = { ...aggregate(), shiftClosingStart: startProof() };
    expect((await request({ sqlServerAggregate: input })).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(expect.stringContaining("pos_sync_push_started_shift_intent"), expect.objectContaining({
      p_closing_start: input.shiftClosingStart, p_shift_intent: input.shiftIntent, p_shift_author: input.shiftAuthor,
      p_start_authority: { allowed: false, code: "ESHIFT_AUTHOR_PERMISSION_REVOKED" },
    }));
  });
  it("rejects forged start signatures and changed raw bytes before any financial RPC", async () => {
    for (const patch of [{ signature: "A".repeat(86) }, { payloadJson: startProof().payloadJson + " " }])
      expect((await request({ sqlServerAggregate: { ...aggregate(), shiftClosingStart: { ...startProof(), ...patch } } })).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects start envelopes on legacy aggregates and recounts, and unknown start proof fields", () => {
    expect(syncAggregateSchema.safeParse({ batchId: intentId, organizationId: "default", branchId: branch, operations, shiftClosingStart: startProof() }).success).toBe(false);
    expect(syncAggregateSchema.safeParse({ ...aggregate({ ...frozen(), kind: "RECOUNT" }), shiftClosingStart: startProof() }).success).toBe(false);
    expect(syncAggregateSchema.safeParse({ ...aggregate(), shiftClosingStart: { ...startProof(), invented: true } }).success).toBe(false);
  });
  it("rejects unsigned v3 and modified signed bytes before invoking the financial RPC", async () => {
    const unsigned = aggregate(); delete (unsigned as Partial<typeof unsigned>).shiftAuthor;
    expect((await request({ sqlServerAggregate: unsigned })).status).toBe(400);
    const modified = aggregate(); modified.shiftIntent.payloadJson += " ";
    expect((await request({ sqlServerAggregate: modified })).status).toBe(403);
    const wrongAuthor = aggregate(); wrongAuthor.shiftAuthor.authorId = "00000000-0000-4000-8000-000000000009";
    expect((await request({ sqlServerAggregate: wrongAuthor })).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("forwards denied current-author state so SQL can atomically acknowledge an exact historical receipt", async () => {
    authorAllowed = false;
    const input = aggregate();
    expect((await request({ sqlServerAggregate: input })).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(expect.stringContaining("pos_sync_push_author_shift_intent"), expect.objectContaining({ p_shift_author: input.shiftAuthor,
      p_author_authority: { allowed: false, code: "ESHIFT_AUTHOR_REVOKED" }, p_operations: null }));
  });
  it("keeps signed scope spelling intact while resolving equivalent transport ids", async () => {
    const input = aggregate(); input.shiftAuthor.branchId = branch.toUpperCase();
    const { signature: _signature, ...unsigned } = input.shiftAuthor;
    input.shiftAuthor.signature = sign(null, Buffer.from(intentMessage(unsigned)), pair.privateKey).toString("base64url");
    expect((await request({ sqlServerAggregate: input })).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(expect.stringContaining("pos_sync_push_author_shift_intent"), expect.objectContaining({ p_shift_author: input.shiftAuthor }));
  });
  it("routes authorized summary delivery updates through atomic SQL after the existing branch policy", async () => {
    const response = await request({ ops: [{ kind: "upsert", table: "shift_notifications", rows: [{ id: intentId, shift_id: shiftId, store_id: branch, channels: ["delivered"] }] }] });
    expect(await response.json()).toMatchObject({ ok: true });
    expect(rpc).toHaveBeenCalledWith(expect.stringContaining("pos_sync_shift_author_raw_write"), { p_terminal_id: terminal,
      p_operation: expect.objectContaining({ kind: "upsert", table: "shift_notifications", rows: [expect.objectContaining({ store_id: branch, channels: ["delivered"] })] }) });
  });
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
    expect(rpc).toHaveBeenCalledWith(expect.stringContaining("/rpc/pos_sync_push_author_shift_intent"), expect.objectContaining({ p_branch_id: branch, p_terminal_id: terminal, p_operations: null, p_shift_intent: input.shiftIntent, p_shift_author: input.shiftAuthor, p_author_authority: { allowed: true, authority: expect.objectContaining({ authorId }) } }));
    expect(Object.keys(rpc.mock.calls[0][1]).sort()).toEqual(["p_author_authority", "p_batch_id", "p_branch_id", "p_operations", "p_organization_id", "p_shift_author", "p_shift_intent", "p_terminal_id"]);
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
    expect(rpc.mock.calls[0][0]).toContain("pos_sync_push_author_shift_intent");
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

function financiallyBound(input=aggregate()){
  const basisJson=JSON.stringify({prototypeVersion:2,formula:"canonical-exact-decimal-v2",branchId:branch,shiftId,openingFloat:"0",inputs:[],versionReferences:[]});
  const author=input.shiftAuthor;
  const unsigned={version:1,algorithm:"Ed25519",keyId:author.keyId,projectOrigin:author.projectOrigin,terminalId:author.terminalId,authorId:author.authorId,subject:author.subject,branchId:author.branchId,shiftId,intentId,action:author.action,graphPayloadHash:author.payloadHash,basisHash:createHash("sha256").update(basisJson).digest("hex"),serverBasisId:"00000000-0000-4000-8000-000000000009",formula:"canonical-exact-decimal-v2"};
  return {...input,shiftFinancialBasis:{basisJson,proof:{...unsigned,signature:sign(null,Buffer.from(financialBasisMessage(unsigned)),pair.privateKey).toString("base64url")}}};
}
describe("financial companion opt-in relay",()=>{
  it("verifies an opening-origin proof in its distinct domain without inventing a baseline",async()=>{
    const base=financiallyBound();
    const {serverBasisId:_basis,signature:_signature,...fields}=base.shiftFinancialBasis.proof;
    const unsigned={...fields,openingOrigin:{localAggregateId:"00000000-0000-4000-8000-000000000008",rowHash:"b".repeat(64)}};
    const proof={...unsigned,signature:sign(null,Buffer.from(openingFinancialBasisMessage(unsigned)),pair.privateKey).toString("base64url")};
    const input={...base,shiftFinancialBasis:{basisJson:base.shiftFinancialBasis.basisJson,proof}};
    expect((await request({sqlServerAggregate:input})).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(expect.stringContaining("pos_sync_push_financial_shift_intent"),expect.objectContaining({p_financial_basis:input.shiftFinancialBasis}));
    expect(proof).not.toHaveProperty("serverBasisId");
    rpc.mockClear();
    const forged={...input,shiftFinancialBasis:{...input.shiftFinancialBasis,proof:{...proof,openingOrigin:{...proof.openingOrigin,rowHash:"c".repeat(64)}}}};
    expect((await request({sqlServerAggregate:forged})).status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
    // The HTTP fixture checks authentication only; production admission must
    // separately resolve the exact immutable OPEN mapping or fail closed.
  });
  it("binds unchanged graph/basis bytes and routes only to the financial guard",async()=>{
    const input=financiallyBound();expect((await request({sqlServerAggregate:input})).status).toBe(200);
    expect(rpc).toHaveBeenCalledOnce();expect(rpc).toHaveBeenCalledWith(expect.stringContaining("pos_sync_push_financial_shift_intent"),expect.objectContaining({p_financial_basis:input.shiftFinancialBasis,p_shift_author:input.shiftAuthor,p_shift_intent:input.shiftIntent,p_closing_start:null,p_start_authority:null,p_operations:null}));
    const lookups=vi.mocked(fetch).mock.calls.filter(([url])=>String(url).includes("/rpc/pos_shift_author_key"));expect(lookups).toHaveLength(2); // Existing crypto + fresh current authority, no companion duplicate read.
  });
  it("preserves signed branch spelling while aligning transport and does not downgrade on missing RPC",async()=>{
    const base=aggregate();base.shiftAuthor.branchId=branch.toUpperCase();const {signature:_signature,...author}=base.shiftAuthor;
    base.shiftAuthor.signature=sign(null,Buffer.from(intentMessage(author)),pair.privateKey).toString("base64url");
    const input=financiallyBound(base);rpcStatus=503;rpcResponse={message:"financial RPC unavailable"};
    expect((await request({sqlServerAggregate:input})).status).toBe(503);expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith(expect.stringContaining("pos_sync_push_financial_shift_intent"),expect.objectContaining({p_financial_basis:input.shiftFinancialBasis}));
  });
  it("denies changed financial bytes, graph, author or signature before writes",async()=>{
    for(const kind of ["bytes","graph","author","signature"]){
      const input=financiallyBound();if(kind==="bytes")input.shiftFinancialBasis.basisJson+=" ";
      if(kind==="graph")input.shiftFinancialBasis.proof.graphPayloadHash="b".repeat(64);
      if(kind==="author")input.shiftFinancialBasis.proof.authorId=intentId;
      if(kind==="signature")input.shiftFinancialBasis.proof.signature=input.shiftAuthor.signature;
      expect((await request({sqlServerAggregate:input})).status).toBe(403);
    }
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects companions outside counted intents and preserves denied current-author state for exact replay",async()=>{
    const input=financiallyBound();expect(syncAggregateSchema.safeParse({...input,shiftIntent:undefined,shiftAuthor:undefined,operations}).success).toBe(false);
    expect(syncAggregateSchema.safeParse({...input,shiftFinancialBasis:{...input.shiftFinancialBasis,invented:true}}).success).toBe(false);
    authorAllowed=false;expect((await request({sqlServerAggregate:input})).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(expect.stringContaining("pos_sync_push_financial_shift_intent"),expect.objectContaining({p_author_authority:{allowed:false,code:"ESHIFT_AUTHOR_REVOKED"}}));
  });
});
