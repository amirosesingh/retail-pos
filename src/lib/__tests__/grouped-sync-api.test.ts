import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_POS_RULES } from "../pos-rules";

const runtime = vi.hoisted(() => ({ env: {} as Record<string, string> }));
vi.mock("../external-supabase-config", () => ({
  runtimeEnvValue: (key: string) => runtime.env[key],
  supabaseConfig: () => ({ url: "https://cloud.test", key: "test-public" }),
}));
import { handleSyncRequest } from "../sync-endpoint.server";

const terminal = "00000000-0000-4000-8000-000000000001";
const secondTerminal = "00000000-0000-4000-8000-000000000002";
const otherTerminal = "00000000-0000-4000-8000-000000000003";
const branch = "00000000-0000-4000-8000-00000000000a";
const otherBranch = "00000000-0000-4000-8000-00000000000b";
const epoch = "00000000-0000-4000-8000-0000000000aa";
const proof = "a".repeat(64);
const afterSeq = "9007199254740992";
const next = "9007199254740993";
const upperSeq = "9007199254740994";
const read = { organizationId: "default", branchId: branch, epoch, afterSeq, upperSeq, limit: 1 };
const snapshotRead = { organizationId: "default", branchId: branch };
const change = (storeId = branch) => ({
  table_name: "pos_store_settings", entity_id: JSON.stringify({ store_id: storeId }), row_version: "7", tombstone: false,
  row_data: { ...Object.fromEntries(Object.entries(DEFAULT_POS_RULES).map(([key, value]) =>
    [key, typeof value === "number" ? String(value) : value])), store_id: storeId, row_version: "7", updated_by: null,
    updated_at: "2026-11-07T09:00:00.1234560Z", created_at: null, idle_timeout_minutes: 30 },
});
const page = () => ({
  status: "OK", scope_id: branch, epoch, next_seq: next, upper_seq: upperSeq, has_more: true,
  groups: [{ seq: next, operation_id: null, changes: [change()] }],
});
const snapshot = (storeId = branch) => {
  const manifest = JSON.stringify({ scope_id: branch, epoch, seq: next, changes: [change(storeId)] });
  return { status: "OK", scope_id: branch, epoch, seq: next, pin_id: terminal,
    expires_at: new Date(Date.now() + 5 * 60_000).toISOString(), manifest_json: manifest,
    manifest_sha256: createHash("sha256").update(manifest).digest("hex") };
};
let terminalRow: Record<string, unknown>;
let upstream: () => Response;
const requests: Array<{ url: string; args: Record<string, unknown> }> = [];
const direct = (body: Record<string, unknown>, credentials: Record<string, unknown> = {}) =>
  handleSyncRequest(new Request("https://pos.test/api/v1/pos/sync", { method: "POST",
    body: JSON.stringify({ terminalToken: terminal, deviceBindingProof: proof, ...credentials, ...body }) }));

