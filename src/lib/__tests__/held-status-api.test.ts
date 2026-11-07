import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../external-supabase-config", () => ({ runtimeEnvValue: () => "test-service", supabaseConfig: () => ({ url: "https://cloud.test", key: "test-public" }) }));
vi.mock("../commerce-sync-readiness.server", () => ({ commerceSyncIsolationReady: async () => true }));
import { handleSyncRequest } from "../sync-endpoint.server";
const { CloudClient } = createRequire(import.meta.url)("../../../electron/sync/cloud-client.cjs");
const terminal = "00000000-0000-4000-8000-000000000001", branch = "00000000-0000-4000-8000-00000000000a", other = "00000000-0000-4000-8000-00000000000b";
const binding = "a".repeat(64), secret = "b".repeat(64);
const read = { organizationId: "default", branchId: branch, tickets: [{ id: "held-1", billNo: "BILL", shiftId: null }] };
let mode: "operations" | "management", active: boolean, missingRpc: boolean, unavailable: boolean, wrongHeader: boolean;
const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
const client = (proof = binding) => new CloudClient({ connectionManager: { pool: {}, profile: { database: "isolated_held_api_fixture" } },
  configStore: { get: () => "https://pos.test" }, terminalStore: { read: () => ({ tokenId: terminal, deviceUse: mode, deviceBindingProof: proof, deviceClaimProof: secret, ...(mode === "operations" ? { locationId: branch } : {}) }) } });
const direct = (payload: Record<string, unknown>) => handleSyncRequest(new Request("https://pos.test/api/v1/pos/sync", { method: "POST", body: JSON.stringify({ terminalToken: terminal, deviceBindingProof: binding, deviceClaimProof: secret, ...payload }) }));
beforeEach(() => {
  mode = "operations"; active = true; missingRpc = false; unavailable = false; wrongHeader = false; calls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith("https://pos.test/")) return handleSyncRequest(new Request(url, init));
    if (url.includes("/terminal_tokens?")) return Response.json([{ id: terminal, platform: "pc", location_id: mode === "management" ? null : branch,
      status: active ? "used" : "revoked", is_claimed: true, revoked_at: null, claimed_proof_hash: binding, claim_proof: binding,
      management_sync_enabled: mode === "management", management_sync_proof_hash: createHash("sha256").update(secret).digest("hex") }]);
    if (url.includes("/rpc/")) {
      const name = url.split("/rpc/")[1], args = JSON.parse(String(init?.body)); calls.push({ name, args });
      expect(name).toBe("pos_sync_held_status_v1");
      if (unavailable) throw new TypeError("synthetic unavailable transport");
      if (missingRpc) return Response.json({ code: "PGRST202", message: "Could not find the fixture RPC" }, { status: 404 });
      const text = JSON.stringify({ ok: true, heldStatusVersion: 1, organizationId: args.p_organization_id, branchId: args.p_branch_id, terminalId: args.p_terminal_id, records: [] });
      return new Response(text, { headers: { "content-type": "application/json", "X-POS-Held-Status-Version": wrongHeader ? "2" : "1",
        "X-POS-Held-Status-Bytes": String(Buffer.byteLength(text)), "X-POS-Held-Status-Rows": "0" } });
    }
    throw new Error("Unexpected owned API request");
  }));
});
afterEach(() => vi.unstubAllGlobals());
describe("actual held-status native and relay admission", () => {
  it("uses the saved Operations device and paired branch without granting a business write", async () => {
    const result = await client().heldStatuses(read); expect(result.records).toEqual([]);
    expect(calls).toEqual([{ name: "pos_sync_held_status_v1", args: { p_organization_id: "default", p_branch_id: branch, p_terminal_id: terminal, p_tickets: read.tickets, p_keep_commerce: false, p_max_bytes: 2097152 } }]);
  });
  it("rejects another branch both before HTTP and at a direct signed relay boundary", async () => {
    await expect(client().heldStatuses({ ...read, branchId: other })).rejects.toMatchObject({ code: "SYNC_BRANCH_FORBIDDEN" }); expect(calls).toHaveLength(0);
    const result = await direct({ sqlServerHeldStatus: { ...read, branchId: other } }); expect(result.status).toBe(403); expect(await result.json()).toMatchObject({ code: "STORE_FORBIDDEN" }); expect(calls).toHaveLength(0);
  });
  it("rejects wrong device proof and revoked registration before querying ticket status", async () => {
    await expect(client("c".repeat(64)).heldStatuses(read)).rejects.toMatchObject({ status: 401 }); active = false;
    await expect(client().heldStatuses(read)).rejects.toMatchObject({ status: 401 }); expect(calls).toHaveLength(0);
  });
  it("does not admit Management to this Operations maintenance endpoint", async () => {
    mode = "management"; await expect(client().heldStatuses(read)).rejects.toMatchObject({ code: "SYNC_BRANCH_FORBIDDEN" });
    const result = await direct({ sqlServerHeldStatus: read }); expect(result.status).toBe(401); expect(await result.json()).toMatchObject({code:"SESSION_INVALID"}); expect(calls).toHaveLength(0);
  });
  it("rejects privacy selection, duplicate/excess tickets and a mixed write without executing any operation", async () => {
    for (const payload of [
      { sqlServerHeldStatus: { ...read, keepCommerce: true } },
      { sqlServerHeldStatus: { ...read, tickets: [read.tickets[0], read.tickets[0]] } },
      { sqlServerHeldStatus: { ...read, tickets: Array.from({ length: 101 }, (_, n) => ({ id: "held-" + n, billNo: null, shiftId: null })) } },
      { sqlServerHeldStatus: read, ops: [{ kind: "delete", table: "held_orders", match: { id: "held-1" } }] },
    ]) { expect((await direct(payload)).status).toBe(400); }
    expect(calls).toHaveLength(0);
  });
  it("keeps missing capability and unavailable transport as failures without fallback or fabricated completion", async () => {
    missingRpc = true; await expect(client().heldStatuses(read)).rejects.toMatchObject({ status: 404 });
    missingRpc = false; unavailable = true; await expect(client().heldStatuses(read)).rejects.toMatchObject({ status: 503, code: "SERVICE_UNAVAILABLE" });
    expect(calls.map(call => call.name)).toEqual(["pos_sync_held_status_v1", "pos_sync_held_status_v1"]);
  });
  it("refuses success bytes with an invalid status attestation", async () => {
    wrongHeader = true; await expect(client().heldStatuses(read)).rejects.toMatchObject({ status: 502, code: "EHELD_STATUS_PROTOCOL" });
  });
});
