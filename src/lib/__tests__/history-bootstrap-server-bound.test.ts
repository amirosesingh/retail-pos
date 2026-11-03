import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("../external-supabase-config", () => ({ runtimeEnvValue: () => "test-service", supabaseConfig: () => ({ url: "https://cloud.test", key: "test-public" }) }));
vi.mock("../commerce-sync-readiness.server", () => ({ commerceSyncIsolationReady: async () => true }));
import { handleSyncRequest } from "../sync-endpoint.server";

const require = createRequire(import.meta.url);
const currentBoot = require("../../../electron/jobs/bootstrap.cjs");
const currentVerifier = require("../../../electron/sync/verifier.cjs");
const CurrentClient = require("../../../electron/sync/cloud-client.cjs").CloudClient;
const terminal = "00000000-0000-4000-8000-000000000001";
const branch = "00000000-0000-4000-8000-00000000000a";
const foreign = "00000000-0000-4000-8000-00000000000b";
const proof = "a".repeat(64), claim = "b".repeat(64);
const snapshots = JSON.parse(readFileSync(new URL("./fixtures/legacy-bootstrap-loops-1.4.79.json", import.meta.url), "utf8"));
function captured(path: string): Record<string, unknown> {
  const snapshot = path === "electron/sync/cloud-client.cjs"
    ? JSON.parse(readFileSync(new URL("./fixtures/legacy-cloud-client-1.4.79.json", import.meta.url), "utf8")) : snapshots.files[path];
  expect(createHash("sha256").update(snapshot.source).digest("hex")).toBe(snapshot.sha256);
  const module = { exports: {} };
  runInNewContext(snapshot.source, { module, exports: module.exports, Buffer, URL, Date, AbortSignal, setTimeout, clearTimeout,
    fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
    require: (name: string) => name === "../sync/page-policy.cjs" ? captured("electron/sync/page-policy.cjs")
      : name.startsWith("../") ? require("../../../electron/" + name.slice(3))
        : name.startsWith("./") ? require("../../../electron/sync/" + name.slice(2)) : require(name),
  });
  return module.exports;
}
const legacyBoot = captured("electron/jobs/bootstrap.cjs") as typeof currentBoot;
const legacyVerifier = captured("electron/sync/verifier.cjs") as typeof currentVerifier;
const LegacyClient = captured("electron/sync/cloud-client.cjs").CloudClient as typeof CurrentClient;
const modes = ["current-operations", "current-management", "1.4.79-management"] as const;
type Mode = typeof modes[number];
const table = { cloudTable: "change_history", sqlServerTable: "change_history", dependencyOrder: 0,
  columns: [{ cloudColumn: "id", sqlServerColumn: "id", primaryKey: true, cloudType: "uuid" },
    { cloudColumn: "old_value", sqlServerColumn: "old_value", cloudType: "jsonb" }, { cloudColumn: "new_value", sqlServerColumn: "new_value", cloudType: "jsonb" }] };

