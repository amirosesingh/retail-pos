import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ run: vi.fn(), rest: vi.fn() }));
vi.mock("@/core/api/pos-relay.server", () => ({ hasServiceKey: () => true, verifyRelayCaller: async () => ({ kind: "cashier", label: "cashier" }), runRelayOp: mocks.run, runRelayRead: vi.fn(), serviceRest: mocks.rest }));
vi.mock("../management-replica.server", () => ({ managementReplicaScope: async () => null }));
import { safeAuthorizeRelayOp, type RelayScope } from "@/core/api/relay-policy.server";
vi.mock("@/core/api/relay-policy.server", async importOriginal => {
  const actual = await importOriginal<typeof import("@/core/api/relay-policy.server")>();
  return { ...actual, resolveRelayScope: async () => ({ kind: "cashier", label: "cashier", role: "staff", roleSlug: "cashier", storeId: "A", permissions: { can_create_booking: true }, isSupervisor: false, staffUserId: "cashier" }) };
});
import { handleSyncRequest } from "../sync-endpoint.server";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.rest.mockImplementation(async (path: string) => ({ ok: true, json: async () => path.startsWith("booking_payments?") ? [] : [{ store_id: "B" }] }));
  mocks.run.mockImplementation(async (op, scope: RelayScope, ids) => {
    const decision = await safeAuthorizeRelayOp(op, scope, ids);
    return decision.ok ? { ok: true } : decision;
  });
});
const parent = (store_id: string) => ({ table: "bookings", kind: "upsert", rows: [{ id: "parent", store_id }] });
const child = { table: "booking_payments", kind: "insert", rows: [{ id: "payment", booking_id: "parent", amount: 1 }] };
async function push(ops: unknown[]) {
  const response = await handleSyncRequest(new Request("https://pos.test/api/v1/pos/sync", { method: "POST", body: JSON.stringify({ cashierToken: "valid", ops }) }));
  return response.json();
}
describe("same-batch parent ownership after execution", () => {
  it("does not trust a parent whose branch authorization failed", async () => {
    const result = await push([parent("B"), child]);
    expect(result.results.map((r: { ok: boolean }) => r.ok)).toEqual([false, false]);
  });
  it("does not trust a parent whose database write failed", async () => {
    mocks.run.mockResolvedValueOnce({ ok: false, error: "Database rejected parent" });
    const result = await push([parent("A"), child]);
    expect(result.results.map((r: { ok: boolean }) => r.ok)).toEqual([false, false]);
  });
  it("preserves successful parent-then-child insertion", async () => {
    const result = await push([parent("A"), child]);
    expect(result.results.map((r: { ok: boolean }) => r.ok)).toEqual([true, true]);
  });
  it("does not let a later parent declaration bypass an earlier child check", async () => {
    const result = await push([child, parent("B")]);
    expect(result.results.map((r: { ok: boolean }) => r.ok)).toEqual([false, false]);
  });
  it("does not reparent a foreign child onto an own-branch parent", async () => {
    mocks.rest.mockImplementation(async (path: string) => ({ ok: true, json: async () => path.startsWith("booking_payments?") ? [{ booking_id: "foreign-parent" }] : [{ store_id: path.includes("foreign-parent") ? "B" : "A" }] }));
    const result = await push([{ kind: "update", table: "booking_payments", match: { id: "foreign-child" }, values: { booking_id: "own-parent", amount: 1 } }]);
    expect(result.results[0].ok).toBe(false);
  });
  it("does not move an own-parent selection onto a foreign parent", async () => {
    mocks.rest.mockImplementation(async (path: string) => ({ ok: true, json: async () => [{ store_id: path.includes("foreign-parent") ? "B" : "A" }] }));
    const result = await push([{ kind: "update", table: "booking_payments", match: { booking_id: "own-parent" }, values: { booking_id: "foreign-parent", amount: 1 } }]);
    expect(result.results[0].ok).toBe(false);
  });
});
