import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RelayScope } from "@/core/api/relay-policy.server";
import { readStockActivityPage } from "../stock-activity.server";
import { readStockActivityBalances } from "../stock-activity-balances.server";
import { stockActivityAtCutoff } from "../stock-activity-history";
import type { StockActivityRequest } from "../stock-activity-query";

const mocks = vi.hoisted(() => ({ rest: vi.fn(), verify: vi.fn(), scope: vi.fn() }));
vi.mock("@/core/api/pos-relay.server", () => ({ serviceRest: mocks.rest, verifyRelayCaller: mocks.verify }));
vi.mock("@/core/api/relay-policy.server", () => ({ resolveRelayScope: mocks.scope, canCrossBranches: () => false }));

const productId = "00000000-0000-4000-8000-000000000001";
const movementId = "00000000-0000-4000-8000-000000000003";
const adjustmentId = "00000000-0000-4000-8000-000000000004";
const actorId = "00000000-0000-4000-8000-000000000005";
const branchId = "Beta-1";
const cutoff = "2026-11-23T03:00:00.1234567Z";
const request: StockActivityRequest = { branchId, cutoff, side: "through-cutoff", limit: 1 };
const stock = { id: movementId, product_id: productId, product_name: "Ball", store_id: branchId, created_at: "2026-11-23T03:00:00.123455+00:00" };
const sale = { ...stock, activity_type: "sale", reference: "TEST-BILL", quantity_delta: -1, stock_before: 7, stock_after: 6 };
const adjustment = { ...stock, id: adjustmentId, created_at: "2026-11-23T03:00:00.123456+00:00", delta: -6, previous_stock: 6, updated_stock: 0 };

function authorizedScope(kind: RelayScope["kind"] = "staff"): RelayScope {
  return {
    kind, staffUserId: "tester", label: "Test staff", storeId: branchId, role: "staff", roleSlug: "cashier",
    isSupervisor: false, permissions: { can_view_inventory: true },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.verify.mockResolvedValue("test-caller");
  mocks.scope.mockResolvedValue(authorizedScope());
  mocks.rest.mockImplementation(async (path: string) => Response.json(path.startsWith("stock_adjustments?") ? [adjustment] : [sale]));
});