function harness(mode: Mode = "current-operations", count = 53, dbMinimum = 10, protectedPages = false) {
  const management = mode !== "current-operations";
  const rows = Array.from({ length: count }, (_, index) => ({ id: `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}`, old_value: { quantity: 0 }, new_value: { quantity: index } }));
  const rpcInputs: Array<Record<string, unknown>> = [], outgoing: Array<Record<string, unknown>> = [], returned: string[] = [], events: string[] = [];
  const local = new Map<string, unknown>();
  let failAtCursor: string | null = null;
  let mutationFailure = false;
  let pendingId: string | null = null;
  let interruptProtected=false;
  const protectedInputs: Array<Record<string, unknown>> = [];
  const protectedSignals: Array<AbortSignal | null | undefined> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith("https://pos.test/")) { outgoing.push(JSON.parse(String(init?.body))); return handleSyncRequest(new Request(url, init)); }
    if (url.includes("/terminal_tokens?")) return Response.json([{ id: terminal, platform: "pc", status: "used", location_id: management ? null : branch,
      is_claimed: true, revoked_at: null, claim_proof: proof, claimed_proof_hash: proof, management_sync_enabled: management,
      management_sync_proof_hash: createHash("sha256").update(claim).digest("hex") }]);
    if (url.includes("/stores?")) return Response.json([{ id: branch }]);
    if (url.includes("/rpc/")) {
      if (url.includes("/pos_sync_history_page_v1")) {
        protectedSignals.push(init?.signal);
        const args=JSON.parse(String(init?.body)); protectedInputs.push(args);
        if (!protectedPages) return Response.json({ code: "PGRST202", message: "Could not find the function public.pos_sync_history_page_v1 in the schema cache" }, { status: 404 });
        const last=args.p_after_cursor ? JSON.parse(args.p_after_cursor).id : null;
        const start=last ? rows.findIndex(row=>row.id===last)+1 : 0;
        const page=rows.slice(start,start+3); returned.push(...page.map(row=>row.id));
        const text=JSON.stringify({rows:page,cursor:page.length===3 ? JSON.stringify({id:page.at(-1)!.id}) : null});
        const bytes=new TextEncoder().encode(text);
        const stream=interruptProtected ? new ReadableStream<Uint8Array>({start(controller){controller.enqueue(bytes.slice(0,100));controller.close();}}) : text;
        return new Response(stream,{headers:{"Content-Type":"application/json","X-POS-History-Projection":"1",
          "X-POS-History-Bytes":String(new TextEncoder().encode(text).length),"X-POS-History-Rows":String(page.length)}});
      }
      const args = JSON.parse(String(init?.body)); rpcInputs.push({ rpc: url.split("/rpc/")[1], ...args });
      if (!url.includes("/pos_sync_bootstrap")) return Response.json({ rows: [], cursor: null, ok: true, count: count });
      if (failAtCursor && args.p_after_cursor === failAtCursor) return Response.json({ error: "isolated download unavailable" }, { status: 503 });
      const effective = Math.max(dbMinimum, Number(args.p_limit));
      const last = args.p_after_cursor ? JSON.parse(args.p_after_cursor).id : null;
      const start = last ? rows.findIndex(row => row.id === last) + 1 : 0;
      const page = rows.slice(start, start + effective);
      returned.push(...page.map(row => row.id));
      // Match the RPC's effective-minimum cursor condition, including the
      // extra empty page when the final page is exactly full.
      return Response.json({ rows: page, cursor: page.length >= effective ? JSON.stringify({ id: page.at(-1)!.id }) : null });
    }
    throw new Error("Unexpected isolated request");
  });
  vi.stubGlobal("fetch", fetchMock);
  const Client = mode === "1.4.79-management" ? LegacyClient : CurrentClient;
  const cloud = new Client({ configStore: { get: () => "https://pos.test" }, terminalStore: { read: () => ({ tokenId: terminal,
    deviceUse: management ? "management" : "operations", locationId: management ? undefined : branch, deviceBindingProof: proof, deviceClaimProof: claim }) } });
  const context = { job: { dependency_index: 0, completed_rows: 0, batch_number: 0, last_committed_cursor: null as string | null },
    waitWhilePaused: vi.fn(), checkpoint: vi.fn(async (patch: object, transaction?: Transaction) => {
      if (transaction) transaction.patch = patch; else Object.assign(context.job, patch);
    }) };
  class Transaction {
    staged = new Map<string, unknown>(); patch: object = {};
    async begin() { events.push("begin"); }
    async commit() { for (const [id, value] of this.staged) local.set(id, value); Object.assign(context.job, this.patch);events.push("commit"); }
    async rollback() { this.staged.clear();events.push("rollback"); }
  }
  const connectionManager = { sql: () => ({ Transaction, ISOLATION_LEVEL: { SERIALIZABLE: 4 } }), pool: { request: () => ({ query: vi.fn(async () => ({ recordset: [{ current_version: 99 }] })) }) } };
  cloud.applyLocalBatch = vi.fn(async (transaction: Transaction, _table: unknown, batch: { rows: Array<{ row_data: { id: string } }> }) => {
    if (mutationFailure && local.size >= 10) throw new Error("isolated local write failure");
    for (const change of batch.rows) transaction.staged.set(change.row_data.id, change.row_data);
  });
  const checkpoints = { save: vi.fn(async () => { expect(local.size).toBe(count); events.push("baseline"); }) };
  const reader = { unacknowledged: vi.fn(async () => pendingId ? [JSON.stringify({ id: pendingId })] : []) };
  const boot = mode === "1.4.79-management" ? legacyBoot : currentBoot;
  const verifier = mode === "1.4.79-management" ? legacyVerifier : currentVerifier;
  return { cloud, rows, rpcInputs, protectedInputs, protectedSignals, outgoing, returned, events, local, checkpoints, reader, context, connectionManager, boot, verifier,
    registry: { tables: [table] },
    failDownloadAfterFirstPage() { failAtCursor = JSON.stringify({ id: rows[9].id }); },
    clearDownloadFailure() { failAtCursor = null; },
    failLocalAfterFirstPage() { mutationFailure = true; },
    protect(id: string) { pendingId = id; },
    interruptProtectedStream() {interruptProtected=true;},
  };
}
afterEach(() => { vi.unstubAllGlobals();vi.restoreAllMocks(); });

