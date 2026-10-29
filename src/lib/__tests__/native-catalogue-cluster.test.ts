import { createRequire } from "node:module";
import { expect, it } from "vitest";
const require = createRequire(import.meta.url);
const { catalogueReadPredicate, catalogueStoreIdsProjection } = require("../../../electron/db/catalogue-scope.cjs");
const { branchPredicate, rendererReadBranchPredicate } = require("../../../electron/db/branch-scope.cjs");
const registry = require("../../../database/sqlserver/schema-registry.json");
const products = registry.tables.find((table: { cloudTable: string }) => table.cloudTable === "products");

it("binds full native catalogue reads to known targets, cluster ownership and posted received provenance", () => {
  const sql = catalogueReadPredicate(registry);
  expect(sql).toContain("@branch IS NOT NULL AND EXISTS");
  expect(sql).toContain("ct_exists.[id]");
  expect(sql).toContain("co.[group_id]");
  expect(sql).toContain("ci.[quantity_verified],ci.[quantity_received],0)>0");
  expect(sql).toContain("cv.[posted_at] IS NOT NULL");
  expect(sql).toContain("N'completed',N'completed_with_discrepancy'");
  expect(sql).not.toContain("N'approved'");
  expect(sql).toContain("TRY_CONVERT(decimal(38,8),cq.[value])<>0");
  expect(sql).toContain("css.[scope]=N'GLOBAL' AND css.[scope_id]=N''");
  expect(sql).toContain("N'pos_field:integration_settings'");
  expect(sql).toContain("cp.[private_catalogue]=1");
  expect(rendererReadBranchPredicate(registry, products)).toBe(sql);
});

it("does not reuse expanded catalogue read access for product master uploads or writes", () => {
  const write = branchPredicate(registry, products);
  expect(write).toBe("(NULLIF(source.[owner_store_id],N'') IS NULL OR source.[owner_store_id]=@branch)");
  expect(write).not.toContain("group_id");
  expect(write).not.toContain("stock_transfers");
});

it("projects only posted positive-receipt destination identities without exposing transfer history", () => {
  const sql = catalogueStoreIdsProjection(registry);
  expect(sql).toContain("SELECT DISTINCT pt.to_store_id destination");
  expect(sql).toContain("pt.posted_at IS NOT NULL");
  expect(sql).toContain("COALESCE(pi.quantity_verified,pi.quantity_received,0)>0");
  expect(sql).not.toContain("created_by");
  expect(sql).not.toContain("reference");
});

it("fails closed with an old incomplete registry and rejects interpolated SQL aliases", () => {
  expect(catalogueReadPredicate({ tables: [] })).toBe("source.[owner_store_id]=@branch");
  expect(() => catalogueReadPredicate(registry, "source; DROP TABLE products")).toThrow("Invalid catalogue SQL alias");
});
