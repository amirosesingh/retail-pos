import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@/core/types/pos-types";
import type { RelayScope } from "@/core/api/relay-policy.server";
import type { VerifiedTerminalDescriptor } from "../terminal-binding.server";
import { applyProductMergeReceipt, stockHistoryProductMergeRelaySchema, type StockHistoryProductMergeRequest } from "../stock-history-product-merge";

const mocks = vi.hoisted(() => ({
  getChannel: "beta", config: { url: "https://merge-fixture.supabase.test" }, enrollment: "",
  rpc: vi.fn(), relay: vi.fn(), bridge: null as { productMergeCapability?: ReturnType<typeof vi.fn>; mergeProducts: ReturnType<typeof vi.fn> } | null,
  key: new Map<string, unknown>(), terminal: {} as Record<string, string>,
}));
vi.mock("../release-channel", () => ({ get RELEASE_CHANNEL() { return mocks.getChannel; } }));
vi.mock("../external-supabase-config", () => ({ supabaseConfig: () => mocks.config, runtimeEnvValue: () => mocks.enrollment }));
vi.mock("@/core/api/pos-relay.server", () => ({ serviceRest: mocks.rpc }));
vi.mock("@/core/api/sync-relay", () => ({ relayProductMerge: mocks.relay }));
vi.mock("@/core/local-db/local-db", () => ({ localConfigurationBridge: () => mocks.bridge }));
vi.mock("@/core/activation/terminal-tokens", () => ({ readTerminalConfig: () => mocks.terminal }));
vi.mock("../server-origin", () => ({ serverOrigin: () => "https://beta-fixture.example" }));
vi.mock("../device-secrets", () => ({
  getDeviceSecret: async (key: string) => mocks.key.get(key) ?? null,
  setDeviceSecret: async (key: string, value: unknown) => { mocks.key.set(key, structuredClone(value)); },
  clearDeviceSecret: (key: string) => { mocks.key.delete(key); },
}));

const { stockHistoryProductMerge } = await import("../stock-history-product-merge.server");
const { readPendingProductMerge, tryPilotProductMerge } = await import("../stock-history-product-merge.client");
const master = "00000000-0000-4000-8000-000000000001";
const source = "00000000-0000-4000-8000-000000000002";
const held = "00000000-0000-4000-8000-000000000003";
const terminalId = "00000000-0000-4000-8000-000000000004";
const author = "00000000-0000-4000-8000-000000000005";
const operationId = "00000000-0000-4000-8000-000000000006";
const branchId = "fixture-A";
const endpoint = "https://beta-fixture.example/api/public/sync";
const descriptor: VerifiedTerminalDescriptor = { id: terminalId, platform: "pc", mode: "operations", branchId };
const scope: RelayScope = { label: author, kind: "cashier", storeId: branchId, role: "staff", roleSlug: "staff",
  permissions: { can_merge_products: true, can_archive_product: true }, appUserId: author, terminalId, isSupervisor: false };
const items: Product[] = [master, source, held].map((id, idx) => ({
  id, name: "Synthetic " + idx, sku: "visible fallback " + idx, barcode: "barcode-" + idx, category: "Fixture",
  price: 1, cost: 0, taxRate: 0, reorderLevel: 0, barcodes: ["old"], stockByStore: { [branchId]: idx + 1, B: 12 },
  mergeRevision: { sku: idx ? "SKU" + idx : null, rowVersion: "1" },
}));
const request = { version: 1 as const, branchId, terminalId, action: "merge" as const, masterId: master, operationId,
  roster: items.map(product => ({ id: product.id, ...product.mergeRevision! })) };