it("forwards the verified endpoint request's cancellation signal to protected history", async () => {
  const h = harness("current-operations", 1, 10, true);
  const controller = new AbortController();
  const request = new Request("https://pos.test/api/public/sync", { method: "POST", signal: controller.signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ terminalToken: terminal, deviceBindingProof: proof,
      sqlServerBootstrap: { organizationId: "default", branchId: branch, table: "change_history", cursor: null, historyDays: 90, limit: 100 } }) });
  expect((await handleSyncRequest(request)).status).toBe(200);
  expect(h.protectedSignals).toEqual([request.signal]);
});

it.each(modes)("follows protected short-page cursors through real %s clients", async mode => {
  const h=harness(mode,13,10,true);
  expect(await h.boot.runBootstrap({...h,branchId:branch,historyDays:90})).toMatchObject({completed:13});
  expect(h.returned).toEqual(h.rows.map(row=>row.id)); expect(h.rpcInputs).toHaveLength(0);
  expect(h.protectedInputs).toHaveLength(5);
  expect(h.protectedInputs.every(input=>input.p_keep_commerce===(mode!=="current-operations"))).toBe(true);
  expect(h.checkpoints.save).toHaveBeenCalledOnce();
});
it.each(modes)("applies a complete1.65MB protected record through real %s client",async mode=>{
  const h=harness(mode,1,10,true);
  Object.assign(h.rows[0].new_value,{note:"x".repeat(1_649_340)});
  expect(await h.boot.runBootstrap({...h,branchId:branch,historyDays:90})).toMatchObject({completed:1});
  expect(h.local.get(h.rows[0].id)).toEqual(h.rows[0]);
  expect(h.protectedInputs).toHaveLength(1); expect(h.checkpoints.save).toHaveBeenCalledOnce();
});
it.each(modes)("does not apply or acknowledge an interrupted protected body for %s",async mode=>{
  const h=harness(mode,1,10,true); h.interruptProtectedStream();
  await expect(h.boot.runBootstrap({...h,branchId:branch,historyDays:90})).rejects.toThrow();
  expect(h.local.size).toBe(0); expect(h.context.job.last_committed_cursor).toBeNull();
  expect(h.checkpoints.save).not.toHaveBeenCalled();
});

