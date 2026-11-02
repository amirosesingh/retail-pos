import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "@/lib/csp-zod";
import { stockRequestFulfilmentId } from "../stock-request-identity";
const mocks = vi.hoisted(() => ({ native: false, relay: vi.fn(), local: vi.fn(), auth: true, from: vi.fn(), pageCount: 205, malformed: false, mode: "cloud", bridge: true }));
vi.mock("@/core/api/pos-db", () => ({ commitOps: vi.fn(), stableChildId: vi.fn() }));
vi.mock("@/core/api/db-query", () => ({ routedQuery: mocks.local }));
vi.mock("@/platform-config/platform", () => ({ isTerminalApp: () => mocks.native }));
vi.mock("@/core/local-db/db-mode", () => ({ effectiveDatabaseMode: () => mocks.mode }));
vi.mock("@/core/local-db/local-db", () => ({ localDb: () => mocks.bridge ? { query: vi.fn() } : null }));
vi.mock("@/core/api/sync-relay", () => ({ relayOp: vi.fn(), relayTransferRequestApprovalState: mocks.relay }));
vi.mock("@/integrations/supabase/external-client", () => ({ supabaseExternal: {}, authenticatedExternalClientSnapshot: async () => mocks.auth ? { from: mocks.from } : null }));
import { loadRequestApprovalState } from "../stock-transfers";
const requestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", childId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const request = { id: requestId, kind: "request", status: "approved", source_request_id: null, from_store_id: "A", to_store_id: "B", created_at: "2026-10-31T00:00:00Z" };
const child = { ...request, id: childId, kind: "transfer", source_request_id: requestId };
const uuid = (prefix: string, index: number) => `${prefix}-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
const line = (id: string, index: number) => ({ id: uuid(id === requestId ? "10000000" : "30000000", index), transfer_id: id, product_id: uuid("20000000", index), quantity: 1, quantity_approved: 1, quantity_dispatched: null, quantity_received: null, quantity_verified: null });
beforeEach(() => {
  vi.clearAllMocks(); mocks.native = false; mocks.auth = true; mocks.pageCount = 205; mocks.malformed = false; mocks.mode = "cloud"; mocks.bridge = true;
  mocks.local.mockImplementation(() => { throw new Error("Local SQL must not prove central approval state"); });
  mocks.from.mockImplementation((table: string) => {
    let key = "", value = "", start = 0, end = 199, limit = 1000;
    const chain = { select: () => chain, eq: (column: string, wanted: string) => { key = column; value = wanted; return chain; }, order: () => chain,
      limit: (size: number) => { limit = size; return chain; }, range: (from: number, to: number) => { start = from; end = to; return chain; },
      then: (resolve: (value: unknown) => unknown) => {
        const all = table === "stock_transfers" ? [key === "source_request_id" ? child : request] : Array.from({ length: value === requestId ? mocks.pageCount : 1 }, (_, index) => line(value, index));
        const data: Record<string, unknown>[] = table === "stock_transfers" ? all.slice(0, limit) : all.slice(start, end + 1);
        if (mocks.malformed && table === "stock_transfer_items") delete data[0].quantity;
        return Promise.resolve({ data, count: all.length, error: null }).then(resolve);
      } };
    return chain;
  });
});
describe("authoritative central approval state", () => {
  it("pages the entire browser document through the authenticated central client, without local SQL", async () => {
    const result = await loadRequestApprovalState(requestId.toUpperCase());
    expect(result.request.items).toHaveLength(205); expect(result.fulfilment?.id).toBe(childId);
    expect(mocks.local).not.toHaveBeenCalled(); expect(mocks.relay).not.toHaveBeenCalled();
    expect(mocks.from.mock.calls.filter(([table]) => table === "stock_transfer_items")).toHaveLength(3);
  });
  it("keeps valid documents larger than a thousand lines readable", async () => {
    mocks.pageCount = 1005; expect((await loadRequestApprovalState(requestId)).request.items).toHaveLength(1005);
  });
  it("uses verified native central state even when the local cache has no legacy child", async () => {
    mocks.native = true; mocks.relay.mockResolvedValue({ ok: true, row: { request, fulfilment: child, requestItems: [line(requestId, 0)], fulfilmentItems: [line(childId, 0)] } });
    expect((await loadRequestApprovalState(requestId)).fulfilment?.id).toBe(childId);
    expect(mocks.relay).toHaveBeenCalledExactlyOnceWith(requestId); expect(mocks.local).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled();
  });
  it.each(["unavailable", "missing quantity", "wrong parent", "fractional", "null quantity", "missing nullable column"])("fails closed for native %s state without falling back locally", async problem => {
    mocks.native = true; const item: Record<string, unknown> = line(requestId, 0);
    if (problem === "missing quantity") delete item.quantity;
    if (problem === "wrong parent") item.transfer_id = childId;
    if (problem === "fractional") item.quantity = 1.5;
    if (problem === "null quantity") item.quantity = null;
    if (problem === "missing nullable column") delete item.quantity_approved;
    mocks.relay.mockResolvedValue(problem === "unavailable" ? { ok: false } : { ok: true, row: { request, fulfilment: null, requestItems: [item], fulfilmentItems: [] } });
    await expect(loadRequestApprovalState(requestId)).rejects.toThrow(); expect(mocks.local).not.toHaveBeenCalled();
  });
  it("never substitutes anonymous access when the browser staff session is absent", async () => {
    mocks.auth = false; await expect(loadRequestApprovalState(requestId)).rejects.toThrow("verified central staff"); expect(mocks.from).not.toHaveBeenCalled();
  });
  it.each([childId, "73b5364c-0521-85a9-8862-e59a193592bd"])("treats a pending local legacy/new child %s as denial evidence when central has none", async pendingId => {
    mocks.native = true; mocks.mode = "local"; mocks.relay.mockResolvedValue({ ok: true, row: { request, fulfilment: null, requestItems: [line(requestId, 0)], fulfilmentItems: [] } });
    mocks.local.mockResolvedValue([{ ...child, id: pendingId }]);
    await expect(loadRequestApprovalState(requestId)).rejects.toThrow("pending central synchronization");
    expect(mocks.local).toHaveBeenCalledExactlyOnceWith("stock_transfers", expect.objectContaining({ match: { source_request_id: requestId }, limit: 2 }));
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("does not treat a failed local presence check as absence", async () => {
    mocks.native = true; mocks.mode = "local"; mocks.relay.mockResolvedValue({ ok: true, row: { request, fulfilment: null, requestItems: [line(requestId, 0)], fulfilmentItems: [] } });
    await expect(loadRequestApprovalState(requestId)).rejects.toThrow("Local SQL");
    mocks.bridge = false; await expect(loadRequestApprovalState(requestId)).rejects.toThrow("could not be checked");
  });
  it("accepts the new header UUID in the existing CSP/Zod validator without changing validators", async () => {
    expect(z.string().uuid().safeParse(await stockRequestFulfilmentId(requestId)).success).toBe(true);
  });
  it("fails deterministically for invalid request identities and digest failure", async () => {
    await expect(stockRequestFulfilmentId("not-a-uuid")).rejects.toThrow("identity is invalid");
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest").mockRejectedValueOnce(new Error("Fixture digest unavailable"));
    try { await expect(stockRequestFulfilmentId(requestId)).rejects.toThrow("Fixture digest unavailable"); }
    finally { digest.mockRestore(); }
  });
  it("does not fall back to a random header when cryptographic identity is unavailable", async () => {
    const crypto = globalThis.crypto; vi.stubGlobal("crypto", undefined);
    try { await expect(stockRequestFulfilmentId(requestId)).rejects.toThrow("unavailable"); }
    finally { vi.stubGlobal("crypto", crypto); }
  });
});