describe("authorized hosted item activity", () => {
  it.each(["staff", "cashier"] as const)("uses %s sign-in and returns the latest scoped source by timestamp", async kind => {
    const proof = kind === "staff" ? { accessToken: "test-staff" } : { cashierToken: "test-pin" };
    mocks.scope.mockResolvedValue(authorizedScope(kind));
    const page = await readStockActivityPage(proof, request);
    expect(mocks.verify).toHaveBeenCalledWith(proof);
    expect(mocks.scope).toHaveBeenCalledWith("test-caller");
    expect(page.rows).toEqual([{
      id: adjustmentId, branchId, productId, productName: "Ball", occurredAt: "2026-11-23T03:00:00.1234560Z",
      kind: "adjustment", reference: null, delta: -6, before: 6, after: 0,
    }]);
    expect(page.next).toEqual({ id: adjustmentId, occurredAt: "2026-11-23T03:00:00.1234560Z" });
    for (const [path] of mocks.rest.mock.calls) {
      const { searchParams } = new URL(`https://example.test/${path}`);
      expect(searchParams.get("created_at")).toBe("lte.2026-11-23T03:00:00.123456Z");
      expect(searchParams.get("store_id")).toBe(`eq.${branchId}`);
      expect(searchParams.get("order")).toBe("created_at.desc,id.desc");
      expect(searchParams.get("limit")).toBe("2");
      expect(searchParams.get("select")).not.toMatch(/note|staff|cost|\*/);
    }
  });

  it("orders the later side and advances the keyset at the exact timestamp and product", async () => {
    mocks.rest.mockImplementation(async () => Response.json([]));
    const cursor = { occurredAt: "2026-11-23T03:00:00.1234570Z", id: adjustmentId };
    await readStockActivityPage({}, { ...request, productId, side: "after-cutoff", cursor });
    for (const [path] of mocks.rest.mock.calls) {
      const { searchParams } = new URL(`https://example.test/${path}`);
      expect(searchParams.get("created_at")).toBe("gt.2026-11-23T03:00:00.123456Z");
      expect(searchParams.get("product_id")).toBe(`eq.${productId}`);
      expect(searchParams.get("order")).toBe("created_at.asc,id.asc");
      expect(searchParams.get("or")).toBe(`(created_at.gt.2026-11-23T03:00:00.123457Z,and(created_at.eq.2026-11-23T03:00:00.123457Z,id.gt.${adjustmentId}))`);
    }
  });

  it("denies wrong branch, inactive scope, device-only and disabled inventory page before storage", async () => {
    await expect(readStockActivityPage({}, { ...request, branchId: "Other" })).rejects.toThrow(/authorized branch/);
    for (const scope of [
      { ...authorizedScope("terminal"), staffUserId: null },
      { ...authorizedScope(), stale: true },
      { ...authorizedScope(), permissions: { can_view_inventory: true, "page:inventory": false } },
      { ...authorizedScope(), permissions: { can_view_inventory: false } },
    ]) {
      mocks.scope.mockResolvedValue(scope);
      await expect(readStockActivityPage({}, request)).rejects.toThrow();
    }
    expect(mocks.rest).not.toHaveBeenCalled();
  });

  it("preserves missing quantities, rejects invalid times and deduplicates only matching adjustment identities", async () => {
    mocks.rest.mockImplementation(async (path: string) => Response.json(path.startsWith("stock_adjustments?") ? [] : [
      { ...sale, quantity_delta: null, stock_before: null, stock_after: 0 },
    ]));
    await expect(readStockActivityPage({}, request)).resolves.toMatchObject({ rows: [{ delta: null, before: null, after: 0 }], next: null });
    mocks.rest.mockImplementation(async (path: string) => Response.json(path.startsWith("stock_adjustments?") ? [adjustment] : [
      { ...sale, id: adjustment.id, created_at: adjustment.created_at, activity_type: "adjustment", quantity_delta: -6, stock_before: null, stock_after: 0 },
    ]));
    await expect(readStockActivityPage({}, request)).resolves.toMatchObject({ rows: [{ id: adjustment.id, before: 6, after: 0 }], next: null });
    for (const invalid of [{ ...sale, created_at: null }, { ...sale, store_id: "Other" }, { ...sale, id: adjustment.id }]) {
      mocks.rest.mockImplementation(async (path: string) => Response.json(path.startsWith("stock_adjustments?") ? [adjustment] : [invalid]));
      await expect(readStockActivityPage({}, request)).rejects.toThrow();
    }
  });
});

describe("hosted per-product balance evidence", () => {
  const evidenceRequest = { branchId, cutoff, productIds: [productId] };
  const at = (digit: number) => `2026-11-23T03:00:00.12345${digit}+00:00`;
  const id = (digit: number) => `00000000-0000-4000-8000-00000000001${digit}`;
  const adjustAt = (digit: number) => ({
    ...adjustment, id: id(digit), created_at: at(digit), delta: -1, previous_stock: null, updated_stock: null,
  });
  const reply = (activity: unknown[], adjustments: unknown[]) => Response.json([{
    product_id: productId, through_activity: activity, through_adjustments: adjustments, after_activity: [], after_adjustments: [],
  }]);

  it("does not use an old anchor across activity that a bounded source may have omitted", async () => {
    mocks.rest.mockResolvedValue(reply([
      { ...sale, id: id(6), created_at: at(6), stock_before: null, stock_after: null },
      { ...sale, id: id(2), created_at: at(2) },
    ], [adjustAt(5), adjustAt(4), adjustAt(3)]));
    const result = await readStockActivityBalances({}, evidenceRequest);
    if (!("products" in result)) throw new Error("Expected deployed balance reader");
    const through = result.products[0].through;
    expect(through.map(row => row.id)).toEqual([id(6), id(5), id(4)]);
    expect(stockActivityAtCutoff(through, { branchId, cutoff, productId, throughCoverage: "all" }).balance).toBeNull();
  });

  it("uses the newer full-source boundary and drops every row tied to it", async () => {
    const tied = { ...sale, id: movementId, created_at: at(4) };
    mocks.rest.mockResolvedValue(reply([
      { ...sale, id: id(6), created_at: at(6) }, { ...sale, id: id(2), created_at: at(4) }, tied,
    ], [adjustAt(5), adjustAt(4), adjustAt(3)]));
    await expect(readStockActivityBalances({}, evidenceRequest)).resolves.toMatchObject({
      products: [{ through: [{ id: id(6) }, { id: id(5) }] }],
    });
  });

  it("rejects a conflicting adjustment before dropping the boundary", async () => {
    mocks.rest.mockResolvedValue(reply([
      { ...sale, id: id(3), created_at: at(3), activity_type: "adjustment" },
    ], [adjustAt(5), adjustAt(4), { ...adjustAt(3), updated_stock: 0 }]));
    await expect(readStockActivityBalances({}, evidenceRequest)).rejects.toThrow(/conflicting records/);
  });
});

