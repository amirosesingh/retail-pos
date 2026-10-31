import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { describe, expect, it, vi } from "vitest";
import type { Product, Transfer } from "@/core/types/pos-types";
import type { RpcResult } from "../stock-transfers";
import { sameBranchId } from "../branch-id";
import { sameRecordId } from "../sale-identity";
import { reconcileDispatchProducts, type DispatchProof } from "../transfer-dispatch-result";

const source = readFileSync(new URL("../pos-store.tsx", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const callback = source.slice(source.indexOf("  const dispatchTransfer = useCallback("), source.indexOf("  /**\n   * Arrival.", source.indexOf("  const dispatchTransfer = useCallback(")));
const linesStart = source.indexOf("  const linesFor = (");
const linesFor = source.slice(linesStart, source.indexOf("\n\n  /**", linesStart));
const compiled = transpileModule(`${linesFor}\n${callback}\nglobalThis.dispatch = dispatchTransfer;`, { compilerOptions: { module: ModuleKind.None, target: ScriptTarget.ES2022 } }).outputText;
const date = "2026-10-31T03:00:00Z";
const transfer = (patch: Partial<Transfer> = {}): Transfer => ({ id: "transfer", ref: "ST-test", kind: "transfer", fromStoreId: "source", toStoreId: "destination", sourceRequestId: "request", status: "approved", note: "", items: [{ productId: "product", qty: 2, approvedQty: 2 }], createdBy: "Staff", createdAt: date, updatedAt: date, ...patch });
const proof = (patch: Partial<DispatchProof> = {}): DispatchProof => ({ version: 1, transfer_id: "transfer", from_store_id: "source", to_store_id: "destination", source_request_id: "request", status: "dispatched", dispatched_at: date, dispatched_by: "Verified dispatcher", request_closed: true, request_closed_at: date, fulfilment: "partial", request_fulfilment: "partial", lines: [{ product_id: "product", qty: 1, source_stock: 1 }], replayed: false, ...patch });
type State = { currentStoreId: string; transfers: Transfer[]; products: Product[]; stores: { id: string; name: string }[]; settings: { integrations: { autoArchiveZeroStock: boolean } } };
function harness() {
  let epoch = 1;
  const generation = { current: 1 };
  let state: State = { currentStoreId: "source", transfers: [transfer(), transfer({ id: "request", kind: "request", sourceRequestId: undefined, items: [{ productId: "product", qty: 4 }] })],
    products: [{ id: "product", name: "Item", sku: "1", barcode: "1", category: "Default", price: 1, cost: 1, reorderLevel: 0, taxRate: 0, stockByStore: { source: 2, child: 5, foreign: 7 } }],
    stores: [{ id: "source", name: "Sending shop" }], settings: { integrations: { autoArchiveZeroStock: false } } };
  const stateRef = { current: state };
  const database = vi.fn<(...args: unknown[]) => Promise<RpcResult>>();
  const activity = vi.fn().mockResolvedValue(undefined), history = vi.fn().mockResolvedValue(undefined), log = vi.fn();
  const context: Record<string, unknown> = { useCallback: (work: unknown) => work, sessionEpoch: () => epoch, bootstrapGeneration: generation,
    stateRef, actorRef: { current: "Current display name" }, dispatchTransferInDb: database, reconcileDispatchProducts, sameRecordId, sameBranchId,
    setState: (update: (before: State) => State) => { state = update(state); stateRef.current = state; }, logger: { log }, trackTransition: history, recordActivity: activity };
  runInNewContext(compiled, context);
  return { dispatch: context.dispatch as (id: string, lines?: { productId: string; qty: number }[]) => Promise<RpcResult>,
    database, activity, history, log, generation, state: () => state,
    replace: (next: State) => { state = next; stateRef.current = next; }, nextEpoch: () => { epoch++; } };
}
function deferred() { let finish!: (value: RpcResult) => void; const promise = new Promise<RpcResult>(resolve => { finish = resolve; }); return { promise, finish }; }

describe("actual provider dispatch callback", () => {
  it("waits for atomic confirmation, then closes the request without a second database write", async () => {
    const app = harness(), pending = deferred(); app.database.mockReturnValueOnce(pending.promise);
    const run = app.dispatch("transfer", [{ productId: "product", qty: 1 }]);
    expect(app.state().products[0].stockByStore.source).toBe(2); expect(app.activity).not.toHaveBeenCalled();
    pending.finish({ success: true, dispatch: proof() }); await expect(run).resolves.toMatchObject({ success: true });
    expect(app.database).toHaveBeenCalledTimes(1);
    expect(app.state().transfers[0]).toMatchObject({ status: "dispatched", dispatchedBy: "Verified dispatcher", fulfilment: "partial" });
    expect(app.state().transfers[1]).toMatchObject({ status: "completed", fulfilment: "partial", closedAt: date });
    expect(app.state().products[0].stockByStore).toEqual({ source: 1, child: 5, foreign: 7 });
    expect(app.activity).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: "transfer_sent", actorName: "Verified dispatcher", storeId: "destination", meta: expect.objectContaining({ audience: "receiving_branch", sender_store_id: "source" }) }));
  });
  it("does not update cache or emit success activity after a shortage or permission denial", async () => {
    const app = harness(), before = app.state(); app.database.mockResolvedValue({ success: false, code: "TRANSFER_INSUFFICIENT_STOCK", error: "Not enough stock" });
    await expect(app.dispatch("transfer")).resolves.toMatchObject({ success: false }); expect(app.state()).toBe(before);
    expect(app.log).not.toHaveBeenCalled(); expect(app.activity).not.toHaveBeenCalled(); expect(app.history).not.toHaveBeenCalled();
  });
  it("records none fulfilment without inventing stock when the approved send quantity is zero", async () => {
    const app = harness(); app.database.mockResolvedValue({ success: true, dispatch: proof({ fulfilment: "none", request_fulfilment: "none", lines: [{ product_id: "product", qty: 0, source_stock: 2 }] }) });
    await app.dispatch("transfer", [{ productId: "product", qty: 0 }]);
    expect(app.state().products[0].stockByStore.source).toBe(2); expect(app.state().transfers[1].fulfilment).toBe("none");
  });
  it("retains warehouse buckets when the backend picked from a child and the root stayed unchanged", async () => {
    const app = harness(); app.database.mockResolvedValue({ success: true, dispatch: proof({ lines: [{ product_id: "product", qty: 1, source_stock: 2 }] }) });
    await app.dispatch("transfer", [{ productId: "product", qty: 1 }]); expect(app.state().products[0].stockByStore).toEqual({ source: 2, child: 5, foreign: 7 });
  });
  it.each(["session", "branch", "branch round trip"])("ignores a late committed result after %s change", async change => {
    const app = harness(), pending = deferred(); app.database.mockReturnValueOnce(pending.promise);
    const run = app.dispatch("transfer");
    if (change === "session") app.nextEpoch();
    else { app.replace({ ...app.state(), currentStoreId: "other" }); app.generation.current++; if (change === "branch round trip") { app.replace({ ...app.state(), currentStoreId: "source" }); app.generation.current++; } }
    const before = app.state(); pending.finish({ success: true, dispatch: proof() }); await run;
    expect(app.state()).toBe(before); expect(app.activity).not.toHaveBeenCalled(); expect(app.history).not.toHaveBeenCalled();
  });
  it("keeps a newer product refresh and later transfer lifecycle instead of rolling it back", async () => {
    const app = harness(), pending = deferred(); app.database.mockReturnValueOnce(pending.promise); const run = app.dispatch("transfer");
    const current = { ...app.state().products[0], name: "Newer name", stockByStore: { source: 9 } };
    app.replace({ ...app.state(), products: [current], transfers: app.state().transfers.map(row => row.id === "transfer" ? { ...row, status: "received", updatedAt: "2026-10-31T04:00:00Z" } : row) });
    pending.finish({ success: true, dispatch: proof() }); await run;
    expect(app.state().products[0]).toBe(current); expect(app.state().transfers[0]).toMatchObject({ status: "received", updatedAt: "2026-10-31T04:00:00Z" });
  });
  it("applies concurrent fresh/replayed acknowledgements without a double deduction or notification", async () => {
    const app = harness(), first = deferred(), second = deferred(); app.database.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const one = app.dispatch("transfer"), two = app.dispatch("transfer");
    first.finish({ success: true, dispatch: proof() }); await one; second.finish({ success: true, dispatch: proof({ replayed: true }) }); await two;
    expect(app.state().products[0].stockByStore.source).toBe(1); expect(app.activity).toHaveBeenCalledTimes(1); expect(app.history).toHaveBeenCalledTimes(1);
  });
  it("does not turn a confirmed dispatch into a failure when postcommit observers fail", async () => {
    const app = harness(); app.database.mockResolvedValue({ success: true, dispatch: proof() });
    app.log.mockImplementation(() => { throw new Error("Logging unavailable"); }); app.history.mockRejectedValue(new Error("History unavailable")); app.activity.mockRejectedValue(new Error("Notification unavailable"));
    await expect(app.dispatch("transfer")).resolves.toMatchObject({ success: true });
    await Promise.resolve(); expect(app.state().transfers[0].status).toBe("dispatched"); expect(app.activity).toHaveBeenCalledTimes(1);
  });
});