beforeEach(() => {
  runtime.env = {
    POS_SUPABASE_SERVICE_ROLE_KEY: "test-service", POS_GROUPED_FEED_PILOT_PROJECT_URL: "https://cloud.test",
    POS_GROUPED_FEED_PILOT_TERMINAL_ID: terminal,
  };
  terminalRow = { id: terminal, platform: "pc", location_id: branch, status: "used", is_claimed: true,
    revoked_at: null, claim_proof: proof, claimed_platform: "electron" };
  upstream = () => Response.json(page());
  requests.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    requests.push({ url, args: init?.body ? JSON.parse(String(init.body)) : {} });
    if (url.includes("/terminal_tokens?")) return Response.json([terminalRow]);
    if (url.includes("/stores?")) return Response.json([{ id: branch }]);
    if (url.includes("/rpc/")) return upstream();
    throw new Error("Unexpected isolated grouped feed request");
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("isolated grouped sync relay", () => {
  it("keeps settings uploads opt-in and requires an exclusive command with person and device proofs", async () => {
    const edit = {
      organizationId: "default", branchId: branch, installationGeneration: terminal, databaseGuid: secondTerminal,
      feedEpoch: epoch, personId: otherTerminal, operationId: otherBranch, expectedVersion: 6,
      patch: { max_drawer_cash_limit: "9007199254740993.125000000002" },
    };
    const body = { sqlServerSettingsEdit: edit };
    expect((await direct(body)).status).toBe(503);
    runtime.env.POS_GROUPED_SETTINGS_EDIT_PILOT_ENABLED = "true";
    expect((await direct(body)).status).toBe(403);
    expect((await direct(body, { terminalToken: otherTerminal, accessToken: "operator" })).status).toBe(403);
    expect((await direct({ ...body, sqlServerGroupedSnapshot: snapshotRead })).status).toBe(400);
    expect((await direct(body, { sessionToken: "pin-session", accessToken: "operator" })).status).toBe(400);
    expect((await direct({
      sqlServerSettingsEdit: { ...edit, patch: { max_drawer_cash_limit: 123 } },
    })).status).toBe(400);
    expect(requests).toHaveLength(0);
  });

  it("keeps both requests off without an exact server project and pilot terminal", async () => {
    delete runtime.env.POS_GROUPED_FEED_PILOT_PROJECT_URL;
    expect((await direct({ sqlServerGroupedFeed: read })).status).toBe(503);
    runtime.env.POS_GROUPED_FEED_PILOT_PROJECT_URL = "https://different.test";
    expect((await direct({ sqlServerGroupedSnapshot: snapshotRead })).status).toBe(503);
    runtime.env.POS_GROUPED_FEED_PILOT_PROJECT_URL = "https://cloud.test";
    expect((await direct({ sqlServerGroupedFeed: read }, { terminalToken: otherBranch })).status).toBe(403);
    expect(requests).toHaveLength(0);
  });

  it("rejects mixed requests, number cursors and over-limit cursors before any I/O", async () => {
    for (const input of [
      { sqlServerGroupedFeed: read, sqlServerGroupedSnapshot: snapshotRead },
      { sqlServerGroupedSnapshot: snapshotRead, ops: [{ kind: "delete", table: "sales", match: { id: epoch } }] },
      { sqlServerGroupedFeed: { ...read, afterSeq: 7 } },
      { sqlServerGroupedFeed: { ...read, upperSeq: "9223372036854775808" } },
    ]) expect((await direct(input)).status).toBe(400);
    expect(requests).toHaveLength(0);
  });

  it("admits only the exact two configured terminals with their own verified proof and branch", async () => {
    runtime.env.POS_GROUPED_FEED_PILOT_TERMINAL_IDS = `${terminal},${secondTerminal}`;
    expect((await direct({ sqlServerGroupedFeed: read })).status).toBe(503);
    delete runtime.env.POS_GROUPED_FEED_PILOT_TERMINAL_ID;
    for (const invalid of [terminal, `${terminal},${terminal}`, `${terminal},${secondTerminal},${otherTerminal}`]) {
      runtime.env.POS_GROUPED_FEED_PILOT_TERMINAL_IDS = invalid;
      expect((await direct({ sqlServerGroupedFeed: read })).status).toBe(503);
    }
    runtime.env.POS_GROUPED_FEED_PILOT_TERMINAL_IDS = `${terminal}, ${secondTerminal}`;
    expect((await direct({ sqlServerGroupedFeed: read }, { terminalToken: otherTerminal })).status).toBe(403);
    expect(requests).toHaveLength(0);
    expect((await direct({ sqlServerGroupedFeed: read })).status).toBe(200);
    terminalRow = { ...terminalRow, id: secondTerminal, claim_proof: "b".repeat(64) };
    expect((await direct({ sqlServerGroupedFeed: read }, { terminalToken: secondTerminal })).status).toBe(401);
    const secondProof = { terminalToken: secondTerminal, deviceBindingProof: "b".repeat(64) };
    expect((await direct({ sqlServerGroupedFeed: { ...read, branchId: otherBranch } }, secondProof)).status).toBe(403);
    expect((await direct({ sqlServerGroupedFeed: read }, secondProof)).status).toBe(200);
    expect(requests.filter(call => call.url.includes("/rpc/")).map(call => call.args.p_terminal_id)).toEqual([terminal, secondTerminal]);
  });

  it("binds an exact Windows Operations branch and preserves whole groups and exact positions", async () => {
    const reply = await direct({ sqlServerGroupedFeed: read });
    expect(reply.status).toBe(200);
    expect(reply.headers.get("cache-control")).toBe("no-store");
    expect(await reply.json()).toEqual(page());
    expect(requests.filter(call => call.url.includes("/rpc/"))).toEqual([{
      url: "https://cloud.test/rest/v1/rpc/pos_sync_pull_grouped_v1", args: {
        p_organization_id: "default", p_branch_id: branch, p_terminal_id: terminal, p_binding_proof: proof,
        p_epoch: epoch, p_after_seq: afterSeq, p_upper_seq: upperSeq, p_limit: 1,
      },
    }]);
  });

  it("refuses wrong scope, invalid proof, revoked enrollment, mobile and Management without reading groups", async () => {
    expect((await direct({ sqlServerGroupedFeed: { ...read, branchId: otherBranch } })).status).toBe(403);
    expect((await direct({ sqlServerGroupedSnapshot: snapshotRead }, { deviceBindingProof: "b".repeat(64) })).status).toBe(401);
    terminalRow.status = "revoked";
    expect((await direct({ sqlServerGroupedFeed: read })).status).toBe(401);
    terminalRow.status = "used";
    terminalRow.platform = "mobile";
    terminalRow.claimed_platform = "android";
    expect((await direct({ sqlServerGroupedFeed: read })).status).toBe(403);
    terminalRow.platform = "pc";
    terminalRow.claimed_platform = "electron";
    terminalRow.location_id = null;
    terminalRow.management_registration = true;
    expect((await direct({ sqlServerGroupedSnapshot: snapshotRead })).status).toBe(401);
    expect(requests.some(call => call.url.includes("/rpc/"))).toBe(false);
  });

  it("rejects a cross-branch nested row or a mismatched upper bound and masks missing capability", async () => {
    const original = page();
    for (const invalid of [
      { ...original, groups: [{ seq: next, operation_id: null, changes: [change(otherBranch)] }] },
      { ...original, upper_seq: "9007199254740995" },
      { ...original, groups: [] },
    ]) {
      upstream = () => Response.json(invalid);
      expect((await direct({ sqlServerGroupedFeed: read })).status).toBe(502);
    }
    upstream = () => Response.json({ code: "PGRST202", details: "private fixture information" }, { status: 404 });
    const reply = await direct({ sqlServerGroupedFeed: read });
    expect(reply.status).toBe(503);
    expect(await reply.json()).toMatchObject({ code: "GROUPED_FEED_UNAVAILABLE" });
    expect(requests.filter(call => call.url.includes("/rpc/")).every(call => call.url.endsWith("pos_sync_pull_grouped_v1"))).toBe(true);
  });

  it("returns a bounded recovery status and checks the exact snapshot manifest and row scope", async () => {
    upstream = () => Response.json({ status: "SNAPSHOT_REQUIRED", reason: "REPLAY_EXPIRED" });
    const recovery = await direct({ sqlServerGroupedFeed: read });
    expect(recovery.status).toBe(409);
    expect(await recovery.json()).toEqual({ status: "SNAPSHOT_REQUIRED", reason: "REPLAY_EXPIRED" });

    const saved = snapshot();
    upstream = () => Response.json(saved);
    const reply = await direct({ sqlServerGroupedSnapshot: snapshotRead });
    expect(reply.status).toBe(200);
    expect(await reply.json()).toEqual(saved);
    expect(requests.at(-1)).toEqual({ url: "https://cloud.test/rest/v1/rpc/pos_sync_snapshot_grouped_v1", args: {
      p_organization_id: "default", p_branch_id: branch, p_terminal_id: terminal, p_binding_proof: proof,
    } });
    for (const invalid of [{ ...saved, manifest_sha256: "0".repeat(64) }, snapshot(otherBranch)]) {
      upstream = () => Response.json(invalid);
      expect((await direct({ sqlServerGroupedSnapshot: snapshotRead })).status).toBe(502);
    }
  });
});
