import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../external-supabase-config", () => ({ runtimeEnvValue: () => "test-service", supabaseConfig: () => ({ url: "https://cloud.test", key: "test-public" }) }));
vi.mock("../commerce-sync-readiness.server", () => ({ commerceSyncIsolationReady: async () => true }));
import { handleSyncRequest } from "../sync-endpoint.server";
const require = createRequire(import.meta.url);
const { CloudClient } = require("../../../electron/sync/cloud-client.cjs");
const terminal = "00000000-0000-4000-8000-000000000001";
const branch = "00000000-0000-4000-8000-00000000000a";
const other = "00000000-0000-4000-8000-00000000000b";
const shift = "00000000-0000-4000-8000-000000000002";
const binding = "a".repeat(64), secret = "b".repeat(64);
const baseToken = { id: terminal, platform: "pc", location_id: null, management_sync_enabled: true,
 management_sync_proof_hash: createHash("sha256").update(secret).digest("hex"), is_claimed: true,
 status: "used", revoked_at: null, claimed_proof_hash: binding };
let token: Record<string, unknown>, registryStatus: number;
const rpc = vi.fn();
const graph = () => ({ ok: true, shiftGraphVersion: 1, branchId: branch, shiftId: shift, graphToken: null,
 tables: [{ table: "terminal_tokens", rows: [{ id: "other-terminal", claim_proof: "never-download", claimed_proof_hash: "never-download", status: "used" }] }] });
beforeEach(() => {
 token = { ...baseToken }; registryStatus = 200; rpc.mockClear();
 vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
  if (url.startsWith("https://pos.test/")) return handleSyncRequest(new Request(url, options));
  if (url.includes("/terminal_tokens?")) return Response.json([token], { status: registryStatus });
  if (url.includes("/stores?")) return Response.json([{ id: branch }]);
  if (url.includes("/rpc/")) {
   rpc(url, JSON.parse(String(options?.body)));
   if (!url.includes("/pos_sync_shift_graph")) throw new Error("Unexpected mutation RPC in read fixture");
   return Response.json(graph());
  }
  throw new Error(`Unexpected isolated request: ${url}`);
 }));
});
function client(mode = "management", proof = binding, claim = secret) {
 return new CloudClient({ configStore: { get: () => "https://pos.test" }, terminalStore: { read: () => ({
  tokenId: terminal, deviceUse: mode, deviceBindingProof: proof, deviceClaimProof: claim,
  ...(mode === "operations" ? { locationId: branch } : {}),
 }) } });
}
function request(extra: Record<string, unknown> = {}) {
 return handleSyncRequest(new Request("https://pos.test/api/v1/pos/sync", { method: "POST", body: JSON.stringify({
  terminalToken: terminal, deviceBindingProof: binding, deviceClaimProof: secret,
  sqlServerShiftGraph: { organizationId: "default", branchId: branch, shiftId: shift }, ...extra,
 }) }));
}
it("routes the actual Management CloudClient graph request with the original parent token and preserves redaction", async () => {
 const result = await client().shiftGraph({ branchId: branch, shiftId: shift });
 expect(rpc).toHaveBeenCalledOnce();
 expect(rpc).toHaveBeenCalledWith(expect.stringContaining("/pos_sync_shift_graph"), {
  p_organization_id: "default", p_branch_id: branch, p_terminal_id: terminal, p_shift_id: shift,
 });
 expect(result.tables[0].rows).toEqual([{ id: "other-terminal", status: "used" }]);
});
it.each([
 { ops: [{ kind: "delete", table: "shifts", match: { id: shift } }] },
 { sqlServerBatch: { batchId: shift, organizationId: "default", branchId: branch, table: "shifts", rows: [], changes: [] } },
 { sqlServerAggregate: { batchId: shift, organizationId: "default", branchId: branch, operations: [{ table: "shifts", rows: [], changes: [] }] } },
 { read: { kind: "health" } }, { oldReceipt: { lookup: "fixture", branchId: branch } },
])("rejects a graph combined with another capability before any SQL RPC: %j", async mixed => {
 expect((await request(mixed)).status).toBe(401);
 expect(rpc).not.toHaveBeenCalled();
});
it.each([
 { platform: "mobile" }, { location_id: branch }, { management_sync_enabled: false },
 { is_claimed: false }, { status: "revoked" }, { revoked_at: "2026-11-03" },
])("retains device eligibility denial for graph downloads: %j", async patch => {
 token = { ...token, ...patch };
 await expect(client().shiftGraph({ branchId: branch, shiftId: shift })).rejects.toMatchObject({ status: 401 });
 expect(rpc).not.toHaveBeenCalled();
});
it("rejects wrong binding and replica secret, including the QR public hash", async () => {
 for (const cloud of [client("management", "c".repeat(64)), client("management", binding, "c".repeat(64)),
  client("management", binding, String(baseToken.management_sync_proof_hash))]) {
  await expect(cloud.shiftGraph({ branchId: branch, shiftId: shift })).rejects.toMatchObject({ status: 401 });
 }
 expect(rpc).not.toHaveBeenCalled();
});
it("keeps registration outages distinct from authorization refusal", async () => {
 registryStatus = 503;
 await expect(client().shiftGraph({ branchId: branch, shiftId: shift })).rejects.toMatchObject({ status: 503, code: "SERVICE_UNAVAILABLE" });
 expect(rpc).not.toHaveBeenCalled();
});
it("retains Operations own-branch graph reads and denies another branch before SQL", async () => {
 token = { ...token, location_id: branch, claim_proof: binding };
 await client("operations").shiftGraph({ branchId: branch, shiftId: shift });
 expect(rpc).toHaveBeenCalledOnce(); rpc.mockClear();
 await expect(client("operations").shiftGraph({ branchId: other, shiftId: shift })).rejects.toMatchObject({ status: 403, code: "STORE_FORBIDDEN" });
 expect(rpc).not.toHaveBeenCalled();
});
it("validates the graph envelope before any SQL request", async () => {
 expect((await request({ sqlServerShiftGraph: { organizationId: "default", branchId: branch, shiftId: "invalid" } })).status).toBe(400);
 expect(rpc).not.toHaveBeenCalled();
});
