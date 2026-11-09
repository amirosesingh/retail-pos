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
  it("uses Worker-compatible redirect rejection without forwarding a service credential", async () => {
    upstream = () => new Response(null, { status: 307, headers: { Location: "https://redirect.fixture" } });
    const response = await direct({ sqlServerGroupedFeed: read });
    expect(response.status).toBe(503);
    const rpcRequests = vi.mocked(globalThis.fetch).mock.calls.filter(([url]) => String(url).includes("/rpc/"));
    expect(rpcRequests).toHaveLength(1);
    expect(rpcRequests[0]?.[1]?.redirect).toBe("manual");
    expect(vi.mocked(globalThis.fetch).mock.calls.some(([url]) => String(url).includes("redirect.fixture"))).toBe(false);
  });

  it("keeps extended stock and corrections behind the same exact scoped feed", async () => {
    const extended = { ...read, projection: "settings_cash_v1", extended: true };
    const body = { sqlServerGroupedFeed: extended };
    runtime.env.POS_GROUPED_CASH_SETTINGS_PILOT_ENABLED = "true";
    expect((await direct(body)).status).toBe(503);
    expect(requests).toHaveLength(0);
    runtime.env.POS_GROUPED_EXTENDED_PILOT_ENABLED = "true";
    const stock = { table_name: "products_stock", entity_id: JSON.stringify({ id: secondTerminal }),
      row_version: "5", tombstone: false, row_data: { product_id: secondTerminal, branch_balance: 8, row_version: 5 } };
    const stockGroup = { seq: next, operation_id: null, changes: [stock] };
    upstream = () => Response.json({ ...page(), groups: [stockGroup] });
    expect((await direct(body)).status).toBe(200);
    expect(requests.at(-1)?.url).toMatch(/\/pos_sync_pull_cash_settings_extended_v1$/);
    expect((await direct({ sqlServerGroupedFeed: { ...read, projection: "settings_cash_v1" } })).status).toBe(502);
    expect((await direct({ sqlServerGroupedFeed: { ...extended, branchId: otherBranch } })).status).toBe(403);
    const retired = { ...stock, tombstone: true, row_data: { product_id: secondTerminal, row_version: 5 } };
    upstream = () => Response.json({ ...page(), groups: [{ ...stockGroup, changes: [retired] }] });
    expect((await direct(body)).status).toBe(200);
    upstream = () => Response.json({ ...page(), groups: [{ ...stockGroup,
      changes: [{ ...retired, row_data: { ...retired.row_data, branch_balance: 8 } }] }] });
    expect((await direct(body)).status).toBe(502);
    const correction = { seq: next, operation_id: otherTerminal, financial: { kind: "tender_v1", sale_id: secondTerminal },
      changes: [{ ...stock, table_name: "sales",
        row_data: { id: secondTerminal, store_id: branch, row_version: 5, payment_type: "cash", payments_count: 0 } }] };
    upstream = () => Response.json({ ...page(), groups: [correction] });
    expect((await direct(body)).status).toBe(200);
    const payload_json = JSON.stringify({ scope_id: branch, epoch, seq: next, operation_id: otherTerminal,
      sale: { id: secondTerminal, store_id: branch }, items: [], tenders: [] });
    upstream = () => Response.json({ ...page(), groups: [{ ...correction,
      receipt_graph: { payload_json, payload_sha256: createHash("sha256").update(payload_json).digest("hex") } }] });
    expect((await direct(body)).status).toBe(200);
    upstream = () => Response.json({ ...page(), groups: [{ ...correction,
      receipt_graph: { payload_json, payload_sha256: "0".repeat(64) } }] });
    expect((await direct(body)).status).toBe(502);
    upstream = () => Response.json({ ...page(), groups: [correction] });
    correction.changes[0].row_data.store_id = otherBranch;
    expect((await direct(body)).status).toBe(502);
  });

  it("binds extended legacy coverage to the exact revision, including stock ledger keys", async () => {
    runtime.env.POS_GROUPED_CASH_SETTINGS_PILOT_ENABLED = "true";
    runtime.env.POS_GROUPED_EXTENDED_PILOT_ENABLED = "true";
    const entry = { table_name: "stock_delta_applied", id: secondTerminal, version: "1" };
    const body = { sqlServerCashLegacyCoverage: { ...snapshotRead, epoch, extended: true, entries: [entry] } };
    const coverage = { ...entry, seq: next, owned: true };
    upstream = () => Response.json({ status: "OK", scope_id: branch, epoch, entries: [coverage] });
    expect((await direct(body)).status).toBe(200);
    expect(requests.at(-1)?.url).toMatch(/\/pos_sync_extended_legacy_coverage_v1$/);
    expect((await direct({ sqlServerCashLegacyCoverage: { ...body.sqlServerCashLegacyCoverage, epoch: null } })).status).toBe(200);
    expect(requests.at(-1)?.args.p_epoch).toBeNull();
    upstream = () => Response.json({ status: "OK", scope_id: branch, epoch, entries: [{ ...coverage, version: "2" }] });
    expect((await direct(body)).status).toBe(502);
  });

  it("accepts scoped shift and drawer groups with exact archived evidence", async () => {
    runtime.env.POS_GROUPED_CASH_SETTINGS_PILOT_ENABLED = "true";
    runtime.env.POS_GROUPED_EXTENDED_PILOT_ENABLED = "true";
    const body = { sqlServerGroupedFeed: { ...read, projection: "settings_cash_v1", extended: true } };
    const graph_json = JSON.stringify({ branchId: branch, shiftId: secondTerminal,
      tables: ["shifts", "shift_cash_counts", "shift_reconciliations", "shift_close_events",
        "shift_notifications", "shift_variance_alerts"].map(table => ({ table, rows: [] })) });
    const shift = { seq: next, operation_id: otherTerminal, financial: { kind: "shift_v1", shift_id: secondTerminal },
      changes: [{ table_name: "shifts", entity_id: JSON.stringify({ id: secondTerminal }), row_version: "2", tombstone: false,
        row_data: { id: secondTerminal, store_id: branch, row_version: 2, graph_json,
          graph_sha256: createHash("sha256").update(graph_json).digest("hex") } }] };
    const show = (group: unknown) => { upstream = () => Response.json({ ...page(), groups: [group] }); };
    show(shift);
    expect((await direct(body)).status).toBe(200);
    shift.changes[0].row_data.graph_sha256 = "0".repeat(64);
    expect((await direct(body)).status).toBe(502);
    const drawer = { ...shift, financial: { kind: "drawer_v1", event_id: secondTerminal },
      changes: [{ ...shift.changes[0], table_name: "drawer_events",
        row_data: { id: secondTerminal, store_id: branch, note: "OPENED", terminal_id: terminal, shift_id: null,
          staff_id: null, staff_name: null, role: null, reason: "Fixture", approved_by: null, created_at: "2026-11-07T09:00:00Z" } }] };
    show(drawer);
    expect((await direct(body)).status).toBe(200);
    drawer.changes[0].row_data.store_id = otherBranch;
    expect((await direct(body)).status).toBe(502);
  });

  it("keeps a dispatch balance and audit out of the destination feed", async () => {
    runtime.env.POS_GROUPED_CASH_SETTINGS_PILOT_ENABLED = "true";
    runtime.env.POS_GROUPED_EXTENDED_PILOT_ENABLED = "true";
    const body = { sqlServerGroupedFeed: { ...read, projection: "settings_cash_v1", extended: true } };
    const show = (source: boolean, withStock: boolean) => {
      const graph_json = JSON.stringify({
        branch_id: branch,
        transfer: { id: secondTerminal, kind: "transfer", status: "dispatched", row_version: 2, ref: "ST-test",
          from_store_id: source ? branch : otherBranch, to_store_id: source ? otherBranch : branch, source_request_id: null },
        request: null,
        lines: [{ transfer_id: secondTerminal, product_id: otherTerminal, quantity_dispatched: 2 }],
        stock: withStock ? [{ product_id: otherTerminal, branch_balance: 3, row_version: 3 }] : [],
        logs: withStock ? [{ store_id: branch, activity_type: "transfer_out", reference: "ST-test", product_id: otherTerminal }] : [],
      });
      upstream = () => Response.json({ ...page(), groups: [{ seq: next, operation_id: otherTerminal,
        financial: { kind: "transfer_v1", transfer_id: secondTerminal }, changes: [{
          table_name: "stock_transfers", entity_id: JSON.stringify({ id: secondTerminal }), row_version: "2", tombstone: false,
          row_data: { id: secondTerminal, store_id: branch, row_version: 2, graph_json,
            graph_sha256: createHash("sha256").update(graph_json).digest("hex") },
        }],
      }] });
    };
    show(true, true);
    expect((await direct(body)).status).toBe(200);
    show(false, false);
    expect((await direct(body)).status).toBe(200);
    show(false, true);
    expect((await direct(body)).status).toBe(502);
  });

  it("binds paged stock recovery to its requested pin, branch, ordinal and exact payload", async () => {
    const request = { ...snapshotRead, action: "page", pinId: terminal, kind: "stock", after: "0", limit: 1 };
    expect((await direct({ sqlServerGroupedRecovery: request })).status).toBe(503);
    runtime.env.POS_GROUPED_CASH_SETTINGS_PILOT_ENABLED = "true";
    expect((await direct({ sqlServerGroupedRecovery: request, sqlServerGroupedFeed: read })).status).toBe(400);
    expect((await direct({ sqlServerGroupedRecovery: { ...request, branchId: otherBranch } })).status).toBe(403);
    const page = (extra: Record<string, unknown> = {}) => {
      const payload_json = JSON.stringify({ scope_id: branch, epoch, seq: next, pin_id: terminal, kind: "stock",
        after: "0", next: "1", total: "2", rows: [{ product_id: secondTerminal, branch_balance: 7, row_version: 3 }], ...extra });
      return { status: "OK", scope_id: branch, epoch, seq: next, pin_id: terminal,
        expires_at: new Date(Date.now() + 60_000).toISOString(), payload_json,
        payload_sha256: createHash("sha256").update(payload_json).digest("hex") };
    };
    upstream = () => Response.json(page());
    expect((await direct({ sqlServerGroupedRecovery: request })).status).toBe(200);
    expect(requests.at(-1)?.url).toMatch(/\/pos_sync_page_cash_settings_recovery_v1$/);
    for (const invalid of [{ pin_id: otherTerminal }, { next: "2" },
      { rows: [{ product_id: secondTerminal, branch_balance: 7.5, row_version: 3 }] },
      { rows: [{ product_id: secondTerminal, branch_balance: 7, row_version: 0 }] }]) {
      upstream = () => Response.json(page(invalid));
      expect((await direct({ sqlServerGroupedRecovery: request })).status).toBe(502);
    }
  });

  it("accepts cash legacy coverage only for requested receipt identities and the exact branch epoch", async () => {
    runtime.env.POS_GROUPED_CASH_SETTINGS_PILOT_ENABLED = "true";
    const key = { table_name: "sales", id: secondTerminal };
    const body = { sqlServerCashLegacyCoverage: { ...snapshotRead, epoch, entries: [key] } };
    const owner = { ...key, seq: next };
    upstream = () => Response.json({ status: "OK", scope_id: branch, epoch, entries: [owner] });
    expect((await direct(body)).status).toBe(200);
    for (const entries of [[owner, owner], [{ ...owner, id: otherTerminal }], [{ ...owner, seq: "0" }]]) {
      upstream = () => Response.json({ status: "OK", scope_id: branch, epoch, entries });
      expect((await direct(body)).status).toBe(502);
    }
    upstream = () => Response.json({ status: "OK", scope_id: branch, epoch: otherTerminal, entries: [owner] });
    expect((await direct(body)).status).toBe(502);
  });

  it("uses the mixed snapshot gateway only when enabled and never accepts a settings-only manifest for it", async () => {
    const body = { sqlServerGroupedSnapshot: { ...snapshotRead, projection: "settings_cash_v1" } };
    expect((await direct(body)).status).toBe(503);
    expect(requests).toHaveLength(0);
    runtime.env.POS_GROUPED_CASH_SETTINGS_PILOT_ENABLED = "true";
    upstream = () => Response.json(snapshot());
    expect((await direct(body)).status).toBe(502);
    expect(requests.at(-1)?.url).toMatch(/\/pos_sync_snapshot_cash_settings_v1$/);
    upstream = () => {
      const base = snapshot();
      const manifest_json = JSON.stringify({ ...JSON.parse(base.manifest_json), cash_groups: [] });
      return Response.json({ ...base, manifest_json, manifest_sha256: createHash("sha256").update(manifest_json).digest("hex") });
    };
    expect((await direct(body)).status).toBe(200);
    expect((await direct({ sqlServerGroupedSnapshot: snapshotRead })).status).toBe(502);
  });

  it("keeps cash uploads exclusive, gated and bound to the exact checkout bytes", async () => {
    const checkoutJson = JSON.stringify({ sale: { id: epoch } });
    const edit = {
      organizationId: "default", branchId: branch, installationGeneration: terminal, databaseGuid: secondTerminal,
      feedEpoch: epoch, operationId: otherTerminal, checkoutJson, attestation: {},
      checkoutSha256: createHash("sha256").update(checkoutJson).digest("hex"),
    };
    const body = { sqlServerCashCheckout: edit };
    expect((await direct(body)).status).toBe(503);
    runtime.env.POS_GROUPED_CASH_SETTINGS_PILOT_ENABLED = "true";
    expect((await direct(body)).status).toBe(503);
    runtime.env.POS_GROUPED_CASH_UPLOAD_PILOT_ENABLED = "true";
    expect((await direct(body, { accessToken: "later-uploader" })).status).toBe(400);
    expect((await direct(body, { terminalToken: otherTerminal })).status).toBe(403);
    expect((await direct({ sqlServerCashCheckout: { ...edit, checkoutJson: checkoutJson + " " } })).status).toBe(400);
    expect(requests).toHaveLength(0);
  });

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
