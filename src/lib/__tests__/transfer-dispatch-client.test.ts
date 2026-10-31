import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ native: false, epoch: 1, rpc: vi.fn(), relay: vi.fn() }));
vi.mock("@/integrations/supabase/external-client", () => ({ supabaseExternal: { rpc: mocks.rpc } }));
vi.mock("@/platform-config/platform", () => ({ isTerminalApp: () => mocks.native }));
vi.mock("@/core/api/sync-relay", () => ({ relayOp: mocks.relay }));
vi.mock("@/core/api/pos-db", () => ({ commitOps: vi.fn(), stableChildId: vi.fn() }));
vi.mock("@/core/api/db-query", () => ({ routedQuery: vi.fn() }));
vi.mock("@/lib/notify", () => ({ describeError: vi.fn(() => "Safe operation failure") }));
vi.mock("@/lib/session-epoch", () => ({ sessionEpoch: () => mocks.epoch }));
import { dispatchTransferInDb, type LineQty } from "../stock-transfers";
import { readDispatchProof, reconcileDispatchProducts, type DispatchProof } from "../transfer-dispatch-result";
import type { Product } from "@/core/types/pos-types";

const id = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const productId = "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb";
const requestId = "cccccccc-cccc-4ccc-cccc-cccccccccccc";
const expected = { id, fromStoreId: "source", toStoreId: "destination", sourceRequestId: requestId };
const lines = [{ productId, qty: 1 }];
const proof = (patch: Partial<DispatchProof> = {}): DispatchProof => ({ version: 1, transfer_id: id,
  from_store_id: "source", to_store_id: "destination", status: "dispatched", dispatched_at: "2026-10-31T03:00:00Z",
  dispatched_by: "Original dispatcher", source_request_id: requestId, request_closed: true, request_closed_at: "2026-10-31T03:00:00Z",
  fulfilment: "full", request_fulfilment: "partial", replayed: false, lines: [{ product_id: productId, qty: 1, source_stock: 0 }], ...patch });