it.each([10, 25, 100, 500])("bounds only history SQL paging before RPC for incoming limit%s", async limit => {
  const h = harness();
  const result = await h.cloud.bootstrapPage({ branchId: branch, table: "change_history", historyDays: 90, cursor: null, limit });
  expect(h.rpcInputs[0]).toMatchObject({ rpc: "pos_sync_bootstrap", p_table: "change_history", p_limit: 10, p_after_cursor: null, p_branch_id: branch });
  expect(result.rows).toHaveLength(10);
  expect(result.cursor).toBe(JSON.stringify({ id: h.rows[9].id }));
  expect(h.outgoing[0].sqlServerBootstrap).toMatchObject({ limit });
});

it("keeps non-history bootstrap, pull, count and graph RPC arguments unchanged", async () => {
  const h = harness();
  await h.cloud.bootstrapPage({ branchId: branch, table: "products", historyDays: 90, cursor: null, limit: 500 });
  await h.cloud.pullBatch({ branchId: branch, cursor: 42, limit: 100 });
  await h.cloud.request({ sqlServerCounts: { organizationId: "default", branchId: branch, historyDays: 90 } });
  await h.cloud.shiftGraph({ branchId: branch, shiftId: terminal });
  expect(h.rpcInputs.map(input => [input.rpc, input.p_limit])).toEqual([["pos_sync_bootstrap", 500], ["pos_sync_pull", 100], ["pos_sync_counts", undefined], ["pos_sync_shift_graph", undefined]]);
  expect(h.rpcInputs[1].p_after_cursor).toBe(42);
});

it.each(modes)("downloads every53/253 history row through actual %s bootstrap/refresh/verifier loops", async mode => {
  for (const count of [53, 253]) for (const workflow of ["bootstrap", "refresh", "verify"]) {
    const h = harness(mode, count);
    if (workflow === "bootstrap") {
      expect(await h.boot.runBootstrap({ ...h, branchId: branch, historyDays: 90 })).toMatchObject({ completed: count });
      expect(h.checkpoints.save).toHaveBeenCalledOnce();
      expect(h.events.at(-1)).toBe("baseline");
    } else if (workflow === "refresh") {
      expect(await h.boot.refreshTable({ ...h, branchId: branch, historyDays: 90, tableName: "change_history" })).toEqual({ completed: count });
      expect(h.checkpoints.save).not.toHaveBeenCalled();
    } else {
      expect(await h.verifier.cloudSignature({ ...h, table, branchId: branch, historyDays: 90 })).toBe(h.verifier.signatureRows(table, h.rows));
    }
    expect(h.returned).toEqual(h.rows.map(row => row.id));
    expect(new Set(h.returned).size).toBe(count);
    expect(h.rpcInputs.every(input => input.p_limit === 10)).toBe(true);
    expect(h.rpcInputs).toHaveLength(Math.ceil(count / 10));
  }
});

it.each(modes)("preserves records and cursor with a legacy SQL minimum100 for %s", async mode => {
  const h = harness(mode, 253, 100);
  expect(await h.boot.runBootstrap({ ...h, branchId: branch, historyDays: 90 })).toMatchObject({ completed: 253 });
  expect(h.local.size).toBe(253);
  expect(h.returned).toEqual(h.rows.map(row => row.id));
  expect(h.rpcInputs.map(input => input.p_limit)).toEqual([10, 10, 10]);
  expect(h.rpcInputs[1].p_after_cursor).toBe(JSON.stringify({ id: h.rows[99].id }));
  expect(h.checkpoints.save).toHaveBeenCalledOnce();
});