const capability = { version: 1 as const, branchId, terminalId, action: "capability" as const };
const receipt = (id = operationId) => ({
  ok: true as const, operationId: id, branchId, master: {
    id: master, sku: null, quantity: "3", stockTotal: "15", rowVersion: "2", aliases: ["old", "SKU1"],
  },
  removed: [{ id: source, sku: "SKU1", name: "Synthetic 1", quantity: "2", barcode: null, aliases: null }],
  held: [{ id: held, name: "Synthetic 2", code: "PRODUCT_HAS_SALES_HISTORY" as const }],
});
const act = (products = items, resumeOperationId?: string) => tryPilotProductMerge({
  branchId, actorId: author, masterId: master, duplicateIds: [source, held], products, resumeOperationId, isCurrent: () => true,
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getChannel = "beta";
  mocks.key.clear();
  mocks.bridge = null;
  mocks.terminal = { tokenId: terminalId, locationId: branchId, deviceType: "pc", deviceUse: "operations" };
  mocks.enrollment = JSON.stringify({ backendOrigin: new URL(endpoint).origin, projectOrigin: mocks.config.url, terminalId, branchId });
});
afterEach(() => { vi.restoreAllMocks(); });

describe("scoped hosted merge transport", () => {
  it("gates capability and sends only the exact server-derived actor and scope to the prepared writers", async () => {
    mocks.rpc.mockResolvedValueOnce(Response.json(true)).mockResolvedValueOnce(Response.json(receipt()));
    const probe = await stockHistoryProductMerge(capability, new Request(endpoint), descriptor, scope, true);
    expect(await probe.json()).toEqual({ ok: true, enabled: true });
    expect(mocks.rpc.mock.calls[0]![0]).toBe("rpc/pos_stock_history_product_merge_capability");
    const response = await stockHistoryProductMerge(request, new Request(endpoint), descriptor, scope, true);
    expect(await response.json()).toEqual(receipt());
    const [rpc, init] = mocks.rpc.mock.calls[1]!;
    expect(rpc).toBe("rpc/pos_stock_history_merge_products");
    expect(JSON.parse(init.body)).toEqual({ p_author: author, p_branch: branchId, p_terminal: terminalId, p_operation: operationId,
      p_master: master, p_roster: request.roster });
    expect(init.redirect).toBe("error");
  });

  it.each(["stable", "project", "backend", "terminal", "missing"])("does no RPC work outside the exact activated Beta pilot (%s)", async reason => {
    if (reason === "stable") mocks.getChannel = "stable";
    if (reason === "project") mocks.enrollment = mocks.enrollment.replace("merge-fixture", "other-fixture");
    if (reason === "backend") mocks.enrollment = mocks.enrollment.replace("beta-fixture", "outside-beta");
    if (reason === "terminal") mocks.enrollment = mocks.enrollment.replace(terminalId, author);
    if (reason === "missing") mocks.enrollment = "";
    const response = await stockHistoryProductMerge(capability, new Request(endpoint), descriptor, scope, true);
    expect(await response.json()).toEqual({ ok: true, enabled: false });
    expect((await stockHistoryProductMerge(request, new Request(endpoint), descriptor, scope, true)).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each(["binding", "staff", "permission", "replica", "branch"])("refuses unverified or unauthorized pilot caller (%s)", async reason => {
    const modified = reason === "staff" ? { ...scope, appUserId: null }
      : reason === "permission" ? { ...scope, permissions: { can_merge_products: true } }
      : reason === "replica" ? { ...scope, managementReplica: true }
      : reason === "branch" ? { ...scope, storeId: "other" } : scope;
    expect((await stockHistoryProductMerge(request, new Request(endpoint), descriptor, modified, reason !== "binding")).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects duplicate/spoofed input and partial or changed success receipts", async () => {
    expect(stockHistoryProductMergeRelaySchema.safeParse({ ...request, p_author: author }).success).toBe(false);
    expect(stockHistoryProductMergeRelaySchema.safeParse({ ...request, roster: [...request.roster, request.roster[1]] }).success).toBe(false);
    mocks.rpc.mockResolvedValueOnce(Response.json({ ...receipt(), held: [] }));
    expect((await stockHistoryProductMerge(request, new Request(endpoint), descriptor, scope, true)).status).toBe(503);
    mocks.rpc.mockResolvedValueOnce(Response.json({ code: "55P03", message: "private database detail" }, { status: 409 }));
    const conflict = await stockHistoryProductMerge(request, new Request(endpoint), descriptor, scope, true);
    expect(await conflict.json()).toMatchObject({ code: "PRODUCT_MERGE_BUSY" });
  });

  it("reads only the exact authorized operation and separates absence from failed verification", async () => {
    const lookup = { ...request, action: "receipt" as const };
    mocks.rpc.mockResolvedValueOnce(Response.json({ ok: true, receipt: null }))
      .mockResolvedValueOnce(Response.json({ ok: true, receipt: receipt() }))
      .mockResolvedValueOnce(Response.json({ ok: true, receipt: receipt(source) }));
    const run = () => stockHistoryProductMerge(lookup, new Request(endpoint), descriptor, scope, true);
    expect(await (await run()).json()).toEqual({ ok: true, receipt: null });
    expect(await (await run()).json()).toEqual({ ok: true, receipt: receipt() });
    expect((await run()).status).toBe(503);
    const [rpc, init] = mocks.rpc.mock.calls[0]!;
    expect(rpc).toBe("rpc/pos_stock_history_product_merge_receipt");
    expect(JSON.parse(init.body)).toEqual({ p_author: author, p_branch: branchId, p_terminal: terminalId, p_operation: operationId,
      p_master: master, p_roster: request.roster });
  });
});

describe("atomic selection and retry", () => {
  it("reuses the saved operation and original SKU/revisions after a lost receipt", async () => {
    let original: StockHistoryProductMergeRequest | undefined;
    mocks.relay.mockImplementation(async input => {
      if (input.action === "capability") return { ok: true, enabled: true };
      if (!original) { original = structuredClone(input); throw Error("lost ACK"); }
      expect(input).toEqual({ ...original, action: "receipt" });
      return { ok: true, receipt: receipt(input.operationId) };
    });
    await expect(act()).rejects.toMatchObject({ code: "ESYNC_PRODUCT_MERGE_UNVERIFIED" });
    expect(mocks.key.size).toBe(1);
    const savedRequest = await readPendingProductMerge(branchId, author);
    expect(savedRequest?.operationId).toBe(original?.operationId);
    expect(await readPendingProductMerge(branchId, source)).toBeNull();
    const saved = await act([], savedRequest?.operationId);
    expect(saved?.operationId).toBe(original?.operationId);
    const catalogue = applyProductMergeReceipt(items, saved!);
    expect(catalogue.map(product => product.id)).toEqual([master, held]);
    expect(catalogue[0]).toMatchObject({ stockByStore: { [branchId]: 3, B: 12 }, barcodes: ["old", "SKU1"] });
    expect(catalogue[1]).toBe(items[2]);
    expect(mocks.key.size).toBe(0);
    expect(mocks.relay.mock.calls.filter(([input]) => input.action === "merge")).toHaveLength(1);
    expect(mocks.relay.mock.calls.filter(([input]) => input.action === "capability")).toHaveLength(1);
    await expect(act(items, saved?.operationId)).rejects.toMatchObject({ code: "ESYNC_PRODUCT_MERGE_UNVERIFIED" });
  });

  it("retains native attempts after a refusal and resumes from the saved selection even without catalogue rows", async () => {
    const productMergeCapability = vi.fn().mockResolvedValueOnce({ ok: true, enabled: true })
      .mockRejectedValue(Error("New merges are no longer available"));
    mocks.bridge = { productMergeCapability, mergeProducts: vi.fn() };
    mocks.bridge.mergeProducts.mockResolvedValueOnce({ ok: false, code: "PRODUCT_MERGE_ROSTER_CHANGED" })
      .mockImplementationOnce(async input => receipt(input.operationId));
    await expect(act()).rejects.toMatchObject({ code: "PRODUCT_MERGE_ROSTER_CHANGED" });
    const saved = await readPendingProductMerge(branchId, author);
    expect(saved).toBeTruthy();
    const capableBridge = mocks.bridge;
    mocks.bridge = { mergeProducts: vi.fn() };
    await expect(act()).rejects.toMatchObject({ code: "ESYNC_PRODUCT_MERGE_UNVERIFIED" });
    expect(mocks.bridge.mergeProducts).not.toHaveBeenCalled();
    mocks.bridge = capableBridge;
    expect((await act([], saved?.operationId))?.operationId).toBe(saved?.operationId);
    expect(mocks.bridge.mergeProducts.mock.calls).toEqual([[saved], [saved]]);
    expect(productMergeCapability).toHaveBeenCalledTimes(1);
  });

  it("retries the same write after verified absence and never treats a failed lookup as absence", async () => {
    let first: StockHistoryProductMergeRequest | undefined;
    let readable = false;
    mocks.relay.mockImplementation(async input => {
      if (input.action === "capability") return { ok: true, enabled: true };
      if (input.action === "receipt") {
        return readable ? { ok: true, receipt: null } : { ok: false, code: "PRODUCT_MERGE_BUSY" };
      }
      if (!first) { first = structuredClone(input); throw Error("request interrupted"); }
      expect(input).toEqual(first);
      return receipt(input.operationId);
    });
    await expect(act()).rejects.toMatchObject({ code: "ESYNC_PRODUCT_MERGE_UNVERIFIED" });
    await expect(act()).rejects.toMatchObject({ code: "ESYNC_PRODUCT_MERGE_UNVERIFIED" });
    expect(mocks.relay.mock.calls.filter(([input]) => input.action === "merge")).toHaveLength(1);
    readable = true;
    expect((await act())?.operationId).toBe(first?.operationId);
  });

  it("permits an exact recovered receipt only from the native bridge", async () => {
    mocks.bridge = { productMergeCapability: vi.fn(async () => ({ ok: true, enabled: true })), mergeProducts: vi.fn(async () => receipt()) };
    expect((await act())?.operationId).toBe(operationId);
    expect(mocks.relay).not.toHaveBeenCalled();
    mocks.bridge = null;
    mocks.relay.mockImplementation(async input => input.action === "capability" ? { ok: true, enabled: true } : receipt());
    await expect(act()).rejects.toMatchObject({ code: "ESYNC_PRODUCT_MERGE_UNVERIFIED" });
    expect(mocks.key.size).toBe(1);
  });

  it("uses the existing path only when the authoritative pilot capability is disabled before any attempt", async () => {
    mocks.relay.mockResolvedValue({ ok: true, enabled: false });
    await expect(act()).resolves.toBeNull();
    mocks.relay.mockResolvedValueOnce({ ok: true, enabled: true }).mockRejectedValueOnce(Error("lost ACK"));
    await expect(act()).rejects.toMatchObject({ code: "ESYNC_PRODUCT_MERGE_UNVERIFIED" });
    await expect(act()).rejects.toMatchObject({ code: "ESYNC_PRODUCT_MERGE_UNVERIFIED" });
  });

  it("preserves missing branch stock keys when retired quantities have no net effect", () => {
    const saved = receipt();
    saved.master.quantity = "0";
    saved.removed[0]!.quantity = "0";
    const current = [{ ...items[0]!, stockByStore: { B: 12 } }, ...items.slice(1)];
    expect(applyProductMergeReceipt(current, saved)[0]?.stockByStore).toEqual({ B: 12 });
  });

  it("does not fall back to legacy when the enrolled native route cannot verify the renderer's identity", async () => {
    mocks.bridge = { productMergeCapability: vi.fn(async () => ({ ok: true, enabled: true })), mergeProducts: vi.fn() };
    await expect(tryPilotProductMerge({
      branchId, actorId: null, masterId: master, duplicateIds: [source, held], products: items, isCurrent: () => true,
    })).rejects.toMatchObject({ code: "ESYNC_PRODUCT_MERGE_UNVERIFIED" });
    expect(mocks.bridge.mergeProducts).not.toHaveBeenCalled();
    mocks.terminal.locationId = "changed";
    await expect(act()).rejects.toMatchObject({ code: "ESYNC_PRODUCT_MERGE_UNVERIFIED" });
  });
});