beforeEach(() => { vi.resetAllMocks(); mocks.native = false; mocks.epoch = 1; });
describe("atomic dispatch client transport and recovery", () => {
  it("uses the upgraded web function and returns only a validated exact proof", async () => {
    mocks.rpc.mockResolvedValue({ data: { ...proof(), stock_by_store: { foreign: 99 } }, error: null });
    const result = await dispatchTransferInDb(id, "Display name", lines, expected);
    expect(result).toEqual({ success: true, dispatch: proof() });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("stock_transfer_dispatch_atomic", { p_transfer_id: id, p_dispatched_by: "Display name", p_lines: [{ product_id: productId, qty: 1 }] });
    expect(mocks.relay).not.toHaveBeenCalled();
  });
  it.each(["Android", "iOS", "Electron"])("uses the verified relay path on %s", async () => {
    mocks.native = true; mocks.relay.mockResolvedValue({ ok: true, data: proof() });
    await expect(dispatchTransferInDb(id, "Display name", lines, expected)).resolves.toMatchObject({ success: true });
    expect(mocks.relay).toHaveBeenCalledWith({ kind: "rpc", table: "stock_transfers", fn: "stock_transfer_dispatch_atomic", args: expect.objectContaining({ p_transfer_id: id }) });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([false, true])("keeps shortage code and safe guidance (native=%s), with no retry", async native => {
    mocks.native = native;
    const error = { code: "23514", message: "Short by 1 of PRIVATE PRODUCT at the sending branch" };
    mocks.rpc.mockResolvedValue({ data: null, error }); mocks.relay.mockResolvedValue({ ok: false, code: error.code, error: error.message });
    const result = await dispatchTransferInDb(id, "Display name", lines, expected);
    expect(result).toMatchObject({ success: false, code: "TRANSFER_INSUFFICIENT_STOCK" });
    expect(result.error).toContain("Not enough stock"); expect(result.error).not.toContain("PRIVATE PRODUCT");
    expect(native ? mocks.relay : mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it.each(["PERMISSION_DENIED", "STORE_FORBIDDEN", "42501"])("preserves denial %s without retrying or claiming success", async code => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "sensitive SQL detail" } });
    await expect(dispatchTransferInDb(id, "Staff", lines, expected)).resolves.toMatchObject({ success: false, code: "PERMISSION_DENIED" });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("fails closed on a missing upgrade instead of using the old void dispatch", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find function" } });
    await expect(dispatchTransferInDb(id, "Staff", lines, expected)).resolves.toMatchObject({ success: false, code: "TRANSFER_DISPATCH_UPGRADE_REQUIRED" });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("reports an older native relay's missing function allowlist as an upgrade requirement", async () => {
    mocks.native = true; mocks.relay.mockResolvedValue({ ok: false, code: "TABLE_FORBIDDEN", error: "Unknown function" });
    await expect(dispatchTransferInDb(id, "Staff", lines, expected)).resolves.toMatchObject({ success: false, code: "TRANSFER_DISPATCH_UPGRADE_REQUIRED" });
    expect(mocks.relay).toHaveBeenCalledTimes(1);
  });
  it("reconciles a lost response using exactly the same upgraded request and saved proof", async () => {
    mocks.rpc.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce({ data: proof({ replayed: true }), error: null });
    await expect(dispatchTransferInDb(id, "Staff", lines, expected)).resolves.toEqual({ success: true, dispatch: proof({ replayed: true }) });
    expect(mocks.rpc).toHaveBeenCalledTimes(2); expect(mocks.rpc.mock.calls[0]).toEqual(mocks.rpc.mock.calls[1]);
  });
  it("reconciles native transport timeout without changing arguments", async () => {
    mocks.native = true;
    mocks.relay.mockResolvedValueOnce({ ok: false, code: "ETIMEDOUT", error: "network timeout" }).mockResolvedValueOnce({ ok: true, data: proof({ replayed: true, status: "received" }) });
    await expect(dispatchTransferInDb(id, "Staff", lines, expected)).resolves.toMatchObject({ success: true, dispatch: { status: "received", replayed: true } });
    expect(mocks.relay.mock.calls[0]).toEqual(mocks.relay.mock.calls[1]);
  });
  it("does not send another request after the signed-in session changes", async () => {
    mocks.rpc.mockImplementationOnce(async () => { mocks.epoch++; throw new TypeError("Failed to fetch"); });
    await expect(dispatchTransferInDb(id, "Staff", lines, expected)).resolves.toMatchObject({ success: false, code: "SESSION_CHANGED" });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it.each([
    { from_store_id: "foreign" }, { to_store_id: "foreign" }, { transfer_id: requestId }, { source_request_id: null },
    { request_closed: false }, { request_closed_at: null }, { lines: [{ product_id: productId, qty: 2, source_stock: 0 }] },
    { lines: [{ product_id: productId, qty: 1, source_stock: "0" }] },
  ])("rejects mismatched or incomplete proof %# without displaying backend data", async patch => {
    mocks.rpc.mockResolvedValue({ data: { ...proof(), ...patch }, error: null });
    await expect(dispatchTransferInDb(id, "Staff", lines, expected)).resolves.toMatchObject({ success: false, code: "TRANSFER_DISPATCH_UNCONFIRMED" });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it("does not expose arbitrary SQL text or pretend a malformed success committed", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "SELECT private_pin_hash FROM app_users" } });
    const result = await dispatchTransferInDb(id, "Staff", lines, expected);
    expect(result.error).not.toMatch(/SELECT|private_pin_hash|app_users/);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(dispatchTransferInDb(id, "Staff", lines, expected)).resolves.toMatchObject({ success: false, code: "TRANSFER_DISPATCH_UNCONFIRMED" });
  });
  it("does not submit inconsistent caller context", async () => {
    await expect(dispatchTransferInDb(id, "Staff", lines, { ...expected, id: requestId })).resolves.toMatchObject({ success: false, code: "TRANSFER_DISPATCH_CONFLICT" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([undefined, [], new Array(1), [{ productId, qty: 0.5 }], [{ productId, qty: -1 }], [{ productId, qty: NaN }],
    [{ productId, qty: 1 }, { productId: productId.toUpperCase(), qty: 1 }]])("refuses an absent or invalid explicit line snapshot %# before any request", async input => {
    await expect(dispatchTransferInDb(id, "Staff", input as LineQty[], expected)).resolves.toMatchObject({ success: false, code: "TRANSFER_DISPATCH_CONFLICT" });
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.relay).not.toHaveBeenCalled();
  });
  it.each([false, true])("accepts canonical SQL proof for uppercase input UUIDs (native=%s)", async native => {
    mocks.native = native; mocks.rpc.mockResolvedValue({ data: proof(), error: null }); mocks.relay.mockResolvedValue({ ok: true, data: proof() });
    await expect(dispatchTransferInDb(id, "Staff", [{ productId: productId.toUpperCase(), qty: 1 }], expected)).resolves.toMatchObject({ success: true });
    const call = (native ? mocks.relay : mocks.rpc).mock.calls[0];
    expect(native ? call[0].args.p_lines : call[1].p_lines).toEqual([{ product_id: productId.toUpperCase(), qty: 1 }]);
  });
});

describe("dispatch cache proof safety", () => {
  const product = (): Product => ({ id: productId, name: "Item", sku: "1", barcode: "1", category: "Default", price: 1, cost: 1, reorderLevel: 0, taxRate: 0, stockByStore: { source: 0, warehouse: 5, foreign: 7 } });
  it("sets the root bucket to its real value when stock was picked from a child warehouse", () => {
    const before = product(); const result = reconcileDispatchProducts([before], [before], proof(), false)[0];
    expect(result.stockByStore).toEqual({ source: 0, warehouse: 5, foreign: 7 });
    expect(result.stockByStore.source).not.toBe(-1);
  });
  it("does not apply a second delta when a background refresh replaced the product", () => {
    const before = product(); const refreshed = { ...before, stockByStore: { ...before.stockByStore, source: 3 } };
    expect(reconcileDispatchProducts([refreshed], [before], proof({ replayed: true }), false)[0]).toBe(refreshed);
  });
  it("is idempotent across concurrent results and retains unrelated background edits", () => {
    const before = product(); const first = reconcileDispatchProducts([before], [before], proof(), false);
    expect(reconcileDispatchProducts(first, [before], proof({ replayed: true }), false)[0]).toBe(first[0]);
    const edited = { ...before, name: "Updated name" };
    expect(reconcileDispatchProducts([edited], [before], proof(), false)[0]).toBe(edited);
  });
  it("rejects duplicated proof lines and retains request partial/none fulfilment", () => {
    expect(readDispatchProof(proof({ lines: [proof().lines[0], proof().lines[0]] }), expected, [...lines, ...lines])).toBeNull();
    expect(readDispatchProof(proof({ fulfilment: "none", request_fulfilment: "none", lines: [{ product_id: productId, qty: 0, source_stock: 0 }] }), expected, [{ productId, qty: 0 }])).toMatchObject({ fulfilment: "none", request_fulfilment: "none" });
  });
});
