import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../external-supabase-config", () => ({
  runtimeEnvValue: () => "test-service",
  supabaseConfig: () => ({ url: "https://scoped-history.test", key: "test-public" }),
}));
vi.mock("../commerce-sync-readiness.server", () => ({ commerceSyncIsolationReady: async () => true }));

import { handleSyncRequest } from "../sync-endpoint.server";

const terminal = "00000000-0000-4000-8000-000000000001";
const branch = "00000000-0000-4000-8000-00000000000a";
const other = "00000000-0000-4000-8000-00000000000b";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const binding = "a".repeat(64);
const claim = "b".repeat(64);
const identity = { organizationId: "default", branchId: branch };
const proof = { terminalToken: terminal, deviceBindingProof: binding };
const marker = "X-POS-Scoped-History-Transport";
const parameters = "p_action, p_after_id, p_branch_id, p_keep_commerce, p_limit, p_organization_id, p_terminal_id, p_upper_id";

const calls: { name: string; args: Record<string, unknown> }[] = [];
const failures = new Map<string, () => Response>();
let management = false;
let registrationActive = true;
let platform = "pc";

function request(body: object) {
  return handleSyncRequest(new Request("https://pos.test/api/v1/pos/sync", {
    method: "POST", body: JSON.stringify(body),
  }));
}
function scoped(action: object, credentials: object = proof, extra: object = {}) {
  return request({ ...credentials, sqlServerScopedHistory: { ...identity, ...action }, ...extra });
}
function page(body: string, metadata: Record<string, string>) {
  return new Response(body, { headers: { "content-type": "application/json", ...metadata } });
}
function missing(name: string, message = `Could not find the function public.${name}(${parameters}) in the schema cache`) {
  return Response.json({ code: "PGRST202", message, details: null, hint: null }, { status: 404 });
}

