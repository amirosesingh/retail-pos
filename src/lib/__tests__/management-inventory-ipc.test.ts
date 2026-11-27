import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createManagementInventoryAdmission, createManagementInventoryReader } = require("../../../electron/management-inventory-ipc.cjs");
const { CloudClient } = require("../../../electron/sync/cloud-client.cjs");
const actorId = "00000000-0000-0000-0000-000000000001";
const terminalId = "00000000-0000-0000-0000-000000000002";
const productId = "00000000-0000-0000-0000-000000000003";
const projectOrigin = "https://beta.example.test";

function fixture() {
  const permissions = { can_view_inventory: true, can_use_management_pc: true };
  const account = { id: actorId, user_id: "reports", role: "manager", store_id: "a", is_active: true, permissions };
  const location = { id: "a", name: "Branch A", code: "A", replicaReady: 1 };
  const identity = { ...account, authorId: actorId, canonicalSubject: "reports", branchId: "a", source: "pos", level: "supervisor" };
  const terminal = { tokenId: terminalId, deviceType: "pc", deviceUse: "management", deviceBindingProof: "a".repeat(64), deviceClaimProof: "b".repeat(64) };
  const query = vi.fn(async (sql: string) => ({ recordset: sql.includes("dbo.app_users") ? [account] :
    sql.includes("FROM dbo.products") ? [{ id: productId, name: "Widget", sku: "W", barcode: "123", location_id: "a", quantity: 5, cost_price: 2, selling_price: 4 }] : [location] }));
  const request = { input: vi.fn().mockReturnThis(), query };
  const pool = { request: () => request };
  const manager = { pool, isConnected: () => true };
  const proof = { pool, terminal, fingerprint: "context", stamp: "branches", branches: ["a", "b"], project: { projectOrigin } };
  const scope = vi.fn(() => proof);
  const session = { hasPosAuthority: () => true, hasLevel: () => false, hasPermission: (flag: keyof typeof permissions) => permissions[flag] === true,
    identity: () => identity, epoch: () => 1, touch: vi.fn() };
  const admission = createManagementInventoryAdmission({ manager, session, terminal: () => terminal,
    databaseService: { snapshot: () => ({ tradingReady: true }) }, cloud: { verifiedManagementStockScope: scope },
    isPosSender: (event: string) => event === "authorized-window" });
  const inventorySource = { assertVerified: vi.fn() };
  const read = createManagementInventoryReader(admission, session, { tables: [] }, inventorySource);
  return { admission, read, account, location, identity, manager, proof, query, request, session, inventorySource };
}

it("reads authorized local inventory without disclosing forbidden prices or another branch", async () => {
  const f = fixture();
  const result = await f.read("authorized-window", { kind: "current", branchId: "a" });
  expect(result).toMatchObject({ ok: true, canViewCost: false, products: [{ id: productId, cost: null, stockByStore: { a: 5 }, retailPriceByStore: {} }] });
  expect(f.query.mock.calls.find(([sql]) => sql.includes("FROM dbo.products"))?.[0]).not.toContain("p.cost_price");
  expect(f.request.input).toHaveBeenCalledWith("report_branches", '["a"]');
  expect(await f.read("authorized-window", { kind: "current", branchId: "b" })).toMatchObject({ ok: false, code: "SYNC_BRANCH_FORBIDDEN" });
  expect(await f.read("untrusted-window", { kind: "locations" })).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
  expect(await f.read("authorized-window", { kind: "authorize-export", branchId: "a" })).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
});

it("does not query current product rows before proving the local source matches the connected project", async () => {
  const f = fixture();
  f.inventorySource.assertVerified.mockRejectedValue(Object.assign(new Error("unproved"), { code: "ESTOCK_HISTORY_MANAGEMENT_SOURCE" }));
  expect(await f.read("authorized-window", { kind: "current", branchId: "a" })).toMatchObject({ ok: false, code: "ESTOCK_HISTORY_MANAGEMENT_SOURCE" });
  expect(f.query.mock.calls.some(([sql]) => sql.includes("FROM dbo.products"))).toBe(false);
});

it("fences history reads on physical SQL replacement and incomplete branch downloads", async () => {
  const f = fixture();
  f.location.replicaReady = 0;
  await expect(f.admission("authorized-window", { branchId: "a" })).rejects.toMatchObject({ code: "ESTOCK_HISTORY_MANAGEMENT_INCOMPLETE" });
  f.location.replicaReady = 1;
  const admitted = await f.admission("authorized-window", { branchId: "a" });
  expect(await admitted.authorizeRead(false)).toMatchObject({ branchId: "a", projectOrigin, terminalId });
  f.manager.pool = { ...f.manager.pool };
  expect(() => admitted.assertCurrent()).toThrow(expect.objectContaining({ code: "ESTOCK_HISTORY_CONTEXT_CHANGED" }));
});

it("requires explicit local Management authority and rejects a permission revoked during the read", async () => {
  const f = fixture();
  f.account.permissions.can_use_management_pc = false;
  expect(await f.read("authorized-window", { kind: "locations" })).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
  f.account.permissions.can_use_management_pc = true;
  const realQuery = f.query.getMockImplementation()!;
  f.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM dbo.products")) f.account.is_active = false;
    return realQuery(sql);
  });
  expect(await f.read("authorized-window", { kind: "current", branchId: "a" })).toMatchObject({ ok: false, code: "PERMISSION_DENIED" });
});

it("retains only the same authenticated Management directory across a network disconnect", async () => {
  const pool = {};
  const connectionManager = { pool, profile: { database: "POS_Beta" } };
  const client = new CloudClient({ connectionManager, configStore: { get: () => "https://relay.example.test" },
    terminalStore: { read: () => ({ tokenId: terminalId }) }, financialBasisContext: () => ({ projectOrigin }) });
  client.request = vi.fn().mockResolvedValue({ ok: true, branches: [{ id: "a" }] });
  expect(client.verifiedManagementStockScope()).toBeNull();
  await client.managementBranches();
  client.request.mockRejectedValue(new Error("fetch failed"));
  await expect(client.managementBranches()).rejects.toThrow("fetch failed");
  expect(client.verifiedManagementStockScope()).toMatchObject({ branches: ["a"], pool });
  connectionManager.pool = {};
  expect(client.verifiedManagementStockScope()).toBeNull();
});