describe("native item activity", () => {
  const { createStockHistoryReader } = require("../../../electron/stock-history-ipc.cjs");
  const fixture = () => {
    let epoch = 1;
    const person = { id: actorId, user_id: "tester", is_active: true, store_id: branchId, role: "staff", permissions: { can_view_inventory: true } };
    const row = { id: movementId, product_id: productId, store_id: branchId, occurred_at: cutoff, kind: "sale", delta: -1, before: 7, after: 6 };
    const session = { hasPosAuthority: () => true, epoch: () => epoch, identity: () => ({ source: "pos", authorId: actorId, subject: "tester" }), touch: vi.fn() };
    const query = vi.fn(async (sql: string) => ({ recordset: sql.includes("dbo.app_users") ? [person] : [row] }));
    const call = { input: vi.fn().mockReturnThis(), query };
    const handler = createStockHistoryReader({
      manager: { pool: { request: () => call } }, session,
      terminal: () => ({ tokenId: "TEST-TILL", deviceUse: "till" }), branch: () => branchId,
      isPosSender: (event: object) => !!event,
    }, "activity");
    return { handler, person, row, call, session, invalidate: () => { epoch += 1; } };
  };

  it("reads both local sources with bound exact cutoff and rechecks inventory permission before return", async () => {
    const f = fixture();
    const result = await f.handler({}, { ...request, productId });
    expect(result).toMatchObject({ ok: true, page: { cutoff, rows: [{ occurredAt: cutoff, before: 7, after: 6 }], next: null } });
    expect(f.call.query).toHaveBeenCalledTimes(3);
    expect(f.call.query.mock.calls[1]?.[0]).toMatch(/item_activity_logs[\s\S]+stock_adjustments/);
    expect(f.call.query.mock.calls[1]?.[0]).not.toContain(branchId);
    expect(f.call.input).toHaveBeenCalledWith("branch_id", branchId);
    expect(f.call.input).toHaveBeenCalledWith("cutoff_raw", cutoff);
    expect(f.call.input).toHaveBeenCalledWith("product_id", productId);
    expect(f.session.touch).toHaveBeenCalledOnce();
  });

  it("denies branch/sender mismatch and refuses stale staff or an unscoped result", async () => {
    const f = fixture();
    await expect(f.handler(null, request)).resolves.toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    await expect(f.handler({}, { ...request, branchId: "Other" })).resolves.toMatchObject({ ok: false, code: "SYNC_BRANCH_FORBIDDEN" });
    expect(f.call.query).not.toHaveBeenCalled();
    f.person.permissions.can_view_inventory = false;
    await expect(f.handler({}, request)).resolves.toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
    expect(f.call.query).toHaveBeenCalledTimes(1);
    f.person.permissions.can_view_inventory = true;
    f.row.store_id = "Other";
    await expect(f.handler({}, request)).resolves.toMatchObject({ ok: false });
    expect(f.session.touch).not.toHaveBeenCalled();
  });

  it("drops the rows if the native account changes during the query", async () => {
    const f = fixture();
    f.call.query.mockImplementation(async (sql: string) => {
      if (sql.includes("dbo.app_users")) return { recordset: [f.person] };
      f.invalidate();
      return { recordset: [f.row] };
    });
    await expect(f.handler({}, request)).resolves.toMatchObject({ ok: false, code: "ESTOCK_HISTORY_CONTEXT_CHANGED" });
    expect(f.session.touch).not.toHaveBeenCalled();
  });
});