it.each(modes)("follows the final full-page cursor through an empty page for %s", async mode => {
  for (const workflow of ["bootstrap", "refresh", "verify"]) {
    const h = harness(mode, 20);
    if (workflow === "bootstrap") {
      expect(await h.boot.runBootstrap({ ...h, branchId: branch, historyDays: 90 })).toMatchObject({ completed: 20 });
      expect(h.checkpoints.save).toHaveBeenCalledOnce();
      expect(h.events.at(-1)).toBe("baseline");
    } else if (workflow === "refresh") {
      expect(await h.boot.refreshTable({ ...h, branchId: branch, historyDays: 90, tableName: "change_history" })).toEqual({ completed: 20 });
      expect(h.checkpoints.save).not.toHaveBeenCalled();
    } else {
      expect(await h.verifier.cloudSignature({ ...h, table, branchId: branch, historyDays: 90 })).toBe(h.verifier.signatureRows(table, h.rows));
    }
    expect(h.rpcInputs.map(input => input.p_after_cursor)).toEqual([null,
      JSON.stringify({ id: h.rows[9].id }), JSON.stringify({ id: h.rows[19].id })]);
    expect(h.returned).toEqual(h.rows.map(row => row.id));
  }
});

it.each(modes)("preserves committed cursor, pending edits and baseline on failed download then retries for %s", async mode => {
  const h = harness(mode, 53);
  const protectedRow = h.rows[30];
  h.protect(protectedRow.id); h.local.set(protectedRow.id, { id: protectedRow.id, pending: true });
  h.failDownloadAfterFirstPage();
  await expect(h.boot.runBootstrap({ ...h, branchId: branch, historyDays: 90 })).rejects.toMatchObject({ status: 503 });
  expect(h.checkpoints.save).not.toHaveBeenCalled();
  expect(h.context.job.last_committed_cursor).toBe(JSON.stringify({ id: h.rows[9].id }));
  expect(h.local.size).toBe(11);
  expect(h.local.get(protectedRow.id)).toEqual({ id: protectedRow.id, pending: true });
  h.clearDownloadFailure();
  // Legacy progress counted selected/downloaded rows, while current progress
  // counts applied rows. Neither may replace the protected local edit.
  expect(await h.boot.runBootstrap({ ...h, branchId: branch, historyDays: 90 })).toMatchObject({ completed: mode === "1.4.79-management" ? 53 : 52 });
  expect(h.checkpoints.save).toHaveBeenCalledOnce();
  expect(h.local.size).toBe(53);
  expect(h.local.get(protectedRow.id)).toEqual({ id: protectedRow.id, pending: true });
  expect(h.returned).toEqual(h.rows.map(row => row.id));
});

it.each(modes)("rolls back a failed local page without establishing a CT baseline for %s", async mode => {
  const h = harness(mode, 53); h.failLocalAfterFirstPage();
  await expect(h.boot.runBootstrap({ ...h, branchId: branch, historyDays: 90 })).rejects.toThrow("isolated local write failure");
  expect(h.local.size).toBe(10);
  expect(h.events.at(-1)).toBe("rollback");
  expect(h.context.job.last_committed_cursor).toBe(JSON.stringify({ id: h.rows[9].id }));
  expect(h.checkpoints.save).not.toHaveBeenCalled();
});

it("retains branch denial before the history RPC", async () => {
  const h = harness();
  await expect(h.cloud.bootstrapPage({ branchId: foreign, table: "change_history", historyDays: 90, cursor: null, limit: 100 })).rejects.toMatchObject({ status: 403 });
  expect(h.rpcInputs).toHaveLength(0);
  expect(h.protectedInputs).toHaveLength(0);
});

it("retains invalid device-proof denial before the history RPC", async () => {
  const h = harness();
  const response = await handleSyncRequest(new Request("https://pos.test/api/v1/pos/sync", { method: "POST", body: JSON.stringify({
    terminalToken: terminal, deviceBindingProof: "c".repeat(64),
    sqlServerBootstrap: { organizationId: "default", branchId: branch, table: "change_history", historyDays: 90, cursor: null, limit: 100 },
  }) }));
  expect(response.status).toBe(401);
  expect(h.rpcInputs).toHaveLength(0);
  expect(h.protectedInputs).toHaveLength(0);
});
