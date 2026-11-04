import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { redactSyncDownload } from "../sync-download-redaction";

const state = vi.hoisted(() => ({ ready: true }));
vi.mock("../external-supabase-config", () => ({ runtimeEnvValue: () => "test-service", supabaseConfig: () => ({ url: "https://cloud.test", key: "test-public" }) }));
vi.mock("../commerce-sync-readiness.server", () => ({ commerceSyncIsolationReady: async () => state.ready }));
import { handleSyncRequest } from "../sync-endpoint.server";

const terminal = "00000000-0000-4000-8000-000000000001";
const branch = "00000000-0000-4000-8000-00000000000a";
const foreign = "00000000-0000-4000-8000-00000000000b";
const binding = "a".repeat(64), claim = "b".repeat(64);
let management = false;
let payload: unknown;
const rpc = vi.fn();
beforeEach(() => {
  management = false; state.ready = true; rpc.mockClear();
  payload = { rows: [], cursor: null };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/terminal_tokens?")) return Response.json([{ id: terminal, platform: "pc", location_id: management ? null : branch,
      status: "used", is_claimed: true, claim_proof: binding, claimed_proof_hash: binding,
      management_sync_enabled: management, management_sync_proof_hash: createHash("sha256").update(claim).digest("hex"), revoked_at: null }]);
    if (url.includes("/stores?")) return Response.json([{ id: branch }]);
    if (url.includes("/rpc/pos_sync_history_page_v1")) return Response.json({code:"PGRST202",message:"Could not find the function public.pos_sync_history_page_v1 in the schema cache"},{status:404});
    if (url.includes("/rpc/pos_sync_feed_page_v1")) return Response.json({code:"PGRST202",message:"Could not find the function public.pos_sync_feed_page_v1 in the schema cache"},{status:404});
    if (url.includes("/rpc/")) { rpc(url, JSON.parse(String(init?.body))); return Response.json(payload); }
    throw new Error("Unexpected isolated request");
  }));
});
function request(kind: "bootstrap" | "pull" | "graph", table: string, selected = branch, proof = binding) {
  const operation = kind === "bootstrap" ? { sqlServerBootstrap: { organizationId: "default", branchId: selected, table, cursor: "unchanged-cursor", historyDays: 90, limit: 100 } }
    : kind === "pull" ? { sqlServerPull: { organizationId: "default", branchId: selected, cursor: 42, limit: 100 } }
      : { sqlServerShiftGraph: { organizationId: "default", branchId: selected, shiftId: terminal } };
  return handleSyncRequest(new Request("https://pos.test/api/v1/pos/sync", { method: "POST", body: JSON.stringify({
    terminalToken: terminal, deviceBindingProof: proof, ...(management ? { deviceClaimProof: claim } : {}), ...operation,
  }) }));
}

it.each(["products", "settings_scoped", "terminal_tokens", "change_history", "pos_settings"])("preserves exact bootstrap output and RPC cursor for %s", async table => {
  for (const mode of [false, true]) for (const ready of [false, true]) {
    management = mode; state.ready = ready; rpc.mockClear();
    payload = { rows: [{ id: "fixture", key: "product_price:p", value: { ecom_price: 99, selling_price: 12 },
      stock_by_store: { a: 0, b: -1 }, ecom_price: 99, ecommerceEnabled: true, claim_proof: "fixture-secret",
      nested: { table_name: "terminal_tokens", claim_secret_hash: "fixture-secret", status: "used" } }], cursor: "next", count: 1 };
    const original = JSON.stringify(payload);
    const response = await request("bootstrap", table);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(JSON.stringify(redactSyncDownload(JSON.parse(original), table, mode || !ready)));
    expect(JSON.stringify(payload)).toBe(original);
    expect(rpc).toHaveBeenCalledWith(expect.stringContaining("/pos_sync_bootstrap"), expect.objectContaining({ p_after_cursor: "unchanged-cursor", p_limit: table === "change_history" ? 10 : 100, p_branch_id: branch }));
  }
});

it.each([false, true])("preserves pull envelope privacy and order for management=%s", async mode => {
  management = mode;
  payload = { rows: [{ table_name: "products", row_data: { id: "p", ecom_price: 10, selling_price: 7 } },
    { table_name: "terminal_tokens", row_data: { claim_proof: "fixture-secret", id: "t" } }], tombstones: [{ id: "gone" }], cursor: 99 };
  const raw = JSON.stringify(payload);
  const response = await request("pull", "");
  expect(response.status).toBe(200);
  expect(await response.text()).toBe(JSON.stringify(redactSyncDownload(JSON.parse(raw), "", mode)));
  expect(rpc).toHaveBeenCalledWith(expect.stringContaining("/pos_sync_pull"), expect.objectContaining({ p_after_cursor: 42, p_limit: 100 }));
});

it.each([false, true])("preserves per-table closing graph projection for management=%s", async mode => {
  management = mode;
  payload = { ok: true, graphToken: "unchanged", tables: [
    { table: "products", rows: [{ id: "p", ecom_price: 10, selling_price: 7 }] },
    { table: "terminal_tokens", rows: [{ id: "t", claim_proof: "fixture-secret" }] },
    { table: "settings_scoped", rows: [{ key: "product_price:p", value: [0, { ecommerceEnabled: true }] }] },
  ] };
  const { tables, ...envelope } = JSON.parse(JSON.stringify(payload));
  const expected = { ...(redactSyncDownload(envelope, "", mode) as object), tables: tables.map((part: { table: string }) => redactSyncDownload(part, part.table, mode)) };
  const response = await request("graph", "");
  expect(response.status).toBe(200);
  expect(await response.text()).toBe(JSON.stringify(expected));
});

it("still refuses a foreign Operations branch before any download RPC", async () => {
  expect((await request("bootstrap", "products", foreign)).status).toBe(403);
  expect(rpc).not.toHaveBeenCalled();
});

it("still refuses incorrect registration proof before any download RPC", async () => {
  expect((await request("bootstrap", "products", branch, "c".repeat(64))).status).toBe(401);
  expect(rpc).not.toHaveBeenCalled();
});
