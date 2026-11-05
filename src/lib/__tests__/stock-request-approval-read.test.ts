import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RelayScope } from "@/core/api/relay-policy.server";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), scope: null as RelayScope | null, authenticated: true }));
vi.stubGlobal("fetch", mocks.fetch);
vi.mock("@/lib/external-supabase-config", () => ({ supabaseConfig: () => ({ url: "https://example.test", key: "publishable" }), runtimeEnvValue: () => "service-key" }));
vi.mock("@/core/api/pos-relay.server", async original => ({ ...await original<typeof import("@/core/api/pos-relay.server")>(),
  verifyRelayCaller: async () => { if (!mocks.authenticated) throw new Error("Invalid session"); return { kind: "cashier", label: "Fixture" }; },
}));
vi.mock("@/core/api/relay-policy.server", async original => ({ ...await original<typeof import("@/core/api/relay-policy.server")>(), resolveRelayScope: async () => mocks.scope }));
vi.mock("../management-replica.server", () => ({ managementReplicaScope: async () => null }));
import { runRelayRead } from "@/core/api/pos-relay.server";
import { handleSyncRequest } from "../sync-endpoint.server";
const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", childId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", productId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const scope: RelayScope = { kind: "cashier", label: "Till", role: "staff", roleSlug: "warehouse", storeId: "A", isSupervisor: false, branchRestricted: true, staffUserId: "verified", permissions: { can_approve_transfer: true } };
const read = { kind: "transferRequestApprovalState" as const, requestId };
const request = { id: requestId, kind: "request", status: "approved", from_store_id: "A", to_store_id: "B", source_request_id: null, cost_price: "PRIVATE" };
const child = { ...request, id: childId, kind: "transfer", source_request_id: requestId };
const line = (transfer_id: string) => ({ id: transfer_id, transfer_id, product_id: productId, quantity: 1, quantity_approved: 1, quantity_dispatched: null, quantity_received: null, quantity_verified: null, unit_cost: "PRIVATE" });
const response = (rows: unknown[], count = rows.length) => Response.json(rows, { headers: { "content-range": rows.length ? `0-${rows.length - 1}/${count}` : `*/${count}` } });
beforeEach(() => {
  vi.clearAllMocks(); mocks.authenticated = true; mocks.scope = { ...scope };
  mocks.fetch.mockImplementation(async (url: string) => url.includes("stock_transfer_items?") ? response([line(url.includes(childId) ? childId : requestId)]) : response([url.includes("source_request_id=") ? child : request]));
});
describe("central native transfer-request approval reconciliation", () => {
  it("uses the trusted source branch, full counts and only operational projected fields", async () => {
    const result = await runRelayRead(read, scope);
    expect(result.ok).toBe(true); expect(result.row).toMatchObject({ request: { id: requestId }, fulfilment: { id: childId } });
    expect(JSON.stringify(result)).not.toContain("PRIVATE"); expect(mocks.fetch).toHaveBeenCalledTimes(4);
    for (const [url, options] of mocks.fetch.mock.calls) {
      expect(url).not.toContain("select=*"); expect(url).not.toContain("unit_cost");
      if (url.includes("source_request_id=") || url.includes("stock_transfer_items?")) expect(options.headers.Prefer).toBe("count=exact");
    }
  });
  it.each([{ kind: "terminal" as const }, { stale: true }, { staffUserId: null }, { permissions: {} }, { managementReplica: true }])("denies an unverified or unpermitted context %j before reading", async changes => {
    expect(await runRelayRead(read, { ...scope, ...changes })).toMatchObject({ ok: false, code: "PERMISSION_DENIED" }); expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("keeps normal-terminal administrators and branch-assigned management within the registered/assigned source", async () => {
    for (const assigned of [{ ...scope, role: "admin", isSupervisor: true }, { ...scope, kind: "staff" as const, role: "manager", isSupervisor: true, branchRestricted: false }]) {
      mocks.fetch.mockReset().mockResolvedValueOnce(response([{ ...request, from_store_id: "B" }]));
      expect(await runRelayRead(read, assigned)).toMatchObject({ ok: false, code: "STORE_FORBIDDEN" }); expect(mocks.fetch).toHaveBeenCalledTimes(1);
    }
  });
  it("allows an authorized unassigned management approver without granting action access to others", async () => {
    expect((await runRelayRead(read, { ...scope, kind: "staff", storeId: null, role: "admin", permissions: {}, isSupervisor: true, branchRestricted: false })).ok).toBe(true);
    mocks.fetch.mockClear(); expect((await runRelayRead(read, { ...scope, storeId: null })).code).toBe("STORE_FORBIDDEN"); expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it.each(["missing count", "incomplete page", "missing quantity", "wrong parent", "duplicate child"])("rejects %s before returning an approval snapshot", async problem => {
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url.includes("stock_transfer_items?")) {
        if (problem === "missing count") return Response.json([line(requestId)]);
        if (problem === "incomplete page") return response([], 1);
        const item: Record<string, unknown> = line(url.includes(childId) ? childId : requestId);
        if (problem === "missing quantity") delete item.quantity;
        if (problem === "wrong parent") item.transfer_id = productId;
        return response([item]);
      }
      return response(url.includes("source_request_id=") ? problem === "duplicate child" ? [child, child] : [child] : [request]);
    });
    expect(await runRelayRead(read, scope)).toMatchObject({ ok: false, code: "TRANSFER_REQUEST_UNAVAILABLE" });
  });
  it("reads every line of a larger document in bounded pages, without a thousand-line cutoff", async () => {
    const items = Array.from({ length: 1005 }, (_, index) => ({ ...line(requestId),
      id: `10000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
      product_id: `20000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}` }));
    mocks.fetch.mockImplementation(async (url: string) => {
      if (!url.includes("stock_transfer_items?")) return response([url.includes("source_request_id=") ? child : request]);
      if (url.includes(childId)) return response([line(childId)]);
      const offset = Number(new URL(url).searchParams.get("offset")); return response(items.slice(offset, offset + 200), items.length);
    });
    const result = await runRelayRead(read, scope); expect(result.ok).toBe(true); expect(result.row?.requestItems).toHaveLength(1005);
    expect(mocks.fetch.mock.calls.filter(([url]) => url.includes("stock_transfer_items?") && !url.includes(childId))).toHaveLength(6);
  });
  it("requires a verified caller through the actual named endpoint and ignores forged renderer branch authority", async () => {
    const invoke = () => handleSyncRequest(new Request("https://pos.test/api/public/sync", { method: "POST", body: JSON.stringify({ cashierToken: "fixture", read: { ...read, storeId: "B" }, role: "admin" }) }));
    mocks.authenticated = false; expect((await invoke()).status).toBe(401); expect(mocks.fetch).not.toHaveBeenCalled();
    mocks.authenticated = true; mocks.scope = { ...scope, kind: "terminal", staffUserId: null }; expect((await invoke()).status).toBe(403); expect(mocks.fetch).not.toHaveBeenCalled();
    mocks.scope = { ...scope }; expect((await invoke()).status).toBe(200);
  });
});