beforeEach(() => {
  management = false;
  registrationActive = true;
  platform = "pc";
  calls.length = 0;
  failures.clear();
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    if (url.includes("/terminal_tokens?")) return Response.json([{
      id: terminal, platform, location_id: management ? null : branch, management_registration: management,
      status: registrationActive ? "used" : "revoked", is_claimed: true, revoked_at: null,
      claimed_proof_hash: binding, claim_proof: binding, management_sync_enabled: management,
      management_sync_proof_hash: createHash("sha256").update(claim).digest("hex"),
    }]);
    if (url.includes("/stores?")) return Response.json([{ id: branch }, { id: other }]);
    const name = url.split("/rpc/")[1];
    if (!name) throw new Error("Unexpected fixture request");
    const args = JSON.parse(String(options?.body));
    calls.push({ name, args });
    const failure = failures.get(name);
    if (failure) return failure();
    if (name.startsWith("pos_sync_history_index_v") || name.startsWith("pos_sync_history_rows_v")) {
      const rows = name.startsWith("pos_sync_history_rows_v");
      const version = name.endsWith("_v1") ? "1" : "2";
      return page("{}", {
        "X-POS-History-Reconcile-Version": version,
        "X-POS-History-Reconcile-Kind": rows ? "rows" : "index",
        "X-POS-History-Reconcile-Bytes": "2",
        "X-POS-History-Reconcile-Rows": rows ? "1" : "0",
      });
    }
    if (name.startsWith("pos_sync_history_page_v")) {
      const body = '{"rows":[],"cursor":null}';
      return page(body, {
        "X-POS-History-Projection": "1", "X-POS-History-Rows": "0",
        "X-POS-History-Bytes": String(Buffer.byteLength(body)),
      });
    }
    if (name.startsWith("pos_sync_feed_page_v")) return page("[]", {
      "X-POS-Feed-Projection": "1", "X-POS-Feed-Rows": "0",
      "X-POS-Feed-Bytes": "2", "X-POS-Feed-Continue": "0",
    });
    if (name === "pos_sync_counts_history_v2" || name === "pos_sync_counts")
      return Response.json([{ table_name: "change_history", row_count: 0 }]);
    throw new Error(`Unexpected fixture RPC ${name}`);
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("scoped history Worker transport", () => {
  it.each([
    [{ action: "begin" }, "pos_sync_history_index_v3", { p_action: "begin", p_after_id: null, p_upper_id: null }],
    [{ action: "page", afterId: null, upperId: id }, "pos_sync_history_index_v3", { p_action: "page", p_after_id: null, p_upper_id: id }],
    [{ action: "finish", upperId: id }, "pos_sync_history_index_v3", { p_action: "finish", p_after_id: null, p_upper_id: id }],
    [{ action: "rows", ids: [id] }, "pos_sync_history_rows_v3", { p_ids: [id] }],
    [{ action: "bootstrap", cursor: null, historyDays: 90, limit: 10 }, "pos_sync_history_page_v2", { p_history_days: 90, p_after_cursor: null }],
    [{ action: "feed", cursor: 25, limit: 100 }, "pos_sync_feed_page_v2", { p_after_cursor: 25 }],
    [{ action: "counts", historyDays: 90 }, "pos_sync_counts_history_v2", { p_history_days: 90 }],
  ])("sends only the requested scoped RPC for %j", async (action, name, args) => {
    const response = await scoped(action);
    expect(response.status).toBe(200);
    expect(response.headers.get(marker)).toBe("1");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(calls).toEqual([{ name, args: expect.objectContaining({
      p_organization_id: "default", p_branch_id: branch, p_terminal_id: terminal,
      ...(!name.includes("counts") ? { p_keep_commerce: false } : {}), ...args,
    }) }]);
  });

  it("rejects mixed operations and untrusted policy fields before authorization or normalization", async () => {
    for (const extra of [
      { ops: [] }, { managementSyncBranches: true }, { sqlServerPull: { ...identity, cursor: 0, limit: 10 } },
      { sqlServerHistoryReconcile: { ...identity, action: "begin" } }, { unknown: null },
    ]) expect((await scoped({ action: "begin" }, proof, extra)).status).toBe(400);
    expect((await scoped({ action: "begin", keepCommerce: true })).status).toBe(400);
    expect((await scoped({ action: "rows", ids: [id, id] })).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("denies an Operations request outside its verified branch, bad proof and revoked registration", async () => {
    const foreign = await scoped({ action: "begin", branchId: other });
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toMatchObject({ code: "STORE_FORBIDDEN" });
    expect((await scoped({ action: "begin" }, { ...proof, deviceBindingProof: "c".repeat(64) })).status).toBe(401);
    registrationActive = false;
    expect((await scoped({ action: "begin" })).status).toBe(401);
    expect(calls).toEqual([]);
  });

  it("admits verified Management reads and retains its established commerce projection", async () => {
    management = true;
    const response = await scoped({ action: "begin", branchId: other }, { ...proof, deviceClaimProof: claim });
    expect(response.status).toBe(200);
    expect(response.headers.get(marker)).toBe("1");
    expect(calls).toEqual([{ name: "pos_sync_history_index_v3", args: expect.objectContaining({
      p_branch_id: other, p_terminal_id: terminal, p_keep_commerce: true,
    }) }]);
  });

  it("requires the Management replica proof and refuses mobile registrations", async () => {
    management = true;
    expect((await scoped({ action: "begin" })).status).toBe(401);
    expect((await scoped({ action: "begin" }, { ...proof, deviceClaimProof: "c".repeat(64) })).status).toBe(401);
    management = false;
    platform = "mobile";
    expect((await scoped({ action: "begin" })).status).toBe(403);
    expect(calls).toEqual([]);
  });

  it("forwards bounded counts exactly and withholds the marker when counts are malformed or oversized", async () => {
    const name = "pos_sync_counts_history_v2";
    const text = '[{"table_name":"change_history","row_count":9007199254740993}]';
    failures.set(name, () => page(text, {}));
    const response = await scoped({ action: "counts", historyDays: 90 });
    expect(response.headers.get(marker)).toBe("1");
    expect(await response.text()).toBe(text);
    for (const invalid of ['{"rows":[]}', `["${"x".repeat(128 * 1024)}"]`]) {
      failures.set(name, () => page(invalid, {}));
      const failed = await scoped({ action: "counts", historyDays: 90 });
      expect(failed.status).toBe(502);
      expect(failed.headers.get(marker)).toBeNull();
    }
  });

  it("attests only the exact v3 begin absence, while missing page, rows, bootstrap, feed and counts stay errors", async () => {
    for (const name of ["pos_sync_history_index_v3", "pos_sync_history_rows_v3", "pos_sync_history_page_v2",
      "pos_sync_feed_page_v2", "pos_sync_counts_history_v2"]) failures.set(name, () => missing(name));
    const absent = await scoped({ action: "begin" });
    expect(absent.status).toBe(409);
    expect(absent.headers.get("X-POS-History-Reconcile-Version")).toBe("2");
    expect(absent.headers.get("X-POS-History-Reconcile-Kind")).toBe("unavailable");
    expect(absent.headers.get(marker)).toBeNull();
    expect(await absent.json()).toEqual({
      ok: false, code: "EHISTORY_POLICY_UNAVAILABLE", policy: "branch-history-v1",
      organization_id: "default", branch_id: branch, terminal_id: terminal,
    });
    for (const action of [
      { action: "page", upperId: id, afterId: null }, { action: "rows", ids: [id] },
      { action: "bootstrap", cursor: null, historyDays: 90, limit: 10 },
      { action: "feed", cursor: 0, limit: 10 }, { action: "counts", historyDays: 90 },
    ]) {
      const failed = await scoped(action);
      expect(failed.status).toBe(404);
      expect(failed.headers.get(marker)).toBeNull();
    }
    expect(calls.map(call => call.name)).toEqual([
      "pos_sync_history_index_v3", "pos_sync_history_index_v3", "pos_sync_history_rows_v3",
      "pos_sync_history_page_v2", "pos_sync_feed_page_v2", "pos_sync_counts_history_v2",
    ]);
    failures.set("pos_sync_history_index_v3", () => missing("pos_sync_history_index_v2"));
    expect((await scoped({ action: "begin" })).status).toBe(404);
  });

  it("keeps legacy history, feed, bootstrap and counts on their prior routes without a scoped marker", async () => {
    const operations = [
      { sqlServerHistoryReconcile: { ...identity, action: "begin" } },
      { sqlServerHistoryReconcile: { ...identity, action: "begin", accessPolicy: "branch-history-v1" } },
      { sqlServerPull: { ...identity, cursor: 0, limit: 10 } },
      { sqlServerBootstrap: { ...identity, table: "change_history", cursor: null, historyDays: 90, limit: 10 } },
      { sqlServerCounts: { ...identity, historyDays: 90 } },
    ];
    for (const operation of operations) {
      const response = await request({ ...proof, ...operation });
      expect(response.status).toBe(200);
      expect(response.headers.get(marker)).toBeNull();
    }
    expect(calls.map(call => call.name)).toEqual([
      "pos_sync_history_index_v1", "pos_sync_history_index_v2", "pos_sync_feed_page_v1",
      "pos_sync_history_page_v1", "pos_sync_counts",
    ]);
  });
});
