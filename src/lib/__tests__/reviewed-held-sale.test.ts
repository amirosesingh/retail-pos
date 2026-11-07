import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { session } = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("../external-supabase-config", () => ({ runtimeEnvValue: () => "test-service", supabaseConfig: () => ({ url: "https://cloud.test", key: "test-public" }) }));
vi.mock("../commerce-sync-readiness.server", () => ({ commerceSyncIsolationReady: async () => true }));
vi.mock("../session-guard.server", () => ({ touchSession: session }));
import { handleSyncRequest } from "../sync-endpoint.server";

const terminal = "00000000-0000-4000-8000-000000000001", branch = "00000000-0000-4000-8000-00000000000a";
const foreign = "00000000-0000-4000-8000-00000000000b", actor = "00000000-0000-4000-8000-000000000002";
const shift = "00000000-0000-4000-8000-000000000003", binding = "a".repeat(64), billNo = "BILL-1";
const read = { organizationId: "default", branchId: branch, ticketId: `D:${branch}:${billNo}`, billNo, shiftId: shift };
const activation = { id: terminal, platform: "pc", claimed_platform: "electron", location_id: branch,
  status: "used", is_claimed: true, claim_proof: binding, management_registration: false };
const account = { id: actor, user_id: "fixture.admin", role: "admin", role_slug: "admin", store_id: branch, is_active: true, permissions: {} };
const graphJson = '{"sale":{"total_amount":9007199254740993.123456789012},"items":[],"payments":[]}';
const envelope = { ...read, ok: true, version: 1, terminalId: terminal, actorId: actor, proof: "cleaned_hold", graphJson };
const request = (change: Record<string, unknown> = {}) => handleSyncRequest(new Request("https://pos.test/api/v1/pos/sync", {
  method: "POST", body: JSON.stringify({ terminalToken: terminal, deviceBindingProof: binding, sessionToken: "fixture-session", sqlServerHeldSaleReview: read, ...change }),
}));
let cloudAccount: typeof account | null, cloudDevice: typeof activation, rpc: () => Response;
const calls: Array<Record<string, unknown>> = [];

beforeEach(() => {
  cloudAccount = account; cloudDevice = activation; rpc = () => Response.json(envelope); calls.length = 0;
  session.mockReset();
  session.mockResolvedValue({ ok: true, session: { kind: "cashier", staff_user_id: account.user_id, terminal_id: terminal, branch_id: branch } });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/terminal_tokens?")) return Response.json([cloudDevice]);
    if (url.includes("/stores?")) return Response.json([{ id: branch }]);
    if (url.includes("/app_users?")) return Response.json(cloudAccount ? [cloudAccount] : []);
    if (url.endsWith("/rpc/pos_sync_held_sale_review_v1")) { calls.push(JSON.parse(String(init?.body))); return rpc(); }
    throw new Error("Unexpected synthetic hosted request");
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe("reviewed held-sale relay", () => {
  it("uses the verified person's stable ID, keeps exact graph text and disables caching", async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(envelope);
    expect(calls).toEqual([{ p_organization_id: "default", p_branch_id: branch, p_terminal_id: terminal, p_actor_id: actor,
      p_ticket_id: read.ticketId, p_bill_no: billNo, p_shift_id: shift, p_keep_commerce: false }]);
  });

  it("requires the paired PC, current Admin and stable actor before the RPC", async () => {
    expect((await request({ deviceBindingProof: "b".repeat(64) })).status).toBe(401);
    expect((await request({ sessionToken: undefined })).status).toBe(403);
    expect((await request({ terminalToken: undefined })).status).toBe(403);
    cloudDevice = { ...activation, platform: "mobile", claimed_platform: "android" };
    expect((await request()).status).toBe(403);
    cloudDevice = activation;
    cloudAccount = { ...account, role: "manager", role_slug: "supervisor", permissions: { can_reprint_bill: true } };
    expect((await request()).status).toBe(403);
    cloudAccount = { ...account, id: "legacy-no-stable-id" };
    expect((await request()).status).toBe(403);
    cloudAccount = null;
    expect((await request()).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("refuses a foreign branch, forged ticket, extra authority field and mixed operations", async () => {
    expect((await request({ sqlServerHeldSaleReview: { ...read, branchId: foreign, ticketId: `D:${foreign}:${billNo}` } })).status).toBe(403);
    for (const change of [
      { sqlServerHeldSaleReview: { ...read, ticketId: "wrong" } },
      { sqlServerHeldSaleReview: { ...read, actorId: actor } },
      { oldReceipt: { lookup: billNo, branchId: branch } },
      { ops: [{ kind: "delete", table: "held_orders", match: { id: read.ticketId } }] },
    ]) expect((await request(change)).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("keeps missing, contradictory, malformed and oversized results from becoming proof", async () => {
    rpc = () => Response.json({ ...envelope, proof: null, graphJson: null });
    expect(await (await request()).json()).toMatchObject({ ok: true, proof: null, graphJson: null });
    rpc = () => Response.json({ code: "PGRST202", details: "internal" }, { status: 404 });
    expect(await (await request()).json()).toMatchObject({ ok: false, code: "EHELD_SALE_REVIEW_CLOUD_SCHEMA" });
    rpc = () => Response.json({ code: "23514", message: "HELD_SALE_REVIEW_CONFLICT" }, { status: 400 });
    expect((await request()).status).toBe(409);
    for (const response of [{ ...envelope, actorId: foreign }, { ...envelope, proof: null }, { ...envelope, graphJson: "x".repeat(262145) },
      { ...envelope, rawTombstone: {} }]) {
      rpc = () => Response.json(response);
      expect((await request()).status).toBe(502);
    }
  });
});

describe("reviewed held-sale SQL", () => {
  it("runs the isolated SQL cases and keeps the canonical component byte-aligned", () => {
    const output = execFileSync(process.execPath, ["scripts/test-reviewed-held-sale.mjs"], { encoding: "utf8", windowsHide: true, timeout: 60_000 });
    expect(output).toContain("PASS incomplete, foreign and over-limit children remain pending");
    const migration = readFileSync("supabase/migrations/20261107060000_reviewed_held_sale_graph.sql", "utf8").replaceAll("\r\n", "\n");
    const canonical = readFileSync("supabase/schema.sql", "utf8").replaceAll("\r\n", "\n");
    const block = migration.match(/^-- REVIEWED_HELD_SALE_GRAPH_BEGIN[\s\S]+?^-- REVIEWED_HELD_SALE_GRAPH_END/m)?.[0];
    expect(block).toBeTruthy();
    expect(canonical).toContain(block!);
    const source = migration.split("$held_sale_review$")[1];
    expect(migration).toContain(createHash("md5").update(source).digest("hex"));
  }, 65_000);
});
