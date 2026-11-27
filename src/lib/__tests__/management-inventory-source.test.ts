import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createManagementInventorySource, projectInventoryVerificationRow } = require("../../../electron/sync/management-inventory-source.cjs");
const { cloudSignature } = require("../../../electron/sync/verifier.cjs");
const database = { database_guid: "00000000-0000-4000-8000-000000000001", version: "128" };
const replacement = "00000000-0000-4000-8000-000000000002";
type ReportOptions = { tableNames: string[]; branchId: string; assertSource: () => void };

function fixture() {
  const physical = { ...database };
  const query = vi.fn(async () => ({ recordset: [{ ...physical }] }));
  const pool = { request: () => ({ query }) };
  const source = { pool, branches: ["a", "b"], fingerprint: "project-a", stamp: "branches" };
  const config = { source };
  const verify = vi.fn(async ({ tableNames }: ReportOptions) => ({ verified: true, tables: tableNames.map(table => ({ table, verified: true })) }));
  const tracker = createManagementInventorySource({ manager: { pool }, cloud: { verifiedManagementStockScope: () => ({ ...config.source }) }, ready: () => true, verify });
  return { physical, query, source, config, tracker, verify };
}

it("holds until ready, verifies one branch per sync pass and reuses proven results", async () => {
  const f = fixture();
  await expect(f.tracker.assertVerified(f.source, ["a"])).rejects.toMatchObject({ code: "ESTOCK_HISTORY_MANAGEMENT_SOURCE" });
  expect(await f.tracker.verifyNext()).toBe(true);
  expect(f.verify).toHaveBeenCalledOnce();
  expect(f.verify.mock.calls[0]?.[0]).toMatchObject({ branchId: "a", maxRows: 20_000, maxPages: 42 });
  await expect(f.tracker.assertVerified(f.source, ["a"])).resolves.toBeUndefined();
  await expect(f.tracker.assertVerified(f.source, ["a", "b"])).rejects.toMatchObject({ code: "ESTOCK_HISTORY_MANAGEMENT_SOURCE" });
  expect(await f.tracker.verifyNext()).toBe(true);
  expect(await f.tracker.verifyNext()).toBe(false);
  f.physical.version = "129"; // Ordinary client downloads may advance the watermark after verification.
  await expect(f.tracker.assertVerified(f.source, ["a", "b"])).resolves.toBeUndefined();
  expect(f.verify).toHaveBeenCalledTimes(2);
});

it("refuses a previous project even when the SQL connection and branch IDs stay the same", async () => {
  const f = fixture();
  expect(await f.tracker.verifyNext()).toBe(true);
  f.config.source = { ...f.source, fingerprint: "project-b" };
  f.verify.mockResolvedValue({ verified: false, tables: [] });
  await expect(f.tracker.assertVerified(f.config.source, ["a"])).rejects.toMatchObject({ code: "ESTOCK_HISTORY_MANAGEMENT_SOURCE" });
  expect(await f.tracker.verifyNext()).toBe(false);
  await expect(f.tracker.assertVerified(f.config.source, ["a"])).rejects.toMatchObject({ code: "ESTOCK_HISTORY_MANAGEMENT_SOURCE" });
});

it("refuses a replacement database and a source that changed during verification", async () => {
  const f = fixture();
  expect(await f.tracker.verifyNext()).toBe(true);
  f.physical.database_guid = replacement;
  await expect(f.tracker.assertVerified(f.source, ["a"])).rejects.toMatchObject({ code: "ESTOCK_HISTORY_MANAGEMENT_SOURCE" });
  f.verify.mockImplementation(async ({ tableNames }) => {
    f.physical.version = "130";
    return { verified: true, tables: tableNames.map(table => ({ table, verified: true })) };
  });
  expect(await f.tracker.verifyNext()).toBe(false);
  await expect(f.tracker.assertVerified(f.source, ["b"])).rejects.toMatchObject({ code: "ESTOCK_HISTORY_MANAGEMENT_SOURCE" });
});

it("compares only the selected location's stock quantity and enforces the cloud page cap", async () => {
  const table = { cloudTable: "products", columns: [ {cloudColumn: "stock_by_store", cloudType: "jsonb"} ] };
  const row = { name: "Shoes", stock_by_store: { a: 5, b: 300 } };
  expect(projectInventoryVerificationRow(table, row, "a")).toEqual({ name: "Shoes", stock_by_store: { a: 5 } });
  const cloud = { bootstrapPage: vi.fn().mockResolvedValue({ rows: [row], cursor: "next" }) };
  await expect(cloudSignature({ cloud, table, branchId: "a", maxPages: 1, projectRow: projectInventoryVerificationRow })).rejects.toThrow("page limit");
  expect(cloud.bootstrapPage).toHaveBeenCalledOnce();
});
